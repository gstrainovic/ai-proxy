/**
 * Rechnung von Hand: Ohne INVOICE_IBAN kann der Proxy keine QR-Rechnung erzeugen, nimmt Bestellungen aber trotzdem
 * an. Das Abo entsteht wie sonst (Nummer, SCOR-Referenz, Betrag, Fälligkeit), statt des PDF an den Kunden geht ein
 * Auftrag an das Postfach des Betreibers, der die Rechnung selbst schreibt. Verlängerung und Storno ebenso.
 */
import type { InvoiceNotice } from './app.ts'
import type { BillingAddress, InvoiceRecord } from './invoice.ts'
import { createFeedbackNotifier } from './feedback.ts'
import { formatChf, formatDay, invoiceLines } from './invoice-pdf.ts'

export interface InvoiceRequestMail {
  subject: string
  text: string
  /** Antworten gehen direkt an den Kunden */
  replyTo: string | null
}

function addressLines(address: BillingAddress | undefined): string[] {
  if (!address)
    return ['(keine Rechnungsadresse gespeichert)']
  return [
    ...(address.company ? [address.company] : []),
    address.contact,
    address.street,
    `${address.zip} ${address.city}`,
    `E-Mail: ${address.email}`,
    ...(address.reference ? [`Referenz des Kunden: ${address.reference}`] : []),
  ]
}

function invoiceBlock(invoice: InvoiceRecord): string[] {
  const [title, detail] = invoiceLines(invoice, 'Wartungsheft')
  return [
    `Rechnungsnummer: ${invoice.number}`,
    `Zahlungsreferenz (SCOR): ${invoice.reference}`,
    `Position: ${title}`,
    `          ${detail}`,
    `Betrag: ${formatChf(invoice.amount)}, ohne MWST`,
    `Rechnungsdatum: ${formatDay(invoice.issuedAt)}, zahlbar bis ${formatDay(invoice.dueAt)}`,
  ]
}

/** Mail an den Betreiber: welche Rechnung er schreiben (oder stornieren) muss, mit allem, was darauf gehört */
export function invoiceRequestMail(notice: InvoiceNotice): InvoiceRequestMail {
  const address = notice.sub.billingAddress
  const customer = address?.company || address?.contact || notice.userId
  const footer = [
    '',
    '—',
    `Konto: ${notice.userId}`,
    'Diese Mail kommt, weil der Proxy ohne INVOICE_IBAN läuft und keine QR-Rechnung selbst verschickt.',
  ]

  if (notice.type === 'voided') {
    return {
      subject: `Wartungsheft: Rechnung stornieren — ${customer}`,
      text: [
        'Der Kunde hat gekündigt. Diese Rechnungen sind storniert; falls schon verschickt, bitte dem Kunden mitteilen:',
        '',
        ...notice.invoices.map(i => `- ${i.number} über ${formatChf(i.amount)} (Referenz ${i.reference})`),
        '',
        'Rechnungsadresse:',
        ...addressLines(address),
        ...footer,
      ].join('\n'),
      replyTo: address?.email ?? null,
    }
  }

  const renewal = (notice.sub.invoices?.length ?? 1) > 1
  return {
    subject: `Wartungsheft: Rechnung schreiben — ${customer}, ${formatChf(notice.invoice.amount)} (${renewal ? 'Verlängerung' : 'Bestellung'})`,
    text: [
      renewal
        ? 'Das Jahresabo verlängert sich. Bitte die Rechnung schreiben und an die Rechnungs-E-Mail schicken.'
        : 'Neue Bestellung eines Jahresabos. Bitte die Rechnung schreiben und an die Rechnungs-E-Mail schicken.',
      'Der Zugang läuft schon; Nummer und Referenz wie unten übernehmen, dann ordnet der Kontoauszug die Zahlung zu.',
      '',
      ...invoiceBlock(notice.invoice),
      '',
      'Rechnungsadresse:',
      ...addressLines(address),
      '',
      `Zahlung eintragen: billing.mjs paid ${notice.invoice.reference}`,
      ...footer,
    ].join('\n'),
    replyTo: address?.email ?? null,
  }
}

/** Versand an das Postfach des Betreibers, über Resend wie die Rückmeldungen */
export function createInvoiceRequestNotifier(config: { token: string, from: string, to: string, fetch?: typeof fetch }): (notice: InvoiceNotice) => Promise<void> {
  const send = createFeedbackNotifier(config)
  return notice => send(invoiceRequestMail(notice))
}
