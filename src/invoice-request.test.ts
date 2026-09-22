import type { InvoiceNotice } from './app.ts'
import type { Subscription } from './stores/types.ts'
import { describe, expect, it } from 'vitest'
import { createInvoice } from './invoice.ts'
import { createInvoiceRequestNotifier, invoiceRequestMail } from './invoice-request.ts'

const address = {
  company: 'Muster Sanitär AG',
  contact: 'Petra Muster',
  street: 'Hauptstrasse 12',
  zip: '9000',
  city: 'St. Gallen',
  email: 'buchhaltung@muster.ch',
  reference: 'KST 4711',
}

const invoice = createInvoice({ userId: 'user-1', vehicles: 5, issueDate: '2026-09-19', periodStart: '2026-10-19', iban: '', audience: 'betrieb' })

function sub(invoices = [invoice]): Subscription {
  return { plan: 'betrieb', status: 'active', billing: 'invoice', billingAddress: address, vehicles: 5, invoices }
}

describe('invoiceRequestMail', () => {
  it('Bestellung: alles, was auf die Rechnung gehört, Antwort an den Kunden', () => {
    const mail = invoiceRequestMail({ type: 'invoice', userId: 'user-1', sub: sub(), invoice })
    expect(mail.subject).toBe('Wartungsheft: Rechnung schreiben — Muster Sanitär AG, CHF 180.00 (Bestellung)')
    expect(mail.replyTo).toBe('buchhaltung@muster.ch')
    for (const part of [invoice.number, invoice.reference, 'CHF 180.00', '19.09.2026', '19.10.2026', '5 Fahrzeuge', 'Hauptstrasse 12', '9000 St. Gallen', 'KST 4711', 'user-1', `paid ${invoice.reference}`])
      expect(mail.text).toContain(part)
    expect(invoice.reference).toMatch(/^RF/)
  })

  it('zweite Rechnung heisst Verlängerung, Privat ohne Firma trägt den Namen', () => {
    const next = createInvoice({ userId: 'user-1', vehicles: 2, issueDate: '2027-09-19', periodStart: '2027-10-19', iban: '', audience: 'privat' })
    const privat = { ...sub([invoice, next]), billingAddress: { ...address, company: '' } }
    const mail = invoiceRequestMail({ type: 'invoice', userId: 'user-1', sub: privat, invoice: next })
    expect(mail.subject).toBe('Wartungsheft: Rechnung schreiben — Petra Muster, CHF 25.00 (Verlängerung)')
    expect(mail.text).toContain('Jahresabo Privat')
  })

  it('Storno nennt die Rechnungen, die nicht mehr gelten', () => {
    const mail = invoiceRequestMail({ type: 'voided', userId: 'user-1', sub: sub(), invoices: [invoice] })
    expect(mail.subject).toBe('Wartungsheft: Rechnung stornieren — Muster Sanitär AG')
    expect(mail.text).toContain(`- ${invoice.number} über CHF 180.00`)
  })
})

describe('createInvoiceRequestNotifier', () => {
  it('schickt den Auftrag über Resend an das Postfach des Betreibers', async () => {
    const calls: { url: string, body: any }[] = []
    const notify = createInvoiceRequestNotifier({
      token: 're_x',
      from: 'Wartungsheft <rueckmeldung@wartungsheft.ch>',
      to: 'info@wartungsheft.ch',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) })
        return new Response('{}')
      }) as unknown as typeof fetch,
    })
    const notice: InvoiceNotice = { type: 'invoice', userId: 'user-1', sub: sub(), invoice }
    await notify(notice)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect(calls[0]!.body).toMatchObject({ to: ['info@wartungsheft.ch'], reply_to: 'buchhaltung@muster.ch' })
    expect(calls[0]!.body.subject).toContain('Rechnung schreiben')
  })
})
