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
    // Signatur mehrzeilig, keine Zeile mit Mail und Website zusammen (Outlook zieht Textzeilen zusammen)
    expect(body.text).toContain('Freundliche Grüsse\nGoran Strainovic\n\nWartungsheft\nStrainovic IT\nBahnstrasse 9b\n9323 Steinach\ninfo@wartungsheft.ch\nwww.wartungsheft.ch')
    expect(body.text).not.toContain(' · ')
    expect(body.html).toContain('Strainovic IT<br>\nBahnstrasse 9b<br>\n9323 Steinach<br>')
    expect(body.attachments[0].filename).toBe(`Rechnung-${invoice.number}.pdf`)
    expect(Buffer.from(body.attachments[0].content, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('meldet stornierte Rechnungen ohne Anhang', async () => {
    const { calls, fetchFn } = capture()
    const notify = createResendNotifier({ token: 're_test', from: 'x <r@wartungsheft.ch>', bcc: 'info@wartungsheft.ch', creditor, appUrl: 'https://wartungsheft.ch', fetch: fetchFn })
    await notify({ type: 'voided', userId: 'user-a', sub, invoices: [invoice] })
    expect(calls[0]!.body.subject).toContain('storniert')
    expect(calls[0]!.body.text).toContain(invoice.number)
    expect(calls[0]!.body.text).toContain('Goran Strainovic\n\nWartungsheft\nStrainovic IT\nBahnstrasse 9b\n9323 Steinach\n')
    expect(calls[0]!.body.html).toContain(invoice.number)
    expect(calls[0]!.body.attachments).toBeUndefined()
  })

  it('schreibt Rechnung und Storno in der Sprache der Rechnungsadresse', async () => {
    const expected = {
      fr: { subject: `Facture ${invoice.number}, abonnement annuel Wartungsheft`, hallo: 'Bonjour Petra Muster', datei: `Facture-${invoice.number}.pdf`, storno: 'Wartungsheft\u00A0: facture annulée', gruss: 'Meilleures salutations' },
      it: { subject: `Fattura ${invoice.number}, abbonamento annuale Wartungsheft`, hallo: 'Buongiorno Petra Muster', datei: `Fattura-${invoice.number}.pdf`, storno: 'Wartungsheft: fattura annullata', gruss: 'Cordiali saluti' },
      en: { subject: `Invoice ${invoice.number}, Wartungsheft annual subscription`, hallo: 'Hello Petra Muster', datei: `Invoice-${invoice.number}.pdf`, storno: 'Wartungsheft: invoice cancelled', gruss: 'Kind regards' },
    }
    for (const [language, e] of Object.entries(expected)) {
      const { calls, fetchFn } = capture()
      const notify = createResendNotifier({ token: 're_test', from: 'x <r@wartungsheft.ch>', bcc: 'info@wartungsheft.ch', creditor, appUrl: 'https://wartungsheft.ch', fetch: fetchFn })
      const localized: Subscription = { ...sub, billingAddress: { ...sub.billingAddress!, language: language as 'fr' } }
      await notify({ type: 'invoice', userId: 'user-a', sub: localized, invoice })
      await notify({ type: 'voided', userId: 'user-a', sub: localized, invoices: [invoice] })
      expect(calls[0]!.body.subject).toBe(e.subject)
      expect(calls[0]!.body.text.startsWith(e.hallo)).toBe(true)
      expect(calls[0]!.body.text).toContain(`${e.gruss}\nGoran Strainovic`)
      expect(calls[0]!.body.text).not.toContain('Rechnung')
      expect(calls[0]!.body.attachments[0].filename).toBe(e.datei)
      expect(calls[1]!.body.subject).toBe(e.storno)
      expect(calls[1]!.body.text).toContain(invoice.number)
    }
  })

  it('Fehler von Resend wirft', async () => {
    const { fetchFn } = capture(422)
    const notify = createResendNotifier({ token: 're_test', from: 'x <r@wartungsheft.ch>', bcc: 'info@wartungsheft.ch', creditor, appUrl: 'https://wartungsheft.ch', fetch: fetchFn })
    await expect(notify({ type: 'invoice', userId: 'user-a', sub, invoice })).rejects.toThrow(/422/)
  })
})
