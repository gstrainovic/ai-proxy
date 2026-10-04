/**
 * Versand der Jahresrechnung über Resend: PDF an die Rechnungs-E-Mail des Kunden, Betreiber in Bcc, Antworten an
 * die Kontaktadresse. Stornos (Kündigung vor Beginn eines Jahres) gehen als kurze Mail ohne Anhang.
 * Genutzt vom Proxy (Bestellung, Kündigung) und vom Verlängerungs-Job.
 */
import type { InvoiceNotice } from './app.ts'
import type { Creditor, InvoiceRecord } from './invoice.ts'
import type { InvoiceLanguage } from './invoice-texts.ts'
import { Buffer } from 'node:buffer'
import { formatChf, formatDay, invoiceLines, renderInvoicePdf } from './invoice-pdf.ts'
import { invoiceLanguage, invoiceTexts } from './invoice-texts.ts'
import { textToHtml } from './mail-html.ts'

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

function invoiceText(invoice: InvoiceRecord, creditor: Creditor, appUrl: string, contact: string, language: InvoiceLanguage): string {
  const t = invoiceTexts(language)
  return [
    t.greeting(contact),
    '',
    t.mailIntro(invoice.number, invoiceLines(invoice, creditor.brand ?? 'Wartungsheft', language)[0], t.vehicles(invoice.vehicles)),
    '',
    t.mailAmount(formatChf(invoice.amount, language), formatDay(invoice.dueAt, language)),
    '',
    t.mailRenewal(`${appUrl}/settings`),
    '',
    ...signature(creditor, language),
  ].join('\n')
}

/** Standard-Signatur (Skill mailbox): jede Angabe auf eigener Zeile, Marke vor dem Einzelunternehmen, keine UID */
function signature(creditor: Creditor, language: InvoiceLanguage): string[] {
  const website = creditor.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return [
    invoiceTexts(language).regards,
    creditor.name,
    '',
    ...[creditor.brand, creditor.tradeName].filter((v): v is string => Boolean(v)),
    creditor.street,
    `${creditor.zip} ${creditor.city}`,
    creditor.email,
    ...(website ? [website.startsWith('www.') ? website : `www.${website}`] : []),
  ]
}

function voidedText(invoices: InvoiceRecord[], creditor: Creditor, contact: string, language: InvoiceLanguage): string {
  const t = invoiceTexts(language)
  return [
    t.greeting(contact),
    '',
    t.voidedIntro,
    ...invoices.map(i => t.voidedLine(i.number, formatChf(i.amount, language))),
    '',
    ...signature(creditor, language),
  ].join('\n')
}

export function createResendNotifier(config: ResendNotifierConfig): (notice: InvoiceNotice) => Promise<void> {
  const fetchFn = config.fetch ?? fetch

  async function send(payload: Record<string, unknown>, idempotencyKey: string) {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from: config.from, bcc: [config.bcc], reply_to: config.creditor.email, ...payload, html: textToHtml(String(payload.text)) }),
    })
    if (!res.ok)
      throw new Error(`Resend ${res.status}: ${await res.text()}`)
  }

  return async (notice) => {
    const address = notice.sub.billingAddress
    if (!address)
      throw new Error(`Abo von ${notice.userId} hat keine Rechnungsadresse`)
    const brand = config.creditor.brand ?? 'Wartungsheft'
    // Sprache aus der Bestellung, steht an der Rechnungsadresse und gilt auch für Verlängerung und Storno
    const language = invoiceLanguage(address.language)
    const t = invoiceTexts(language)
    if (notice.type === 'invoice') {
      const pdf = await renderInvoicePdf({ creditor: config.creditor, address, invoice: notice.invoice })
      await send({
        to: [address.email],
        subject: t.mailSubject(notice.invoice.number, brand),
        text: invoiceText(notice.invoice, config.creditor, config.appUrl, address.contact, language),
        attachments: [{ filename: `${t.invoice}-${notice.invoice.number}.pdf`, content: Buffer.from(pdf).toString('base64') }],
      }, `invoice-${notice.invoice.number}`)
      return
    }
    await send({
      to: [address.email],
      subject: t.voidedSubject(brand),
      text: voidedText(notice.invoices, config.creditor, address.contact, language),
    }, `voided-${notice.invoices.map(i => i.number).join('-')}`)
  }
}
