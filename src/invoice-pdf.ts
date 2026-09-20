/**
 * Rechnung als PDF: Kopf mit Marke und Absender, Rechnungsadresse im Fenster (C5 rechts), eine Position,
 * Zahlungsbedingungen und der Schweizer QR-Zahlteil (swissqrbill) unten. Ohne MWST: der Absender ist
 * nicht mehrwertsteuerpflichtig (Umsatz unter 100'000 CHF, business-plan Kapitel 6).
 * Nur Node (pdfkit); Edge-Builds importieren diese Datei nicht.
 */
import type { Data } from 'swissqrbill/types'
import type { BillingAddress, Creditor, InvoiceRecord } from './invoice.ts'
import { Buffer } from 'node:buffer'
import PDFDocument from 'pdfkit'
import { SwissQRBill } from 'swissqrbill/pdf'
import { formatReference, mm2pt } from 'swissqrbill/utils'
import { addDays, splitStreet } from './invoice.ts'
import { BUSINESS_VEHICLE_YEARLY_CHF } from './plans.ts'

export type { Creditor } from './invoice.ts'

export function formatChf(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split('.')
  return `CHF ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '\'')}.${cents}`
}

export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function senderLine(c: Creditor): string {
  return c.tradeName ? `${c.name}, ${c.tradeName}` : c.name
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
    debtor: { name: address.company, address: to.street, buildingNumber: to.buildingNumber, zip: address.zip, city: address.city, country: 'CH' },
    reference: invoice.reference,
    message: `Rechnung ${invoice.number}`,
  }
}

export async function renderInvoicePdf(args: { creditor: Creditor, address: BillingAddress, invoice: InvoiceRecord }): Promise<Uint8Array> {
  const { creditor, address, invoice } = args
  // Zuerst den Zahlteil bauen: swissqrbill prüft IBAN, Referenz und Adressen und wirft bei Fehlern
  const qrBill = new SwissQRBill(qrBillData(args), { language: 'DE' })

  const doc = new PDFDocument({ size: 'A4', margin: mm2pt(20), info: { Title: `Rechnung ${invoice.number}`, Author: senderLine(creditor) } })
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

  // Rechnungsadresse im rechten Fenster eines C5-Couverts
  doc.fontSize(11).text([address.company, address.contact, address.street, `${address.zip} ${address.city}`].join('\n'), mm2pt(118), mm2pt(50), { width: mm2pt(72) })

  // Titel und Eckdaten
  doc.font('Helvetica-Bold').fontSize(14).text(`Rechnung ${invoice.number}`, left, mm2pt(90))
  doc.font('Helvetica').fontSize(10).moveDown(0.5)
  const facts: [string, string][] = [
    ['Rechnungsdatum', formatDay(invoice.issuedAt)],
    ['Zahlbar bis', formatDay(invoice.dueAt)],
    ['Referenz', formatReference(invoice.reference)],
  ]
  if (address.reference)
    facts.push(['Kundenreferenz', address.reference])
  for (const [label, value] of facts) {
    const y = doc.y
    doc.text(label, left, y, { width: mm2pt(40) })
    doc.text(value, left + mm2pt(40), y)
  }

  // Position
  const lastDay = addDays(invoice.periodEnd, -1)
  const tableTop = doc.y + mm2pt(8)
  doc.font('Helvetica-Bold').text('Beschreibung', left, tableTop).text('Betrag', left, tableTop, { width, align: 'right' })
  doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor('#999999').stroke()
  const rowTop = doc.y + mm2pt(3)
  doc.font('Helvetica')
    .text(`${creditor.brand ?? 'Wartungsheft'} Jahresabo Betrieb, ${formatDay(invoice.periodStart)} bis ${formatDay(lastDay)}`, left, rowTop, { width: mm2pt(130) })
    .text(`${invoice.vehicles} ${invoice.vehicles === 1 ? 'Fahrzeug' : 'Fahrzeuge'} × ${formatChf(BUSINESS_VEHICLE_YEARLY_CHF)} pro Jahr`, { width: mm2pt(130) })
  doc.text(formatChf(invoice.amount), left, rowTop, { width, align: 'right' })
  const totalTop = doc.y + mm2pt(6)
  doc.moveTo(left, totalTop - 4).lineTo(left + width, totalTop - 4).stroke()
  doc.font('Helvetica-Bold').text('Total', left, totalTop).text(formatChf(invoice.amount), left, totalTop, { width, align: 'right' })

  // Bedingungen
  doc.font('Helvetica').fontSize(9).fillColor('#444444').moveDown(1.5)
    .text('Ohne MWST: nicht mehrwertsteuerpflichtig.', left)
    .text(`Zahlbar innert 30 Tagen mit dem QR-Zahlteil unten. Das Abo verlängert sich jeweils um ein Jahr und ist bis zum Ablauf ohne Frist kündbar, in der App unter Einstellungen oder per Mail an ${creditor.email}.`, left, doc.y, { width })
  doc.fillColor('#000000')

  qrBill.attachTo(doc)
  doc.end()
  await done
  return Buffer.concat(chunks)
}
