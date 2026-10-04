import type { Creditor } from './invoice-pdf.ts'
import { describe, expect, it } from 'vitest'
import { createInvoice } from './invoice.ts'
import { formatChf, formatDay, invoiceLines, qrBillData, qrBillLanguage, renderInvoicePdf } from './invoice-pdf.ts'
import { invoiceTexts } from './invoice-texts.ts'

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

describe('formatChf / formatDay je Sprache', () => {
  it('en mit Komma und Schrägstrich, fr und it wie de', () => {
    expect(formatChf(1234.5, 'en')).toBe('CHF 1,234.50')
    expect(formatChf(1234.5, 'fr')).toBe('CHF 1\'234.50')
    expect(formatDay('2026-09-19', 'en')).toBe('19/09/2026')
    expect(formatDay('2026-09-19', 'it')).toBe('19.09.2026')
  })
})

describe('Rechnung in der Sprache des Bestellers', () => {
  const invoice = createInvoice({ userId: 'user-a', vehicles: 3, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban })
  const privat = createInvoice({ userId: 'user-p', vehicles: 2, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban, audience: 'privat' })

  it('positionen auf Französisch, Italienisch und Englisch', () => {
    expect(invoiceLines(invoice, 'Wartungsheft', 'fr')).toEqual(['Abonnement annuel Wartungsheft Entreprise, du 20.09.2026 au 19.09.2027', '3 véhicules × CHF 36.00 par an'])
    expect(invoiceLines(privat, 'Wartungsheft', 'it')).toEqual(['Abbonamento annuale Wartungsheft Privato, dal 20.09.2026 al 19.09.2027', '2 veicoli, fino a 5 veicoli CHF 25.00 all\'anno'])
    expect(invoiceLines(invoice, 'Wartungsheft', 'en')).toEqual(['Wartungsheft annual subscription Business, 20/09/2026 to 19/09/2027', '3 vehicles × CHF 36.00 per year'])
  })

  it('mitteilung im QR-Zahlteil übersetzt', () => {
    expect(qrBillData({ creditor, address: { ...address, language: 'fr' }, invoice }).message).toBe(`Facture ${invoice.number}`)
    expect(qrBillData({ creditor, address: { ...address, language: 'it' }, invoice }).message).toBe(`Fattura ${invoice.number}`)
    expect(qrBillData({ creditor, address, invoice }).message).toBe(`Rechnung ${invoice.number}`)
  })

  it('zahlteil in der Sprache der Rechnung', () => {
    expect(qrBillLanguage('fr')).toBe('FR')
    expect(qrBillLanguage('en')).toBe('EN')
    expect(qrBillLanguage(undefined)).toBe('DE')
  })

  it('pDF entsteht in allen vier Sprachen', async () => {
    for (const language of ['de', 'fr', 'it', 'en'] as const) {
      const pdf = await renderInvoicePdf({ creditor, address: { ...address, language }, invoice })
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-')
    }
  })

  it('jede Sprache hat alle Texte, ohne ß', () => {
    for (const language of ['fr', 'it', 'en'] as const) {
      expect(Object.keys(invoiceTexts(language)).sort()).toEqual(Object.keys(invoiceTexts('de')).sort())
      expect(JSON.stringify(invoiceTexts(language))).not.toContain('ß')
    }
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

describe('qrBillData', () => {
  it('trägt Strasse und Hausnummer im Zahlteil getrennt ein', () => {
    const invoice = createInvoice({ userId: 'user-a', vehicles: 3, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban })
    const data = qrBillData({ creditor, address, invoice })
    expect(data.creditor).toMatchObject({ address: 'Bahnstrasse', buildingNumber: '9b', zip: '9323', city: 'Steinach' })
    expect(data.debtor).toMatchObject({ address: 'Hauptstrasse', buildingNumber: '12', zip: '9000', city: 'St. Gallen' })
    expect(data.amount).toBe(108)
    expect(data.reference).toBe(invoice.reference)
  })

  it('ohne Hausnummer bleibt die Zeile die Strasse', () => {
    const invoice = createInvoice({ userId: 'user-a', vehicles: 1, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban })
    const data = qrBillData({ creditor: { ...creditor, street: 'Postfach' }, address, invoice })
    expect(data.creditor.address).toBe('Postfach')
    expect(data.creditor.buildingNumber).toBeUndefined()
  })
})

describe('invoiceLines', () => {
  it('Betrieb: Fahrzeugzahl und Preis pro Fahrzeug', () => {
    const invoice = createInvoice({ userId: 'user-a', vehicles: 3, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban })
    const [title, detail] = invoiceLines(invoice, 'Wartungsheft')
    expect(title).toBe('Wartungsheft Jahresabo Betrieb, 20.09.2026 bis 19.09.2027')
    expect(detail).toBe('3 Fahrzeuge × CHF 36.00 pro Jahr')
  })

  it('Privat: ein Preis fürs Konto, Fahrzeuge als Zusatz', () => {
    const invoice = createInvoice({ userId: 'user-p', vehicles: 2, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban, audience: 'privat' })
    const [title, detail] = invoiceLines(invoice, 'Wartungsheft')
    expect(title).toBe('Wartungsheft Jahresabo Privat, 20.09.2026 bis 19.09.2027')
    expect(detail).toBe('2 Fahrzeuge, bis 5 Fahrzeuge CHF 25.00 im Jahr')
  })

  it('Privat mit mehr als fünf Fahrzeugen rechnet pro Fahrzeug ab', () => {
    const invoice = createInvoice({ userId: 'user-p', vehicles: 6, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: creditor.iban, audience: 'privat' })
    expect(invoiceLines(invoice, 'Wartungsheft')[1]).toBe('6 Fahrzeuge × CHF 36.00 pro Jahr')
  })
})
