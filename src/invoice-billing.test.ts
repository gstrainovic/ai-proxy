import type { AppDeps, InvoiceNotice } from './app.ts'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { MemoryStore } from './stores/memory.ts'

const IBAN = 'CH93 0076 2011 6238 5295 7'

const order = {
  company: 'Muster Sanitär AG',
  contact: 'Petra Muster',
  street: 'Hauptstrasse 12',
  zip: '9000',
  city: 'St. Gallen',
  email: 'buchhaltung@muster.ch',
  vehicles: 5,
  acceptTerms: true,
}

const INTERNAL = 'internal-secret'

function setup(options: { today?: string, invoicing?: boolean, failMail?: boolean } = {}) {
  const store = new MemoryStore()
  const notices: InvoiceNotice[] = []
  let today = options.today ?? '2026-09-19'
  const deps: AppDeps = {
    mistralApiKey: 'k',
    mistralBaseUrl: 'https://mistral.test/v1',
    verifyToken: async token => (token === 'valid-token' ? { id: 'user-1' } : null),
    store,
    authBypass: false,
    internalToken: INTERNAL,
    mistralFetch: async () => new Response(JSON.stringify({ usage: { total_tokens: 1 } }), { headers: { 'content-type': 'application/json' } }),
    invoicing: options.invoicing === false
      ? null
      : {
          iban: IBAN,
          today: () => today,
          notify: async (notice) => {
            if (options.failMail)
              throw new Error('Resend down')
            notices.push(notice)
          },
        },
  }
  return { app: createApp(deps), store, notices, setToday: (d: string) => { today = d } }
}

const headers = { 'Authorization': 'Bearer valid-token', 'content-type': 'application/json' }

function post(app: ReturnType<typeof createApp>, path: string, body: unknown = {}) {
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function usage(app: ReturnType<typeof createApp>) {
  return (await app.request('/me/usage', { headers })).json() as Promise<any>
}

describe('POST /billing/order', () => {
  it('ohne Rechnungs-Konfiguration 501', async () => {
    const { app } = setup({ invoicing: false })
    expect((await post(app, '/billing/order', order)).status).toBe(501)
  })

  it('verlangt Anmeldung', async () => {
    const { app } = setup()
    const res = await app.request('/billing/order', { method: 'POST', body: JSON.stringify(order) })
    expect(res.status).toBe(401)
  })

  it('meldet Feldfehler mit 400', async () => {
    const { app } = setup()
    const res = await post(app, '/billing/order', { ...order, zip: '90', acceptTerms: false })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(Object.keys(body.error.fields).sort()).toEqual(['acceptTerms', 'zip'])
  })

  it('legt das Abo an, verschickt die Rechnung und schaltet den Betrieb frei', async () => {
    const { app, store, notices } = setup()
    const res = await post(app, '/billing/order', order)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toMatchObject({ mailed: true, invoice: { amount: 180, dueAt: '2026-10-19' } })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ type: 'invoice', userId: 'user-1', invoice: { amount: 180 } })
    expect((await store.getSubscription('user-1'))?.billing).toBe('invoice')

    const info = await usage(app)
    expect(info.plan).toBe('betrieb')
    expect(info.trial).toBeNull()
    expect(info.billing).toMatchObject({
      method: 'invoice',
      company: 'Muster Sanitär AG',
      vehicles: 5,
      periodEnd: '2027-09-19',
      cancelAtPeriodEnd: false,
      openInvoice: { amount: 180, dueAt: '2026-10-19' },
    })
  })

  it('zweite Bestellung bei laufendem Abo: 409', async () => {
    const { app } = setup()
    await post(app, '/billing/order', order)
    expect((await post(app, '/billing/order', order)).status).toBe(409)
  })

  it('scheitert der Mailversand, bleibt die Bestellung bestehen und die Antwort sagt es', async () => {
    const { app, store } = setup({ failMail: true })
    const res = await post(app, '/billing/order', order)
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).mailed).toBe(false)
    expect((await store.getSubscription('user-1'))?.status).toBe('active')
  })
})

