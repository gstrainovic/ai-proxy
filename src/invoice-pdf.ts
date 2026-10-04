/**
 * Rechnung als PDF: Kopf mit Marke und Absender, Rechnungsadresse im Fenster (C5 rechts), eine Position,
 * Zahlungsbedingungen und der Schweizer QR-Zahlteil (swissqrbill) unten. Ohne MWST: der Absender ist
 * nicht mehrwertsteuerpflichtig (Umsatz unter 100'000 CHF, business-plan Kapitel 6).
 * Nur Node (pdfkit); Edge-Builds importieren diese Datei nicht.
 */
import type { Data } from 'swissqrbill/types'
import type { BillingAddress, Creditor, InvoiceRecord } from './invoice.ts'
import type { InvoiceLanguage } from './invoice-texts.ts'
import { Buffer } from 'node:buffer'
import PDFDocument from 'pdfkit'
import { SwissQRBill } from 'swissqrbill/pdf'
import { formatReference, mm2pt } from 'swissqrbill/utils'
import { invoiceLanguage, invoiceTexts } from './invoice-texts.ts'
import { addDays, splitStreet } from './invoice.ts'
import { BUSINESS_VEHICLE_YEARLY_CHF, PRIVATE_MAX_VEHICLES, PRIVATE_YEARLY_CHF } from './plans.ts'

export type { Creditor } from './invoice.ts'

/** Betrag im Schweizer Format (CHF 1'234.50), englisch mit Komma (CHF 1,234.50) */
export function formatChf(amount: number, language: InvoiceLanguage = 'de'): string {
  const [whole, cents] = amount.toFixed(2).split('.')
  return `CHF ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, language === 'en' ? ',' : '\'')}.${cents}`
}

/** Datum als TT.MM.JJJJ, englisch TT/MM/JJJJ */
export function formatDay(iso: string, language: InvoiceLanguage = 'de'): string {
  const [y, m, d] = iso.split('-')
  const t = language === 'en' ? '/' : '.'
  return `${d}${t}${m}${t}${y}`
}

/** Sprache des QR-Zahlteils (swissqrbill) */
export function qrBillLanguage(language: unknown): 'DE' | 'FR' | 'IT' | 'EN' {
  return invoiceLanguage(language).toUpperCase() as 'DE' | 'FR' | 'IT' | 'EN'
}

function senderLine(c: Creditor): string {
  return c.tradeName ? `${c.name}, ${c.tradeName}` : c.name
}

/**
 * Die beiden Zeilen der Rechnungsposition: Titel mit Laufzeit, darunter die Rechnung des Betrags. Privatkunden
 * zahlen einen Preis fürs Konto, Betriebe pro Fahrzeug; ab sechs Fahrzeugen gilt auch privat der Fahrzeugpreis.
 */
export function invoiceLines(invoice: InvoiceRecord, brand: string, language: InvoiceLanguage = 'de'): [title: string, detail: string] {
  const t = invoiceTexts(language)
  const lastDay = addDays(invoice.periodEnd, -1)
  const audience = invoice.audience ?? 'betrieb'
  const label = audience === 'privat' ? t.privat : t.betrieb
  const vehicles = t.vehicles(invoice.vehicles)
  const perVehicle = t.perVehicle(vehicles, formatChf(BUSINESS_VEHICLE_YEARLY_CHF, language))
  const flat = t.flat(vehicles, PRIVATE_MAX_VEHICLES, formatChf(PRIVATE_YEARLY_CHF, language))
  return [
    t.title(brand, label, formatDay(invoice.periodStart, language), formatDay(lastDay, language)),
    audience === 'privat' && invoice.vehicles <= PRIVATE_MAX_VEHICLES ? flat : perVehicle,
  ]
}

/**
 * Daten des QR-Zahlteils. Strasse und Hausnummer stehen getrennt (`address` und `buildingNumber`), wie es die
 * Swiss Payment Standards verlangen: sonst erfasst die Post Einzahlungen am Schalter kostenpflichtig nach.
 */
