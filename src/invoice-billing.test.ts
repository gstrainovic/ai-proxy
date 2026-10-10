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

function setup(options: { today?: string, invoicing?: boolean, failMail?: boolean, manual?: boolean } = {}) {
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
          iban: options.manual ? '' : IBAN,
          ...(options.manual ? { manual: true } : {}),
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

  it('merkt sich die Sprache des Bestellers an der Rechnungsadresse, auch für Verlängerungen', async () => {
    const { app, store, notices } = setup()
    expect((await post(app, '/billing/order', { ...order, language: 'fr' })).status).toBe(200)
    expect((await store.getSubscription('user-1'))?.billingAddress?.language).toBe('fr')
    expect(notices[0]!.sub.billingAddress?.language).toBe('fr')
  })

  it('ohne oder mit unbekannter Sprache bleibt die Rechnung deutsch', async () => {
    const { app, store } = setup()
    await post(app, '/billing/order', { ...order, language: 'xx' })
    expect((await store.getSubscription('user-1'))?.billingAddress?.language).toBeUndefined()
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

const internal = { 'Authorization': `Bearer ${INTERNAL}`, 'x-user-id': 'user-1', 'content-type': 'application/json' }
function postInternal(app: ReturnType<typeof createApp>, path: string, body: unknown = {}) {
  return app.request(path, { method: 'POST', headers: internal, body: JSON.stringify(body) })
}

/** Bestellen und die Rechnung als bezahlt eintragen */
async function orderAndPay(app: ReturnType<typeof createApp>, paidAt = '2026-10-02') {
  const { invoice } = (await (await post(app, '/billing/order', order)).json()) as any
  expect((await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt })).status).toBe(200)
  return invoice
}

const chat = (app: ReturnType<typeof createApp>) => post(app, '/v1/chat/completions', { model: 'mistral-small-latest' })

describe('Zugang: verbindlich erst mit der Zahlung', () => {
  it('Kunden können nicht selbst kündigen: /billing/cancel und /billing/resume gibt es nicht', async () => {
    const { app } = setup()
    await post(app, '/billing/order', order)
    expect((await post(app, '/billing/cancel')).status).toBe(404)
    expect((await post(app, '/billing/resume')).status).toBe(404)
  })

  it('ohne Zahlung sperrt der Proxy KI-Aufrufe nach der Zahlungsfrist, eine späte Zahlung schaltet frei', async () => {
    const { app, setToday } = setup()
    const { invoice } = (await (await post(app, '/billing/order', order)).json()) as any
    setToday('2026-10-19')
    expect((await chat(app)).status).toBe(200)
    setToday('2026-10-20')
    expect((await chat(app)).status).toBe(402)
    expect((await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt: '2026-10-20' })).status).toBe(200)
    expect((await chat(app)).status).toBe(200)
  })

  it('nach dem bezahlten Jahr ohne bezahlte Verlängerung: gesperrt wie nach der Testzeit', async () => {
    const { app, setToday } = setup()
    await orderAndPay(app)
    setToday('2027-08-20')
    expect((await postInternal(app, '/billing/renew', { vehicles: 5 })).status).toBe(200)
    setToday('2027-09-18')
    expect((await chat(app)).status).toBe(200)
    setToday('2027-09-19')
    expect((await chat(app)).status).toBe(402)
  })
})

describe('Admin: keine weiteren Rechnungen (/billing/stop)', () => {
  it('nur mit internem Token', async () => {
    const { app } = setup()
    await post(app, '/billing/order', order)
    expect((await post(app, '/billing/stop')).status).toBe(403)
  })

  it('ohne Rechnungs-Abo: 404', async () => {
    const { app } = setup()
    expect((await postInternal(app, '/billing/stop')).status).toBe(404)
  })

  it('vor der Zahlung: Rechnung storniert und gemeldet, Abo weg, die Testzeit läuft weiter', async () => {
    const { app, notices } = setup({ today: '2026-09-19' })
    await usage(app)
    await post(app, '/billing/order', order)
    const res = await postInternal(app, '/billing/stop')
    expect(((await res.json()) as any).voided).toBe(1)
    expect(notices.map(n => n.type)).toEqual(['invoice', 'voided'])
    const info = await usage(app)
    expect(info.billing).toBeNull()
    expect(info.trial.active).toBe(true)
  })

  it('offene Verlängerung storniert, das bezahlte Jahr läuft zu Ende, danach keine Rechnung und kein Zugang', async () => {
    const { app, setToday } = setup()
    await orderAndPay(app)
    setToday('2027-08-20')
    await postInternal(app, '/billing/renew', { vehicles: 5 })
    const res = await postInternal(app, '/billing/stop')
    expect(((await res.json()) as any).voided).toBe(1)
    expect((await usage(app)).billing).toMatchObject({ cancelAtPeriodEnd: true, openInvoice: null })
    expect((await postInternal(app, '/billing/renew', { vehicles: 5 })).status).toBe(409)
    setToday('2027-09-18')
    expect((await chat(app)).status).toBe(200)
    setToday('2027-09-19')
    expect((await chat(app)).status).toBe(402)
  })
})

