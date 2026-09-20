import type { Context } from 'hono'
import type { LimitKind, PlanCatalog } from './plans.ts'
import type { BillingDeps } from './billing.ts'
import type { Store, Subscription } from './stores/types.ts'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DEFAULT_CATALOG, LIMIT_LABELS, yearlyPriceChf } from './plans.ts'
import type { InvoiceRecord } from './invoice.ts'
import type { TrialState } from './trial.ts'
import { createCheckout, createPortal, handleWebhook, notConfigured } from './billing.ts'
import { isoDate, parseOrder } from './invoice.ts'
import { cancelSubscription, effectiveSubscription, markInvoicePaid, openInvoices, orderSubscription, periodEnd, renewalDue, renewSubscription, resumeSubscription } from './invoice-subscription.ts'
import { checkLimit, currentMonth, resolvePlan } from './limits.ts'
import { checkBurst, createBurstState } from './rate-limit.ts'
import { startTrial, trialState } from './trial.ts'

export interface AuthUser {
  id: string
  /** Aufruf eines eigenen Server-Prozesses mit AI_PROXY_INTERNAL_TOKEN (Jobs), nicht des Nutzers selbst */
  internal?: boolean
}

export interface AppDeps {
  mistralApiKey: string
  mistralBaseUrl: string
  /** Prüft ein InstantDB-Refresh-Token, null wenn ungültig. */
  verifyToken: (token: string) => Promise<AuthUser | null>
  store: Store
  /** Nur lokal/E2E: User-ID aus Header `x-user-id` ohne Token akzeptieren. */
  authBypass: boolean
  /** Fair-Use-Bremse: Anfragen pro Nutzer und Minute; Default BURST_LIMIT. */
  burstLimit?: number
  mistralFetch: typeof fetch
  corsOrigin?: string
  /** Stripe-Anbindung; null/undefined = Zahlung nicht konfiguriert (Endpoints antworten 501). */
  billing?: BillingDeps | null
  /** Plan-Katalog der App; Default: auto-service-Pläne. */
  plans?: PlanCatalog
  /**
   * Geheimnis für Server-zu-Server-Aufrufe im Namen eines Nutzers (z. B. Pipeline-Functions):
   * Bearer = internalToken plus Header `x-user-id`. Ohne x-user-id wird abgelehnt.
   */
  internalToken?: string
  /** Jahresabo auf Rechnung (Betriebe); null/undefined = nicht konfiguriert (Endpoints antworten 501). */
  invoicing?: InvoicingDeps | null
}

/** Ereignis für Mail an Kunde und Betreiber: neue Rechnung oder stornierte Rechnungen nach Kündigung */
export type InvoiceNotice =
  | { type: 'invoice', userId: string, sub: Subscription, invoice: InvoiceRecord }
  | { type: 'voided', userId: string, sub: Subscription, invoices: InvoiceRecord[] }

export interface InvoicingDeps {
  /** IBAN oder QR-IBAN des Empfängers; bestimmt die Art der Zahlungsreferenz */
  iban: string
  /** Versand (PDF per Mail); ein Fehler bricht die Bestellung nicht ab */
  notify: (notice: InvoiceNotice) => Promise<void>
  /** Heutiges Datum als ISO-Tag; nur für Tests */
  today?: () => string
}

interface Variables {
  user: AuthUser
}

export type App = Hono<{ Variables: Variables }>

async function resolveUser(c: Context, deps: AppDeps): Promise<AuthUser | null> {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token && deps.internalToken && token === deps.internalToken) {
    const id = c.req.header('x-user-id')
    return id ? { id, internal: true } : null
  }
  if (token) {
    const user = await deps.verifyToken(token).catch(() => null)
    if (user)
      return user
  }
  if (deps.authBypass) {
    const id = c.req.header('x-user-id')
    if (id)
      return { id }
  }
  return null
}

function planOf(sub: Subscription, catalog: PlanCatalog): string {
  return resolvePlan(sub.status === 'active' ? sub.plan : undefined, catalog)
}

