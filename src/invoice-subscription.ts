/**
 * Jahresabo auf Rechnung (privat und Betriebe): bestellen, verlängern, Zahlung eintragen, stoppen. Reine Funktionen
 * auf `Subscription`, Datum immer als ISO-Tag. Regeln (find-jobs/akquise/abo-regeln.md): verbindlich erst mit der
 * Zahlung; das bezahlte Jahr beginnt nach der Testzeit; Zugang nach der Bestellung bis zur Zahlungsfrist, danach nur
 * mit bezahltem Jahr. Nach einem bezahlten Jahr kommt 30 Tage vor Ablauf eine Verlängerungsrechnung nach dem dann
 * aktuellen Fahrzeugstand als Angebot; nur wer sie zahlt, hat ein weiteres Jahr. Kein Kündigen durch den Kunden,
 * keine Rückzahlung; auf Wunsch stoppt der Betreiber weitere Rechnungen (`stopSubscription`).
 */
import type { InvoiceRecord, Order } from './invoice.ts'
import type { Subscription } from './stores/types.ts'
import { addDays, createInvoice, isoDate } from './invoice.ts'
import { planForVehicles } from './plans.ts'
import { TRIAL_DAYS } from './trial.ts'

export const RENEWAL_LEAD_DAYS = 30

// Index statt .at(-1): das Frontend importiert diese Datei mit älterem lib-Ziel (ES2020)
function lastInvoice(sub: Subscription): InvoiceRecord | undefined {
  const invoices = sub.invoices ?? []
  return invoices[invoices.length - 1]
}

/** Ende der bezahlten Laufzeit (ISO-Tag, exklusiv) oder undefined ohne Rechnung */
export function periodEnd(sub: Subscription): string | undefined {
  return lastInvoice(sub)?.periodEnd
}

/**
 * Zugang eines Rechnungs-Abos: in der Testzeit, in einem bezahlten Jahr und nach der ersten Bestellung (noch nichts
 * bezahlt) bis zur Zahlungsfrist der offenen Rechnung, damit niemand während der Zahlung gesperrt wird. Eine offene
 * Verlängerung gibt keinen Zugang über das bezahlte Jahr hinaus; eine späte Zahlung schaltet wieder frei.
 * Ohne Zugang zählt das Abo wie abgelaufen; alles andere bleibt, wie es ist.
 */
export function effectiveSubscription(sub: Subscription, today: string): Subscription {
  if (sub.billing !== 'invoice' || sub.status !== 'active')
    return sub
  return hasAccess(sub, today) ? sub : { ...sub, status: 'canceled' }
}

function hasAccess(sub: Subscription, today: string): boolean {
  const invoices = sub.invoices ?? []
  if (invoices.some(i => i.paidAt && today < i.periodEnd))
    return true
  const end = trialEnd(sub)
  if (end && today < end)
    return true
  return !invoices.some(i => i.paidAt) && invoices.some(i => today <= i.dueAt)
}

function trialEnd(existing: Subscription | null): string | undefined {
  if (!existing?.trialStartedAt)
    return undefined
  return addDays(isoDate(new Date(existing.trialStartedAt)), TRIAL_DAYS)
}

export function orderSubscription(args: { existing: Subscription | null, order: Order, userId: string, today: string, iban: string }):
  { sub: Subscription, invoice: InvoiceRecord } | { error: 'already_active' } {
  const { existing, order, userId, today, iban } = args
  if (existing && effectiveSubscription(existing, today).status === 'active')
    return { error: 'already_active' }
  const end = trialEnd(existing)
  const periodStart = end && end > today ? end : today
  const invoice = createInvoice({ userId, vehicles: order.vehicles, issueDate: today, periodStart, iban, audience: order.audience })
  const { vehicles, audience, ...billingAddress } = order
  const sub: Subscription = {
    plan: planForVehicles(vehicles, audience).id,
    audience,
    status: 'active',
    ...(existing?.trialStartedAt ? { trialStartedAt: existing.trialStartedAt } : {}),
    billing: 'invoice',
    billingAddress,
    vehicles,
    cancelAtPeriodEnd: false,
    invoices: [invoice],
  }
  return { sub, invoice }
}

/**
 * Keine weiteren Rechnungen (Admin, wenn der Kunde schreibt; einen Kündigen-Knopf gibt es nicht, weil erst die
 * Zahlung bindet und nichts zurückbezahlt wird). Offene Rechnungen fallen weg (`voided`), keine Verlängerung mehr;
 * das bezahlte Jahr läuft zu Ende. Bleibt keine Rechnung übrig, endet das Abo und die Testzeit gilt wieder.
 */
