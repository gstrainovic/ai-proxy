import type { Creditor } from './invoice-pdf.ts'
import { describe, expect, it } from 'vitest'
import { createInvoice } from './invoice.ts'
import { formatChf, formatDay, renderInvoicePdf } from './invoice-pdf.ts'

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

const address = { company: 'Muster Sanitär AG', contact: 'Petra Muster', street: 'Hauptstrasse 12', zip: '9000', city: 'St. Gallen', email: 'b@muster.ch', reference: 'KST 4711' }

describe('formatChf / formatDay', () => {
  it('Schweizer Schreibweise', () => {
    expect(formatChf(180)).toBe('CHF 180.00')
    expect(formatChf(1234.5)).toBe('CHF 1\'234.50')
    expect(formatDay('2026-09-19')).toBe('19.09.2026')
  })
})

describe('renderInvoicePdf', () => {
  it('erzeugt ein PDF mit QR-Zahlteil', async () => {
    const invoice = createInvoice({ userId: 'user-a', vehicles: 5, issueDate: '2026-09-19', periodStart: '2026-09-19', iban: creditor.iban })
    const pdf = await renderInvoicePdf({ creditor, address, invoice })
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(5000)
  })

  it('QR-IBAN mit QR-Referenz geht ebenso', async () => {
    const qr = { ...creditor, iban: 'CH44 3199 9123 0008 8901 2' }
    const invoice = createInvoice({ userId: 'user-a', vehicles: 1, issueDate: '2026-09-19', periodStart: '2026-09-19', iban: qr.iban })
    await expect(renderInvoicePdf({ creditor: qr, address, invoice })).resolves.toBeInstanceOf(Uint8Array)
  })

  it('ungültige IBAN wirft, statt eine unbezahlbare Rechnung zu verschicken', async () => {
    const bad = { ...creditor, iban: 'CH00 0000 0000 0000 0000 0' }
    const invoice = createInvoice({ userId: 'user-a', vehicles: 1, issueDate: '2026-09-19', periodStart: '2026-09-19', iban: creditor.iban })
    await expect(renderInvoicePdf({ creditor: bad, address, invoice })).rejects.toThrow()
  })
})