/** Ohne Abo beginnt beim ersten Aufruf die Testzeit; ein bestehender Eintrag bleibt, wie er ist */
async function subscriptionWithTrial(store: Store, userId: string): Promise<Subscription> {
  const sub = await store.getSubscription(userId)
  if (sub)
    return sub
  const trial = startTrial()
  await store.setSubscription(userId, trial)
  return trial
}

/**
 * Testzeit für die Zugangsprüfung: ein abgelaufenes Rechnungs-Abo zählt wie eine abgelaufene Testzeit.
 * Wurde es vor Beginn des ersten Jahres gekündigt (keine Rechnung mehr), gilt die ursprüngliche Testzeit.
 */
function accessTrial(sub: Subscription): TrialState | null {
  if (sub.billing === 'invoice' && sub.status !== 'active' && sub.invoices?.length)
    return { active: false, daysLeft: 0, endsAt: periodEnd(sub)! }
  return trialState(sub)
}

/** Rechnungs-Abo für die Anzeige in den Einstellungen */
function billingInfo(sub: Subscription) {
  if (sub.billing !== 'invoice' || sub.status !== 'active')
    return null
  const open = openInvoices(sub)[0]
  return {
    method: 'invoice' as const,
    audience: sub.audience ?? 'betrieb',
    company: sub.billingAddress?.company ?? '',
    contact: sub.billingAddress?.contact ?? '',
    vehicles: sub.vehicles ?? 0,
    periodEnd: periodEnd(sub) ?? null,
    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
    openInvoice: open ? { number: open.number, reference: open.reference, amount: open.amount, dueAt: open.dueAt } : null,
  }
}

function trialExpiredError(c: Context, catalog: PlanCatalog) {
  const price = catalog.plans.privat ? ` Wartungsheft kostet ${yearlyPriceChf(1, 'privat')} CHF im Jahr (bis 5 Fahrzeuge), Betriebe ${yearlyPriceChf(1, 'betrieb')} CHF pro Fahrzeug.` : ''
  return mistralError(c, 402, 'trial_expired', `Testzeit vorbei: KI-Scan und Chat brauchen ein Abo.${price} Abo in den Einstellungen.`)
}

/** Erlaubte Modelle im Abo-Modus (Kostenkontrolle): Chat nur Small, Embeddings nur mistral-embed, OCR nur das OCR-Modell. */
export const ALLOWED_CHAT_MODELS = new Set(['mistral-small-latest'])
export const ALLOWED_EMBED_MODELS = new Set(['mistral-embed'])

/** Fehlerformat wie Mistral (`object: 'error'`, `message`), damit das AI SDK unsere Meldung durchreicht. */
function mistralError(c: Context, status: 400 | 402 | 429, type: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({
    object: 'error',
    message,
    type,
    param: null,
    code: type,
    error: { code: type, message, ...extra },
  }, status)
}

function limitError(c: Context, kind: LimitKind, plan: string, limit: number, catalog: PlanCatalog) {
  const message = `Monatslimit erreicht: ${limit} ${LIMIT_LABELS[kind]} im Plan ${catalog.plans[plan].name}. Upgrade in den Einstellungen.`
  return mistralError(c, 402, 'limit_reached', message, { kind, plan, limit })
}

export interface AppOptions {
  /** Pfad-Präfix, z. B. `/ai-proxy` in Supabase Edge Functions (`/functions/v1/ai-proxy/...`). */
  basePath?: string
}

