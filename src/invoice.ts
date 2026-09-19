/**
 * Jahresrechnung für Betriebe (Rechnung auf die Firma, Schweizer QR-Rechnung, zahlbar in 30 Tagen).
 * Reine Funktionen: Bestellung prüfen, Rechnungsnummer und Zahlungsreferenz bilden, Rechnung anlegen.
 * PDF und Versand liegen in invoice-pdf.ts und invoice-mail.ts, der Ablauf des Abos in invoice-subscription.ts.
 */
import { calculateQRReferenceChecksum, calculateSCORReferenceChecksum, isQRIBAN } from 'swissqrbill/utils'
import { yearlyPriceChf } from './plans.ts'

export const PAYMENT_DAYS = 30

export interface BillingAddress {
  company: string
  contact: string
  street: string
  zip: string
  city: string
  /** Rechnungs-E-Mail, dorthin geht das PDF */
  email: string
  /** Referenz oder Kostenstelle des Kunden, erscheint auf der Rechnung */
  reference?: string
}

/** Rechnungssteller */
export interface Creditor {
  /** Inhaber (natürliche Person): Zahlungsempfänger im QR-Zahlteil */
  name: string
  /** Geschäftsbezeichnung, steht neben dem Namen */
  tradeName?: string
  /** Produktmarke im Kopf */
  brand?: string
  street: string
  zip: string
  city: string
  iban: string
  email: string
  website?: string
}

export interface Order extends BillingAddress {
  vehicles: number
}

export interface InvoiceRecord {
  number: string
  /** QR-Referenz (QR-IBAN) oder SCOR-Referenz (gewöhnliche IBAN) für den Zahlungsabgleich */
  reference: string
  amount: number
  vehicles: number
  /** ISO-Daten ohne Zeit */
  issuedAt: string
  dueAt: string
  periodStart: string
  periodEnd: string
  paidAt?: string
}

export type OrderField = keyof Order | 'acceptTerms'
export type ParseResult = { ok: true, order: Order } | { ok: false, errors: Partial<Record<OrderField, string>> }

const REQUIRED: [keyof BillingAddress, string][] = [
  ['company', 'Firma fehlt.'],
  ['contact', 'Kontaktperson fehlt.'],
  ['street', 'Strasse und Nummer fehlen.'],
  ['city', 'Ort fehlt.'],
]

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseOrder(body: unknown): ParseResult {
  if (!body || typeof body !== 'object')
    return { ok: false, errors: { company: 'Bestellung fehlt.' } }
  const b = body as Record<string, unknown>
  const errors: Partial<Record<OrderField, string>> = {}
  for (const [field, message] of REQUIRED) {
    if (!text(b[field]))
      errors[field] = message
  }
  const zip = text(b.zip)
  if (!/^\d{4}$/.test(zip))
    errors.zip = 'PLZ mit vier Ziffern angeben.'
  const email = text(b.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = 'Gültige E-Mail-Adresse für die Rechnung angeben.'
  const vehicles = Number(b.vehicles)
  if (!Number.isInteger(vehicles) || vehicles < 1)
    errors.vehicles = 'Mindestens ein Fahrzeug.'
  if (b.acceptTerms !== true)
    errors.acceptTerms = 'Bitte den Bedingungen zustimmen.'
  if (Object.keys(errors).length)
    return { ok: false, errors }
  const reference = text(b.reference)
  return {
    ok: true,
    order: {
      company: text(b.company),
      contact: text(b.contact),
      street: text(b.street),
      zip,
      city: text(b.city),
      email,
      ...(reference ? { reference } : {}),
      vehicles,
    },
  }
}

function parseIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y!, m!, d!]
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Jahre addieren ohne Zeitzone; der 29. Februar wird im Nicht-Schaltjahr zum 28. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = parseIso(iso)
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate()
  return toIso(y + years, m, Math.min(d, lastDay))
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parseIso(iso)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Kurzer, stabiler Schlüssel des Nutzers (FNV-1a, Basis 36), damit Rechnungsnummern ohne Zähler eindeutig sind */
function userKey(userId: string): string {
  let hash = 0x811C9DC5
  for (const char of userId) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(-6)
}

/** Rechnungsnummer `WH-<Datum>-<Nutzer>`: eine Rechnung pro Nutzer und Tag */
export function invoiceNumber(userId: string, issueDate: string): string {
  return `WH-${issueDate.replaceAll('-', '')}-${userKey(userId)}`
}

/**
 * Zahlungsreferenz aus der Rechnungsnummer: mit QR-IBAN eine QR-Referenz (27 Ziffern), sonst eine SCOR-Referenz
 * nach ISO 11649. Beide lassen sich im Kontoauszug (camt.054) der Rechnung zuordnen.
 */
export function invoiceReference(number: string, iban: string): string {
  const plain = number.replaceAll('-', '').toUpperCase()
  if (isQRIBAN(iban.replaceAll(' ', ''))) {
    const [, date = '', key = ''] = number.split('-')
    const digits = `${date}${Number.parseInt(key, 36).toString().padStart(10, '0')}`.padStart(26, '0')
    return `${digits}${calculateQRReferenceChecksum(digits)}`
  }
  return `RF${calculateSCORReferenceChecksum(plain)}${plain}`
}

export function createInvoice(args: { userId: string, vehicles: number, issueDate: string, periodStart: string, iban: string }): InvoiceRecord {
  const number = invoiceNumber(args.userId, args.issueDate)
  return {
    number,
    reference: invoiceReference(number, args.iban),
    amount: yearlyPriceChf(args.vehicles, 'betrieb'),
    vehicles: args.vehicles,
    issuedAt: args.issueDate,
    dueAt: addDays(args.issueDate, PAYMENT_DAYS),
    periodStart: args.periodStart,
    periodEnd: addYears(args.periodStart, 1),
  }
}