export function stopSubscription(sub: Subscription): { sub: Subscription, voided: InvoiceRecord[] } {
  const invoices = sub.invoices ?? []
  const voided = invoices.filter(i => !i.paidAt)
  const kept = invoices.filter(i => i.paidAt)
  const next: Subscription = { ...sub, cancelAtPeriodEnd: true, invoices: kept }
  if (!kept.length)
    next.status = 'canceled'
  return { sub: next, voided }
}

/**
 * Kontolöschung: ein Abo mit gestellten Rechnungen bleibt als Buchhaltungsbeleg (Aufbewahrungspflicht, AGB),
 * aber gekündigt und ohne Verlängerung. Ohne Rechnungen (Testzeit, Stripe ohne Beleg) gibt es nichts zu behalten: null.
 */
export function retireSubscription(sub: Subscription | null): Subscription | null {
  if (!sub?.invoices?.length)
    return null
  return { ...sub, status: 'canceled', cancelAtPeriodEnd: true }
}

/** Verlängerungsrechnung (ein Angebot) 30 Tage vor Ablauf, nur nach einem bezahlten Jahr */
export function renewalDue(sub: Subscription, today: string): boolean {
  if (sub.billing !== 'invoice' || sub.status !== 'active' || sub.cancelAtPeriodEnd)
    return false
  const last = lastInvoice(sub)
  if (!last?.paidAt)
    return false
  return addDays(last.periodEnd, -RENEWAL_LEAD_DAYS) <= today && last.periodEnd > today
}

export function renewSubscription(args: { sub: Subscription, userId: string, vehicles: number, today: string, iban: string }): Subscription {
  const { sub, userId, today, iban } = args
  const vehicles = Math.max(1, args.vehicles)
  // Die Preisliste bleibt die des Kunden; Abos aus der Zeit vor den Privatabos haben kein Feld und sind Betriebe
  const audience = sub.audience ?? 'betrieb'
  const invoice = createInvoice({ userId, vehicles, issueDate: today, periodStart: periodEnd(sub)!, iban, audience })
  return { ...sub, vehicles, plan: planForVehicles(vehicles, audience).id, invoices: [...(sub.invoices ?? []), invoice] }
}

/**
 * Zahlung eintragen, gefunden über Referenz oder Rechnungsnummer (Leerzeichen egal). Mit `amount` wird nur der volle
 * Rechnungsbetrag gebucht: eine Teilzahlung oder ein falscher Betrag wirft, damit sie gemeldet statt verbucht wird.
 * `bankRef` ist die Buchungsreferenz der Bank (`AcctSvcrRef` aus camt.054) und verhindert doppeltes Verbuchen
 * derselben Datei.
 */
export function markInvoicePaid(sub: Subscription, key: string, paidAt: string, opts: { amount?: number, bankRef?: string } = {}): Subscription {
  const wanted = key.replace(/\s/g, '').toUpperCase()
  const invoices = sub.invoices ?? []
  const index = invoices.findIndex(i => i.reference === wanted || i.number === wanted)
  if (index < 0)
    throw new Error(`Keine Rechnung mit Referenz oder Nummer ${key}`)
  const invoice = invoices[index]!
  if (invoice.paidAt) {
    if (opts.bankRef && invoice.bankRef === opts.bankRef)
      throw new Error(`Buchung ${opts.bankRef} ist bereits verbucht (Rechnung ${invoice.number})`)
    throw new Error(`Rechnung ${invoice.number} ist seit ${invoice.paidAt} bezahlt`)
  }
  if (opts.amount !== undefined && Math.abs(opts.amount - invoice.amount) >= 0.005)
    throw new Error(`Betrag ${opts.amount.toFixed(2)} weicht von Rechnung ${invoice.number} über ${invoice.amount.toFixed(2)} ab`)
  const paid = { ...invoice, paidAt, ...(opts.bankRef ? { bankRef: opts.bankRef } : {}) }
  return { ...sub, invoices: invoices.map((inv, i) => (i === index ? paid : inv)) }
}

/**
 * Offene Rechnung, an die heute erinnert wird: einmal am Fälligkeitstag, dem letzten Tag der Zahlungsfrist. Nach
 * `stopSubscription` sind offene Rechnungen weg, bezahlte brauchen keine Erinnerung.
 */
export function reminderDue(sub: Subscription, today: string): InvoiceRecord | undefined {
  if (sub.billing !== 'invoice' || sub.status !== 'active')
    return undefined
  return openInvoices(sub).find(i => i.dueAt === today && !i.remindedAt)
}

export function markReminded(sub: Subscription, number: string, today: string): Subscription {
  return { ...sub, invoices: (sub.invoices ?? []).map(i => (i.number === number ? { ...i, remindedAt: today } : i)) }
}

export function openInvoices(sub: Subscription): InvoiceRecord[] {
  return (sub.invoices ?? []).filter(i => !i.paidAt)
}

export function overdueInvoices(sub: Subscription, today: string): InvoiceRecord[] {
  return openInvoices(sub).filter(i => i.dueAt < today)
}
