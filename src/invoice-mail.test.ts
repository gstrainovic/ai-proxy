import type { Creditor } from './invoice-pdf.ts'
import type { Subscription } from './stores/types.ts'
import { describe, expect, it } from 'vitest'
import { createInvoice } from './invoice.ts'
import { createResendNotifier } from './invoice-mail.ts'

const creditor: Creditor = {
  name: 'Goran Strainovic',
  tradeName: 'Strainovic IT',
  brand: 'Wartungsheft',
  street: 'Bahnstrasse 9b',
  zip: '9323',
  city: 'Steinach',
  iban: 'CH93 0076 2011 6238 5295 7',
  email: 'info@wartungsheft.ch',
  website: 'wartungsheft.ch',
}

const invoice = createInvoice({ userId: 'user-a', vehicles: 5, issueDate: '2026-09-19', periodStart: '2026-09-19', iban: creditor.iban })
const sub: Subscription = {
  plan: 'betrieb',
  status: 'active',
  billing: 'invoice',
  billingAddress: { company: 'Muster Sanitär AG', contact: 'Petra Muster', street: 'Hauptstrasse 12', zip: '9000', city: 'St. Gallen', email: 'b@muster.ch' },
  vehicles: 5,
  invoices: [invoice],
}

function capture(status = 200) {
  const calls: { url: string, headers: Record<string, string>, body: any }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ id: 'mail-1' }), { status })
  }) as typeof fetch
  return { calls, fetchFn }
}

describe('createResendNotifier', () => {
  it('schickt die Rechnung als PDF an die Rechnungsadresse, Betreiber in Bcc', async () => {
    const { calls, fetchFn } = capture()
    const notify = createResendNotifier({ token: 're_test', from: 'Wartungsheft <rechnung@wartungsheft.ch>', bcc: 'info@wartungsheft.ch', creditor, appUrl: 'https://wartungsheft.ch', fetch: fetchFn })
    await notify({ type: 'invoice', userId: 'user-a', sub, invoice })
    expect(calls).toHaveLength(1)
    const { url, headers, body } = calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(headers.Authorization).toBe('Bearer re_test')
    expect(headers['Idempotency-Key']).toBe(`invoice-${invoice.number}`)
    expect(body.to).toEqual(['b@muster.ch'])
    expect(body.bcc).toEqual(['info@wartungsheft.ch'])
    expect(body.reply_to).toBe('info@wartungsheft.ch')
    expect(body.subject).toContain(invoice.number)
    expect(body.text).toContain('CHF 180.00')
    expect(body.text).toContain('19.10.2026')
    expect(body.attachments[0].filename).toBe(`Rechnung-${invoice.number}.pdf`)
    expect(Buffer.from(body.attachments[0].content, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('meldet stornierte Rechnungen ohne Anhang', async () => {
    const { calls, fetchFn } = capture()
    const notify = createResendNotifier({ token: 're_test', from: 'x <r@wartungsheft.ch>', bcc: 'info@wartungsheft.ch', creditor, appUrl: 'https://wartungsheft.ch', fetch: fetchFn })
    await notify({ type: 'voided', userId: 'user-a', sub, invoices: [invoice] })
    expect(calls[0]!.body.subject).toContain('storniert')
    expect(calls[0]!.body.text).toContain(invoice.number)
    expect(calls[0]!.body.attachments).toBeUndefined()
  })

  it('Fehler von Resend wirft', async () => {
    const { fetchFn } = capture(422)
    const notify = createResendNotifier({ token: 're_test', from: 'x <r@wartungsheft.ch>', bcc: 'info@wartungsheft.ch', creditor, appUrl: 'https://wartungsheft.ch', fetch: fetchFn })
    await expect(notify({ type: 'invoice', userId: 'user-a', sub, invoice })).rejects.toThrow(/422/)
  })
})
