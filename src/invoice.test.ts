import { isQRReferenceValid, isSCORReferenceValid } from 'swissqrbill/utils'
import { describe, expect, it } from 'vitest'
import { addYears, createInvoice, invoiceNumber, invoiceReference, parseOrder, splitStreet } from './invoice.ts'

const IBAN = 'CH93 0076 2011 6238 5295 7'
const QR_IBAN = 'CH44 3199 9123 0008 8901 2'

const validOrder = {
  company: 'Muster Sanitär AG',
  contact: 'Petra Muster',
  street: 'Hauptstrasse 12',
  zip: '9000',
  city: 'St. Gallen',
  email: 'buchhaltung@muster.ch',
  reference: 'KST 4711',
  vehicles: 5,
  acceptTerms: true,
}

describe('parseOrder', () => {
  it('nimmt eine vollständige Bestellung an und trimmt die Felder', () => {
    const result = parseOrder({ ...validOrder, company: '  Muster Sanitär AG ' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.order.company).toBe('Muster Sanitär AG')
      expect(result.order.vehicles).toBe(5)
      expect(result.order.reference).toBe('KST 4711')
    }
  })

  it('Referenz ist freiwillig', () => {
    const { reference: _, ...rest } = validOrder
    const result = parseOrder(rest)
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.order.reference).toBeUndefined()
  })

  it('meldet fehlende Pflichtfelder einzeln', () => {
    const result = parseOrder({ ...validOrder, company: '', street: ' ', email: 'kein-mail' })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(['company', 'email', 'street'])
  })

  it('verlangt eine Schweizer PLZ mit vier Ziffern', () => {
    const result = parseOrder({ ...validOrder, zip: '900' })
    expect(result.ok).toBe(false)
  })

  it('verlangt mindestens ein ganzes Fahrzeug', () => {
    expect(parseOrder({ ...validOrder, vehicles: 0 }).ok).toBe(false)
    expect(parseOrder({ ...validOrder, vehicles: 2.5 }).ok).toBe(false)
    expect(parseOrder({ ...validOrder, vehicles: '3' }).ok).toBe(true)
  })

  it('ohne Zustimmung zu den Bedingungen keine Bestellung', () => {
    const result = parseOrder({ ...validOrder, acceptTerms: false })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.acceptTerms).toBeTruthy()
  })

  it('kein Objekt ergibt Fehler statt Absturz', () => {
    expect(parseOrder(null).ok).toBe(false)
    expect(parseOrder('x').ok).toBe(false)
  })
})

describe('addYears', () => {
  it('rechnet ohne Zeitzone und klammert den 29. Februar', () => {
    expect(addYears('2026-09-19', 1)).toBe('2027-09-19')
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28')
  })
})

describe('invoiceNumber', () => {
  it('ist lesbar, eindeutig pro Nutzer und Tag und stabil', () => {
    const a = invoiceNumber('user-a', '2026-09-19')
    expect(a).toMatch(/^WH-20260919-[0-9A-Z]{6}$/)
    expect(invoiceNumber('user-a', '2026-09-19')).toBe(a)
    expect(invoiceNumber('user-b', '2026-09-19')).not.toBe(a)
    expect(invoiceNumber('user-a', '2027-09-19')).not.toBe(a)
  })
})

describe('invoiceReference', () => {
  it('gewöhnliche IBAN: gültige SCOR-Referenz (ISO 11649)', () => {
    const ref = invoiceReference('WH-20260919-ABC123', IBAN)
    expect(ref).toMatch(/^RF\d{2}/)
    expect(isSCORReferenceValid(ref)).toBe(true)
  })

  it('QR-IBAN: gültige QR-Referenz mit 27 Ziffern', () => {
    const ref = invoiceReference('WH-20260919-ABC123', QR_IBAN)
    expect(ref).toMatch(/^\d{27}$/)
    expect(isQRReferenceValid(ref)).toBe(true)
  })

  it('verschiedene Rechnungen ergeben verschiedene Referenzen', () => {
    expect(invoiceReference('WH-20260919-ABC123', QR_IBAN)).not.toBe(invoiceReference('WH-20260919-ABC124', QR_IBAN))
  })
})

