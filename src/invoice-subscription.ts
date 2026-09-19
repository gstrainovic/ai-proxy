/**
 * Jahresabo auf Rechnung (Betriebe): bestellen, kündigen, verlängern, Zahlung eintragen. Reine Funktionen auf
 * `Subscription`, Datum immer als ISO-Tag. Regeln: Zugang ab Bestellung, bezahltes Jahr beginnt nach der Testzeit,
 * verlängert sich jährlich mit Rechnung 30 Tage vor Ablauf nach dem dann aktuellen Fahrzeugstand, kündbar bis zum
 * Ablauf ohne Frist. Eine offene Verlängerung, deren Jahr noch nicht begonnen hat, wird bei Kündigung storniert.
 */
import type { InvoiceRecord, Order } from './invoice.ts'
import type { Subscription } from './stores/types.ts'
import { addDays, createInvoice, isoDate } from './invoice.ts'
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

/** Rechnungs-Abo nach Ablauf der Laufzeit zählt wie abgelaufen; alles andere bleibt, wie es ist */
export function effectiveSubscription(sub: Subscription, today: string): Subscription {
  if (sub.billing !== 'invoice' || sub.status !== 'active')
    return sub
  const end = periodEnd(sub)
  if (end && end > today)
    return sub
  return { ...sub, status: 'canceled' }
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
  const invoice = createInvoice({ userId, vehicles: order.vehicles, issueDate: today, periodStart, iban })
  const { vehicles, ...billingAddress } = order
  const sub: Subscription = {
    plan: 'betrieb',
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
 * Kündigung auf Ende der Laufzeit. Offene Rechnungen, deren Jahr noch nicht begonnen hat, fallen weg (`voided`);
 * bleibt keine Rechnung übrig, endet das Abo sofort und die Testzeit gilt wieder.
 */
export function cancelSubscription(sub: Subscription, today: string): { sub: Subscription, voided: InvoiceRecord[] } {
  const invoices = sub.invoices ?? []
  const voided = invoices.filter(i => !i.paidAt && i.periodStart > today)
  const kept = invoices.filter(i => !voided.includes(i))
  const next: Subscription = { ...sub, cancelAtPeriodEnd: true, invoices: kept }
  if (!kept.length)
    next.status = 'canceled'
  return { sub: next, voided }
}

export function resumeSubscription(sub: Subscription): Subscription {
  return { ...sub, cancelAtPeriodEnd: false }
}

export function renewalDue(sub: Subscription, today: string): boolean {
  if (sub.billing !== 'invoice' || sub.status !== 'active' || sub.cancelAtPeriodEnd)
    return false
  const end = periodEnd(sub)
  return !!end && addDays(end, -RENEWAL_LEAD_DAYS) <= today && end > today
}

export function renewSubscription(args: { sub: Subscription, userId: string, vehicles: number, today: string, iban: string }): Subscription {
  const { sub, userId, today, iban } = args
  const vehicles = Math.max(1, args.vehicles)
  const invoice = createInvoice({ userId, vehicles, issueDate: today, periodStart: periodEnd(sub)!, iban })
  return { ...sub, vehicles, invoices: [...(sub.invoices ?? []), invoice] }
}

/** Zahlung eintragen, gefunden über Referenz oder Rechnungsnummer (Leerzeichen egal) */
export function markInvoicePaid(sub: Subscription, key: string, paidAt: string): Subscription {
  const wanted = key.replace(/\s/g, '').toUpperCase()
  const invoices = sub.invoices ?? []
  const index = invoices.findIndex(i => i.reference === wanted || i.number === wanted)
  if (index < 0)
    throw new Error(`Keine Rechnung mit Referenz oder Nummer ${key}`)
  return { ...sub, invoices: invoices.map((inv, i) => (i === index ? { ...inv, paidAt } : inv)) }
}

export function openInvoices(sub: Subscription): InvoiceRecord[] {
  return (sub.invoices ?? []).filter(i => !i.paidAt)
}

export function overdueInvoices(sub: Subscription, today: string): InvoiceRecord[] {
  return openInvoices(sub).filter(i => i.dueAt < today)
}