export function qrBillData(args: { creditor: Creditor, address: BillingAddress, invoice: InvoiceRecord }): Data {
  const { creditor, address, invoice } = args
  const from = splitStreet(creditor.street)
  const to = splitStreet(address.street)
  return {
    amount: invoice.amount,
    currency: 'CHF',
    creditor: { account: creditor.iban, name: senderLine(creditor), address: from.street, buildingNumber: from.buildingNumber, zip: creditor.zip, city: creditor.city, country: 'CH' },
    // Ohne Firma zahlt eine Privatperson, dann trägt ihr Name den Zahlteil
    debtor: { name: address.company || address.contact, address: to.street, buildingNumber: to.buildingNumber, zip: address.zip, city: address.city, country: 'CH' },
    reference: invoice.reference,
    message: `${invoiceTexts(address.language).invoice} ${invoice.number}`,
  }
}

export async function renderInvoicePdf(args: { creditor: Creditor, address: BillingAddress, invoice: InvoiceRecord }): Promise<Uint8Array> {
  const { creditor, address, invoice } = args
  const language = invoiceLanguage(address.language)
  const t = invoiceTexts(language)
  // Zuerst den Zahlteil bauen: swissqrbill prüft IBAN, Referenz und Adressen und wirft bei Fehlern
  const qrBill = new SwissQRBill(qrBillData(args), { language: qrBillLanguage(language) })

  const doc = new PDFDocument({ size: 'A4', margin: mm2pt(20), info: { Title: `${t.invoice} ${invoice.number}`, Author: senderLine(creditor) } })
  const chunks: Uint8Array[] = []
  doc.on('data', (chunk: Uint8Array) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', reject)
  })

  const left = mm2pt(20)
  const width = mm2pt(170)

  // Kopf: Marke, darunter Absender (Pflicht: Name des Inhabers mit Geschäftsbezeichnung)
  if (creditor.brand)
    doc.font('Helvetica-Bold').fontSize(18).text(creditor.brand, left, mm2pt(15))
  doc.font('Helvetica').fontSize(9).fillColor('#444444')
    .text(senderLine(creditor), left, mm2pt(24))
    .text(`${creditor.street}, ${creditor.zip} ${creditor.city}`)
    .text([creditor.email, creditor.website].filter(Boolean).join(' · '))
  doc.fillColor('#000000')

  // Rechnungsadresse im rechten Fenster eines C5-Couverts; ohne Firma steht der Name allein (Privatkunden)
  doc.fontSize(11).text([address.company, address.contact, address.street, `${address.zip} ${address.city}`].filter(Boolean).join('\n'), mm2pt(118), mm2pt(50), { width: mm2pt(72) })

  // Titel und Eckdaten
  doc.font('Helvetica-Bold').fontSize(14).text(`${t.invoice} ${invoice.number}`, left, mm2pt(90))
  doc.font('Helvetica').fontSize(10).moveDown(0.5)
  const facts: [string, string][] = [
    [t.issuedAt, formatDay(invoice.issuedAt, language)],
    [t.dueAt, formatDay(invoice.dueAt, language)],
    [t.reference, formatReference(invoice.reference)],
  ]
  if (address.reference)
    facts.push([t.customerReference, address.reference])
  for (const [label, value] of facts) {
    const y = doc.y
    doc.text(label, left, y, { width: mm2pt(40) })
    doc.text(value, left + mm2pt(40), y)
  }

  // Position
  const [title, detail] = invoiceLines(invoice, creditor.brand ?? 'Wartungsheft', language)
  const tableTop = doc.y + mm2pt(8)
  doc.font('Helvetica-Bold').text(t.description, left, tableTop).text(t.amount, left, tableTop, { width, align: 'right' })
  doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor('#999999').stroke()
  const rowTop = doc.y + mm2pt(3)
  doc.font('Helvetica')
    .text(title, left, rowTop, { width: mm2pt(130) })
    .text(detail, { width: mm2pt(130) })
  doc.text(formatChf(invoice.amount, language), left, rowTop, { width, align: 'right' })
  const totalTop = doc.y + mm2pt(6)
  doc.moveTo(left, totalTop - 4).lineTo(left + width, totalTop - 4).stroke()
  doc.font('Helvetica-Bold').text(t.total, left, totalTop).text(formatChf(invoice.amount, language), left, totalTop, { width, align: 'right' })

  // Bedingungen
  doc.font('Helvetica').fontSize(9).fillColor('#444444').moveDown(1.5)
    .text(t.noVat, left)
    .text(t.terms(creditor.email), left, doc.y, { width })
  doc.fillColor('#000000')

  qrBill.attachTo(doc)
  doc.end()
  await done
  return Buffer.concat(chunks)
}