export function createApp(deps: AppDeps, options: AppOptions = {}): App {
  const app: App = options.basePath ? new Hono<{ Variables: Variables }>().basePath(options.basePath) : new Hono()
  const catalog = deps.plans ?? DEFAULT_CATALOG
  // Fair Use: das Monatskontingent ist grosszügig, gegen Skripte hilft nur ein Kurzzeit-Limit
  const burst = createBurstState(deps.burstLimit)
  const today = () => deps.invoicing?.today?.() ?? isoDate(new Date())

  /** Abo samt Testzeit, ein abgelaufenes Rechnungs-Abo bereits als abgelaufen */
  async function currentSubscription(userId: string): Promise<Subscription> {
    return effectiveSubscription(await subscriptionWithTrial(deps.store, userId), today())
  }

  app.use('*', cors({ origin: deps.corsOrigin ?? '*', allowHeaders: ['Authorization', 'Content-Type', 'x-user-id'] }))

  app.get('/health', c => c.json({ ok: true }))

  app.use('/v1/*', async (c, next) => {
    const user = await resolveUser(c, deps)
    if (!user)
      return c.json({ error: { code: 'unauthorized', message: 'Nicht angemeldet.' } }, 401)
    c.set('user', user)
    await next()
  })
  app.use('/billing/*', async (c, next) => {
    const user = await resolveUser(c, deps)
    if (!user)
      return c.json({ error: { code: 'unauthorized', message: 'Nicht angemeldet.' } }, 401)
    c.set('user', user)
    await next()
  })
  app.use('/me/*', async (c, next) => {
    const user = await resolveUser(c, deps)
    if (!user)
      return c.json({ error: { code: 'unauthorized', message: 'Nicht angemeldet.' } }, 401)
    c.set('user', user)
    await next()
  })

  async function forward(c: Context<{ Variables: Variables }>, path: string, kind: LimitKind, extract: (body: any) => number, allowedModels?: Set<string>) {
    const user = c.get('user')
    const rawBody = await c.req.text()
    if (allowedModels) {
      let model = ''
      try {
        model = String(JSON.parse(rawBody)?.model ?? '')
      }
      catch {}
      if (model && !allowedModels.has(model))
        return mistralError(c, 400, 'model_not_allowed', `Modell ${model} ist im Abo nicht verfügbar.`)
    }

    const rate = checkBurst(burst, user.id)
    if (!rate.allowed) {
      c.header('Retry-After', String(rate.retryAfterSeconds))
      return mistralError(c, 429, 'rate_limited', `Zu viele Anfragen. Bitte ${rate.retryAfterSeconds} Sekunden warten.`, { retryAfterSeconds: rate.retryAfterSeconds })
    }

    const month = currentMonth()
    const sub = await currentSubscription(user.id)
    const trial = accessTrial(sub)
    if (trial && !trial.active)
      return trialExpiredError(c, catalog)
    const plan = planOf(sub, catalog)
    const usage = await deps.store.getUsage(user.id, month)
    const check = checkLimit(plan, usage, kind, catalog)
    if (!check.allowed)
      return limitError(c, kind, plan, check.limit, catalog)

    const upstream = await deps.mistralFetch(`${deps.mistralBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deps.mistralApiKey}`,
        'Content-Type': 'application/json',
      },
      body: rawBody,
    })

    const text = await upstream.text()
    if (upstream.ok) {
      let consumed = 0
      try {
        consumed = extract(JSON.parse(text))
      }
      catch {}
      if (consumed > 0)
        await deps.store.addUsage(user.id, month, { [kind]: consumed })
    }
    return c.body(text, upstream.status as any, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    })
  }

  app.post('/v1/chat/completions', c => forward(c, '/chat/completions', 'chatTokens', body => Number(body?.usage?.total_tokens ?? 0), ALLOWED_CHAT_MODELS))
  app.post('/v1/ocr', c => forward(c, '/ocr', 'ocrPages', body => Number(body?.usage_info?.pages_processed ?? 0)))
  // Embedding-Tokens zählen auf das Chat-Token-Kontingent (gleiche Grössenordnung, kein eigener Zähler nötig)
  app.post('/v1/embeddings', c => forward(c, '/embeddings', 'chatTokens', body => Number(body?.usage?.total_tokens ?? 0), ALLOWED_EMBED_MODELS))

  app.get('/me/usage', async (c) => {
    const user = c.get('user')
    const month = currentMonth()
    const sub = await currentSubscription(user.id)
    const plan = planOf(sub, catalog)
    const usage = await deps.store.getUsage(user.id, month)
    // `ordering`: erst mit IBAN und Versand nimmt der Proxy Bestellungen an; ohne das zeigt die App keinen Kaufweg
    return c.json({ plan, month, usage, limits: catalog.plans[plan].limits, plans: catalog.plans, trial: accessTrial(sub), billing: billingInfo(sub), ordering: !!deps.invoicing })
  })

  // Jahresabo auf Rechnung: Bestellen mit Rechnungsadresse, Kündigen auf Ende der Laufzeit, Kündigung zurücknehmen
  async function notify(notice: InvoiceNotice): Promise<boolean> {
    try {
      await deps.invoicing!.notify(notice)
      return true
    }
    catch (err) {
      console.error(`[ai-proxy] Rechnungsmail an ${notice.userId} fehlgeschlagen:`, err)
      return false
    }
  }

  app.post('/billing/order', async (c) => {
    if (!deps.invoicing)
      return notConfigured(c)
    const userId = c.get('user').id
    const parsed = parseOrder(await c.req.json().catch(() => null))
    if (!parsed.ok)
      return c.json({ error: { code: 'invalid_order', message: 'Bitte die markierten Felder prüfen.', fields: parsed.errors } }, 400)
    const existing = await deps.store.getSubscription(userId)
    const result = orderSubscription({ existing, order: parsed.order, userId, today: today(), iban: deps.invoicing.iban })
    if ('error' in result)
      return c.json({ error: { code: 'already_active', message: 'Es läuft bereits ein Abo.' } }, 409)
    await deps.store.setSubscription(userId, result.sub)
    const mailed = await notify({ type: 'invoice', userId, sub: result.sub, invoice: result.invoice })
    return c.json({ invoice: result.invoice, mailed })
  })

  app.post('/billing/cancel', async (c) => {
    if (!deps.invoicing)
      return notConfigured(c)
    const userId = c.get('user').id
    const sub = await deps.store.getSubscription(userId)
    if (!sub || sub.billing !== 'invoice' || effectiveSubscription(sub, today()).status !== 'active')
      return c.json({ error: { code: 'no_subscription', message: 'Kein laufendes Abo auf Rechnung.' } }, 404)
    const result = cancelSubscription(sub, today())
    await deps.store.setSubscription(userId, result.sub)
    if (result.voided.length)
      await notify({ type: 'voided', userId, sub: result.sub, invoices: result.voided })
    return c.json({ billing: billingInfo(result.sub), voided: result.voided.length })
  })

  app.post('/billing/resume', async (c) => {
    if (!deps.invoicing)
      return notConfigured(c)
    const userId = c.get('user').id
    const sub = await deps.store.getSubscription(userId)
    if (!sub || sub.billing !== 'invoice' || effectiveSubscription(sub, today()).status !== 'active')
      return c.json({ error: { code: 'no_subscription', message: 'Kein laufendes Abo auf Rechnung.' } }, 404)
    const next = resumeSubscription(sub)
    await deps.store.setSubscription(userId, next)
    return c.json({ billing: billingInfo(next) })
  })

  // Nur für den täglichen Abo-Job (AI_PROXY_INTERNAL_TOKEN + x-user-id): der Job zählt die Fahrzeuge in der App,
  // der Proxy erzeugt und verschickt die Rechnung. Nutzer selbst dürfen weder verlängern noch Zahlungen eintragen.
  const internalOnly = (c: Context<{ Variables: Variables }>) =>
    c.get('user').internal ? null : c.json({ error: { code: 'forbidden', message: 'Nur für interne Jobs.' } }, 403)

  app.post('/billing/renew', async (c) => {
    if (!deps.invoicing)
      return notConfigured(c)
    const denied = internalOnly(c)
    if (denied)
      return denied
    const userId = c.get('user').id
    const body = await c.req.json<{ vehicles?: number }>().catch(() => ({} as { vehicles?: number }))
    const sub = await deps.store.getSubscription(userId)
    if (!sub || !renewalDue(sub, today()))
      return c.json({ error: { code: 'not_due', message: 'Keine Verlängerung fällig.' } }, 409)
    const next = renewSubscription({ sub, userId, vehicles: Number(body.vehicles) || 1, today: today(), iban: deps.invoicing.iban })
    await deps.store.setSubscription(userId, next)
    const invoice = next.invoices![next.invoices!.length - 1]!
    const mailed = await notify({ type: 'invoice', userId, sub: next, invoice })
    return c.json({ invoice, mailed })
  })

  app.post('/billing/paid', async (c) => {
    if (!deps.invoicing)
      return notConfigured(c)
    const denied = internalOnly(c)
    if (denied)
      return denied
    const userId = c.get('user').id
    type PaidBody = { key?: string, paidAt?: string, amount?: number, bankRef?: string }
    const body = await c.req.json<PaidBody>().catch(() => ({} as PaidBody))
    const sub = await deps.store.getSubscription(userId)
    const key = String(body.key ?? '')
    const opts = {
      ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
      ...(body.bankRef ? { bankRef: String(body.bankRef) } : {}),
    }
    let next: Subscription
    try {
      next = markInvoicePaid(sub ?? { plan: '', status: 'canceled' }, key, body.paidAt || today(), opts)
    }
    catch (err) {
      // Rechnung nicht gefunden: 404. Gefunden, aber Betrag oder Buchung passen nicht: 409, das muss ein Mensch ansehen
      const message = (err as Error).message
      const notFound = message.startsWith('Keine Rechnung')
      return c.json({ error: { code: notFound ? 'not_found' : 'conflict', message } }, notFound ? 404 : 409)
    }
    await deps.store.setSubscription(userId, next)
    return c.json({ billing: billingInfo(next) })
  })

  app.post('/billing/checkout', c => (deps.billing ? createCheckout(c, deps.billing, deps.store, c.get('user').id, catalog) : notConfigured(c)))
  app.post('/billing/portal', c => (deps.billing ? createPortal(c, deps.billing, deps.store, c.get('user').id) : notConfigured(c)))
  // Stripe ruft ohne Nutzer-Token auf, Authentizität kommt aus der Signatur
  app.post('/stripe/webhook', c => (deps.billing ? handleWebhook(c, deps.billing, deps.store, catalog) : notConfigured(c)))

  if (deps.authBypass) {
    // Nur lokal/E2E: Nutzungszähler direkt setzen (Limit-Tests)
    app.put('/test/usage', async (c) => {
      const user = await resolveUser(c, deps)
      if (!user)
        return c.json({ error: { code: 'unauthorized', message: 'Nicht angemeldet.' } }, 401)
      const body = await c.req.json<{ usage: { ocrPages: number, chatTokens: number } }>()
      await deps.store.setUsage(user.id, currentMonth(), {
        ocrPages: Number(body.usage?.ocrPages ?? 0),
        chatTokens: Number(body.usage?.chatTokens ?? 0),
      })
      return c.json({ ok: true })
    })

    // Testzeit zurückdatieren (E2E: Hinweis und Mail vor Ablauf)
    app.put('/test/trial', async (c) => {
      const user = await resolveUser(c, deps)
      if (!user)
        return c.json({ error: { code: 'unauthorized', message: 'Nicht angemeldet.' } }, 401)
      const body = await c.req.json<{ daysUsed?: number }>().catch(() => ({} as { daysUsed?: number }))
      const daysUsed = Number(body.daysUsed ?? 0)
      const sub = await subscriptionWithTrial(deps.store, user.id)
      const startedAt = new Date(Date.now() - daysUsed * 86_400_000).toISOString()
      await deps.store.setSubscription(user.id, { ...sub, status: 'trial', trialStartedAt: startedAt })
      return c.json({ ok: true, trialStartedAt: startedAt })
    })
  }

  return app
}