describe('createInvoice', () => {
  it('Betrieb: 36 CHF pro Fahrzeug, ein Jahr Laufzeit, zahlbar in 30 Tagen', () => {
    const invoice = createInvoice({ userId: 'user-a', vehicles: 5, issueDate: '2026-09-19', periodStart: '2026-10-10', iban: IBAN })
    expect(invoice).toMatchObject({
      number: invoiceNumber('user-a', '2026-09-19'),
      amount: 180,
      vehicles: 5,
      issuedAt: '2026-09-19',
      dueAt: '2026-10-19',
      periodStart: '2026-10-10',
      periodEnd: '2027-10-10',
    })
    expect(isSCORReferenceValid(invoice.reference)).toBe(true)
    expect(invoice.paidAt).toBeUndefined()
  })
})

describe('splitStreet', () => {
  it('trennt die Hausnummer vom Strassennamen', () => {
    expect(splitStreet('Bahnstrasse 9b')).toEqual({ street: 'Bahnstrasse', buildingNumber: '9b' })
    expect(splitStreet('Hauptstrasse 12')).toEqual({ street: 'Hauptstrasse', buildingNumber: '12' })
    expect(splitStreet('Route de Berne 3-5')).toEqual({ street: 'Route de Berne', buildingNumber: '3-5' })
    expect(splitStreet('Im Feld 17 A')).toEqual({ street: 'Im Feld', buildingNumber: '17 A' })
    expect(splitStreet('Chemin des Vignes 4/2')).toEqual({ street: 'Chemin des Vignes', buildingNumber: '4/2' })
  })

  it('lässt eine Adresse ohne Hausnummer unangetastet', () => {
    expect(splitStreet('Postfach')).toEqual({ street: 'Postfach' })
    expect(splitStreet('Postfach 1234')).toEqual({ street: 'Postfach 1234' })
    expect(splitStreet('')).toEqual({ street: '' })
  })

  it('räumt Leerzeichen und ein Komma vor der Nummer weg', () => {
    expect(splitStreet('  Bahnstrasse ,  9b ')).toEqual({ street: 'Bahnstrasse', buildingNumber: '9b' })
  })
})

describe('parseOrder: Privatkunde', () => {
  const privateOrder = {
    audience: 'privat',
    contact: 'Anna Beispiel',
    street: 'Dorfstrasse 4',
    zip: '9000',
    city: 'St. Gallen',
    email: 'anna@beispiel.ch',
    vehicles: 2,
    acceptTerms: true,
  }

  it('nimmt eine Bestellung ohne Firma an, der Name trägt die Rechnung', () => {
    const result = parseOrder(privateOrder)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.order.audience).toBe('privat')
      expect(result.order.contact).toBe('Anna Beispiel')
      expect(result.order.company).toBe('')
    }
  })

  it('verlangt den Namen', () => {
    const result = parseOrder({ ...privateOrder, contact: ' ' })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.contact).toBeTruthy()
  })

  it('ohne Angabe bleibt es eine Bestellung für Betriebe, dort ist die Firma Pflicht', () => {
    const result = parseOrder({ ...privateOrder, audience: undefined })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.company).toBeTruthy()
  })
})

describe('createInvoice für Privatkunden', () => {
  it('25 CHF im Jahr bis fünf Fahrzeuge', () => {
    const invoice = createInvoice({ userId: 'user-p', vehicles: 3, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: IBAN, audience: 'privat' })
    expect(invoice.amount).toBe(25)
    expect(invoice.audience).toBe('privat')
  })

  it('ab sechs Fahrzeugen gilt der Preis pro Fahrzeug', () => {
    const invoice = createInvoice({ userId: 'user-p', vehicles: 6, issueDate: '2026-09-20', periodStart: '2026-09-20', iban: IBAN, audience: 'privat' })
    expect(invoice.amount).toBe(216)
  })
})
