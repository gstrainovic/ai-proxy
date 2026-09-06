import type { Context } from 'hono'
import type { LimitKind, PlanId } from './plans.ts'
import type { BillingDeps } from './billing.ts'
import type { Store } from './stores/types.ts'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { LIMIT_LABELS, PLANS } from './plans.ts'
import { createCheckout, createPortal, handleWebhook, notConfigured } from './billing.ts'
import { checkLimit, currentMonth } from './limits.ts'

export interface AuthUser {
  id: string
}

export interface AppDeps {
  mistralApiKey: string
  mistralBaseUrl: string
  /** Prüft ein InstantDB-Refresh-Token, null wenn ungültig. */
  verifyToken: (token: string) => Promise<AuthUser | null>
  store: Store
  /** Nur lokal/E2E: User-ID aus Header `x-user-id` ohne Token akzeptieren. */
  authBypass: boolean
  mistralFetch: typeof fetch
  corsOrigin?: string
  /** Stripe-Anbindung; null/undefined = Zahlung nicht konfiguriert (Endpoints antworten 501). */
  billing?: BillingDeps | null
}

interface Variables {
  user: AuthUser
}

export type App = Hono<{ Variables: Variables }>

async function resolveUser(c: Context, deps: AppDeps): Promise<AuthUser | null> {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
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

async function planFor(store: Store, userId: string): Promise<PlanId> {
  const sub = await store.getSubscription(userId)
  return sub && sub.status === 'active' ? sub.plan : 'free'
}

/** Erlaubte Modelle im Abo-Modus (Kostenkontrolle): Chat nur Small, Embeddings nur mistral-embed, OCR nur das OCR-Modell. */
export const ALLOWED_CHAT_MODELS = new Set(['mistral-small-latest'])
export const ALLOWED_EMBED_MODELS = new Set(['mistral-embed'])

/** Fehlerformat wie Mistral (`object: 'error'`, `message`), damit das AI SDK unsere Meldung durchreicht. */
function mistralError(c: Context, status: 400 | 402, type: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({
    object: 'error',
    message,
    type,
    param: null,
    code: type,
    error: { code: type, message, ...extra },
  }, status)
}

function limitError(c: Context, kind: LimitKind, plan: PlanId, limit: number) {
  const message = `Monatslimit erreicht: ${limit} ${LIMIT_LABELS[kind]} im Plan ${PLANS[plan].name}. Upgrade in den Einstellungen.`
  return mistralError(c, 402, 'limit_reached', message, { kind, plan, limit })
}

export interface AppOptions {
  /** Pfad-Präfix, z. B. `/ai-proxy` in Supabase Edge Functions (`/functions/v1/ai-proxy/...`). */
  basePath?: string
}

export function createApp(deps: AppDeps, options: AppOptions = {}): App {
  const app: App = options.basePath ? new Hono<{ Variables: Variables }>().basePath(options.basePath) : new Hono()

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

    const month = currentMonth()
    const [plan, usage] = await Promise.all([planFor(deps.store, user.id), deps.store.getUsage(user.id, month)])
    const check = checkLimit(plan, usage, kind)
    if (!check.allowed)
      return limitError(c, kind, plan, check.limit)

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
    const [plan, usage] = await Promise.all([planFor(deps.store, user.id), deps.store.getUsage(user.id, month)])
    return c.json({ plan, month, usage, limits: PLANS[plan].limits })
  })

  app.post('/billing/checkout', c => (deps.billing ? createCheckout(c, deps.billing, deps.store, c.get('user').id) : notConfigured(c)))
  app.post('/billing/portal', c => (deps.billing ? createPortal(c, deps.billing, deps.store, c.get('user').id) : notConfigured(c)))
  // Stripe ruft ohne Nutzer-Token auf, Authentizität kommt aus der Signatur
  app.post('/stripe/webhook', c => (deps.billing ? handleWebhook(c, deps.billing, deps.store) : notConfigured(c)))

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
  }

  return app
}