describe('interne Job-Endpunkte (Verlängerung, Zahlung)', () => {
  it('Verlängerung und Zahlung nur mit internem Token, nicht mit dem Nutzer-Token', async () => {
    const { app } = setup()
    await post(app, '/billing/order', order)
    expect((await post(app, '/billing/renew', { vehicles: 1 })).status).toBe(403)
    expect((await post(app, '/billing/paid', { key: 'x' })).status).toBe(403)
  })

  it('keine Verlängerungsrechnung, solange die vorige nicht bezahlt ist', async () => {
    const { app, setToday } = setup()
    await post(app, '/billing/order', order)
    setToday('2027-08-20')
    expect((await postInternal(app, '/billing/renew', { vehicles: 5 })).status).toBe(409)
  })

  it('verlängert 30 Tage vor Ablauf mit der übergebenen Fahrzeugzahl und verschickt die Rechnung', async () => {
    const { app, notices, setToday } = setup()
    await orderAndPay(app)
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

  it('die Verlängerung übernimmt die Sprache der Bestellung', async () => {
    const { app, notices, setToday } = setup()
    const { invoice } = (await (await post(app, '/billing/order', { ...order, language: 'it' })).json()) as any
    await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt: '2026-10-02' })
    setToday('2027-08-20')
    expect((await postInternal(app, '/billing/renew', { vehicles: 2 })).status).toBe(200)
    expect(notices.at(-1)!.sub.billingAddress?.language).toBe('it')
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

  it('bucht keine Zahlung mit falschem Betrag und keine Buchung zweimal', async () => {
    const { app, store } = setup()
    const { invoice } = (await (await post(app, '/billing/order', order)).json()) as any
    const wrong = await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt: '2026-10-02', amount: 10 })
    expect(wrong.status).toBe(409)
    expect((await store.getSubscription('user-1'))?.invoices?.[0]?.paidAt).toBeUndefined()

    const ok = await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt: '2026-10-02', amount: invoice.amount, bankRef: 'B-1' })
    expect(ok.status).toBe(200)
    expect((await store.getSubscription('user-1'))?.invoices?.[0]).toMatchObject({ paidAt: '2026-10-02', bankRef: 'B-1' })
    expect((await postInternal(app, '/billing/paid', { key: invoice.reference, paidAt: '2026-10-02', bankRef: 'B-1' })).status).toBe(409)
  })

  it('meldet in der Nutzung, ob eine Bestellung überhaupt möglich ist', async () => {
    expect((await usage(setup().app)).ordering).toBe(true)
    expect((await usage(setup({ manual: true }).app)).ordering).toBe(true)
    expect((await usage(setup({ invoicing: false }).app)).ordering).toBe(false)
  })
})

describe('Rechnung von Hand (ohne IBAN)', () => {
  it('Bestellung legt das Abo mit SCOR-Referenz an und meldet den Auftrag an den Betreiber', async () => {
    const { app, notices } = setup({ manual: true })
    const res = await post(app, '/billing/order', order)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toMatchObject({ mailed: true, manual: true, invoice: { amount: 180, dueAt: '2026-10-19' } })
    expect(body.invoice.reference).toMatch(/^RF\d\d/)
    expect(notices).toMatchObject([{ type: 'invoice', invoice: { number: body.invoice.number } }])
    expect((await usage(app)).plan).toBe('betrieb')
  })

  it('mit IBAN kein Auftrag von Hand', async () => {
    const { app } = setup()
    expect(((await (await post(app, '/billing/order', order)).json()) as any).manual).toBe(false)
  })

  it('Zahlung über die SCOR-Referenz eintragen geht wie mit QR-Rechnung', async () => {
    const { app } = setup({ manual: true })
    const { invoice } = (await (await post(app, '/billing/order', order)).json()) as any
    const internal = { 'Authorization': `Bearer ${INTERNAL}`, 'x-user-id': 'user-1', 'content-type': 'application/json' }
    const res = await app.request('/billing/paid', { method: 'POST', headers: internal, body: JSON.stringify({ key: invoice.reference, paidAt: '2026-10-02' }) })
    expect(res.status).toBe(200)
    expect((await usage(app)).billing.openInvoice).toBeNull()
  })
})
