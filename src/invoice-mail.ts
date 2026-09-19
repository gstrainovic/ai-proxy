/**
 * Versand der Jahresrechnung über Resend: PDF an die Rechnungs-E-Mail des Kunden, Betreiber in Bcc, Antworten an
 * die Kontaktadresse. Stornos (Kündigung vor Beginn eines Jahres) gehen als kurze Mail ohne Anhang.
 * Genutzt vom Proxy (Bestellung, Kündigung) und vom Verlängerungs-Job.
 */
import type { InvoiceNotice } from './app.ts'
import type { Creditor, InvoiceRecord } from './invoice.ts'
import { Buffer } from 'node:buffer'
import { addDays } from './invoice.ts'
import { formatChf, formatDay, renderInvoicePdf } from './invoice-pdf.ts'

export interface ResendNotifierConfig {
  token: string
  /** Absender, z. B. `Wartungsheft <rechnung@wartungsheft.ch>` */
  from: string
  /** Kopie an den Betreiber */
  bcc: string
  creditor: Creditor
  /** Link auf die App (Einstellungen) im Mailtext */
  appUrl: string
  fetch?: typeof fetch
}

function invoiceText(invoice: InvoiceRecord, creditor: Creditor, appUrl: string, contact: string): string {
  return [
    `Guten Tag ${contact}`,
    '',
    `im Anhang die Rechnung ${invoice.number} für ${creditor.brand ?? 'Wartungsheft'}, Jahresabo Betrieb mit ${invoice.vehicles} ${invoice.vehicles === 1 ? 'Fahrzeug' : 'Fahrzeugen'}, `
    + `Laufzeit ${formatDay(invoice.periodStart)} bis ${formatDay(addDays(invoice.periodEnd, -1))}.`,
    '',
    `Betrag: ${formatChf(invoice.amount)}, zahlbar bis ${formatDay(invoice.dueAt)} mit dem QR-Zahlteil im PDF.`,
    '',
    `Das Abo verlängert sich jeweils um ein Jahr. Kündigen geht bis zum Ablauf ohne Frist, in der App unter Einstellungen (${appUrl}/settings) oder mit einer Antwort auf diese Mail.`,
    '',
    'Freundliche Grüsse',
    creditor.tradeName ? `${creditor.name}, ${creditor.tradeName}` : creditor.name,
    [creditor.email, creditor.website].filter(Boolean).join(' · '),
  ].join('\n')
}

function voidedText(invoices: InvoiceRecord[], creditor: Creditor, contact: string): string {
  return [
    `Guten Tag ${contact}`,
    '',
    'Ihre Kündigung ist eingegangen. Diese Rechnungen sind storniert, bitte nicht bezahlen:',
    ...invoices.map(i => `- ${i.number} über ${formatChf(i.amount)}`),
    '',
    'Freundliche Grüsse',
    creditor.tradeName ? `${creditor.name}, ${creditor.tradeName}` : creditor.name,
  ].join('\n')
}

export function createResendNotifier(config: ResendNotifierConfig): (notice: InvoiceNotice) => Promise<void> {
  const fetchFn = config.fetch ?? fetch

  async function send(payload: Record<string, unknown>, idempotencyKey: string) {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from: config.from, bcc: [config.bcc], reply_to: config.creditor.email, ...payload }),
    })
    if (!res.ok)
      throw new Error(`Resend ${res.status}: ${await res.text()}`)
  }

  return async (notice) => {
    const address = notice.sub.billingAddress
    if (!address)
      throw new Error(`Abo von ${notice.userId} hat keine Rechnungsadresse`)
    const brand = config.creditor.brand ?? 'Wartungsheft'
    if (notice.type === 'invoice') {
      const pdf = await renderInvoicePdf({ creditor: config.creditor, address, invoice: notice.invoice })
      await send({
        to: [address.email],
        subject: `Rechnung ${notice.invoice.number}, ${brand} Jahresabo`,
        text: invoiceText(notice.invoice, config.creditor, config.appUrl, address.contact),
        attachments: [{ filename: `Rechnung-${notice.invoice.number}.pdf`, content: Buffer.from(pdf).toString('base64') }],
      }, `invoice-${notice.invoice.number}`)
      return
    }
    await send({
      to: [address.email],
      subject: `${brand}: Rechnung storniert`,
      text: voidedText(notice.invoices, config.creditor, address.contact),
    }, `voided-${notice.invoices.map(i => i.number).join('-')}`)
  }
}