describe('Kündigen und Zugang', () => {
  it('Kündigung auf Ende der Laufzeit, zurücknehmbar', async () => {
    const { app } = setup()
    await post(app, '/billing/order', order)
    const res = await post(app, '/billing/cancel')
    expect(res.status).toBe(200)
    expect((await usage(app)).billing.cancelAtPeriodEnd).toBe(true)
    expect((await post(app, '/billing/resume')).status).toBe(200)
    expect((await usage(app)).billing.cancelAtPeriodEnd).toBe(false)
  })

  it('Kündigung ohne Rechnungs-Abo: 404', async () => {
    const { app } = setup()
    expect((await post(app, '/billing/cancel')).status).toBe(404)
  })

  it('stornierte Rechnungen werden gemeldet', async () => {
    const { app, notices } = setup({ today: '2026-09-19' })
    // Testzeit beginnt heute, das bezahlte Jahr erst in 30 Tagen: Kündigung storniert die Rechnung
    await usage(app)
    await post(app, '/billing/order', order)
    const res = await post(app, '/billing/cancel')
    expect(((await res.json()) as any).voided).toBe(1)
    expect(notices.map(n => n.type)).toEqual(['invoice', 'voided'])
    // Abo ist weg, die Testzeit läuft weiter, eine neue Bestellung geht
    const info = await usage(app)
    expect(info.billing).toBeNull()
    expect(info.trial.active).toBe(true)
    expect((await post(app, '/billing/order', order)).status).toBe(200)
  })

  it('nach Ablauf der Laufzeit sperrt der Proxy KI-Aufrufe wie nach der Testzeit', async () => {
    const { app, setToday } = setup()
    await post(app, '/billing/order', order)
    await post(app, '/billing/cancel')
    const ok = await post(app, '/v1/chat/completions', { model: 'mistral-small-latest' })
    expect(ok.status).toBe(200)
    setToday('2027-10-20')
    const blocked = await post(app, '/v1/chat/completions', { model: 'mistral-small-latest' })
    expect(blocked.status).toBe(402)
  })
})

describe('interne Job-Endpunkte (Verlängerung, Zahlung)', () => {
  const internal = { 'Authorization': `Bearer ${INTERNAL}`, 'x-user-id': 'user-1', 'content-type': 'application/json' }
  const postInternal = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: internal, body: JSON.stringify(body) })

  it('Verlängerung und Zahlung nur mit internem Token, nicht mit dem Nutzer-Token', async () => {
    const { app } = setup()
    await post(app, '/billing/order', order)
    expect((await post(app, '/billing/renew', { vehicles: 1 })).status).toBe(403)
    expect((await post(app, '/billing/paid', { key: 'x' })).status).toBe(403)
  })

  it('verlängert 30 Tage vor Ablauf mit der übergebenen Fahrzeugzahl und verschickt die Rechnung', async () => {
    const { app, notices, setToday } = setup()
    await post(app, '/billing/order', order)
    setToday('2027-08-19')
    expect((await postInternal(app, '/billing/renew', { vehicles: 7 })).status).toBe(409)
    setToday('2027-08-20')
    const res = await postInternal(app, '/billing/renew', { vehicles: 7 })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).invoice).toMatchObject({ amount: 252, periodStart: '2027-09-19' })
    expect(notices.at(-1)).toMatchObject({ type: 'invoice', invoice: { vehicles: 7 } })
    // nicht zweimal
    expect((await postInternal(app, '/billing/renew', { vehicles: 7 })).status).toBe(409)
  })

  it('trägt eine Zahlung über die Referenz ein', async () => {
    const { app, store } = setup()
    const { invoice } = (await (await post(app, '/billing/order', order)).json()) as any
    const res = await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt: '2026-10-02' })
    expect(res.status).toBe(200)
    expect((await store.getSubscription('user-1'))?.invoices?.[0]?.paidAt).toBe('2026-10-02')
    expect((await usage(app)).billing.openInvoice).toBeNull()
    expect((await postInternal(app, '/billing/paid', { key: 'RF00NIX' })).status).toBe(404)
  })
})
