import type { Order } from './invoice.ts'
import type { Subscription } from './stores/types.ts'
import { describe, expect, it } from 'vitest'
import {
  cancelSubscription,
  effectiveSubscription,
  markInvoicePaid,
  orderSubscription,
  overdueInvoices,
  renewalDue,
  renewSubscription,
  resumeSubscription,
} from './invoice-subscription.ts'

const IBAN = 'CH93 0076 2011 6238 5295 7'

const order: Order = {
  company: 'Muster Sanitär AG',
  contact: 'Petra Muster',
  street: 'Hauptstrasse 12',
  zip: '9000',
  city: 'St. Gallen',
  email: 'buchhaltung@muster.ch',
  vehicles: 5,
}

const trialSince = (iso: string): Subscription => ({ plan: 'free', status: 'trial', trialStartedAt: `${iso}T08:00:00.000Z` })

function ordered(today = '2026-09-19', existing: Subscription | null = trialSince('2026-08-01')) {
  const result = orderSubscription({ existing, order, userId: 'user-a', today, iban: IBAN })
  if ('error' in result)
    throw new Error(result.error)
  return result
}

describe('orderSubscription', () => {
  it('nach der Testzeit beginnt das Jahr am Bestelltag, Zugang sofort', () => {
    const { sub, invoice } = ordered('2026-09-19', trialSince('2026-08-01'))
    expect(sub).toMatchObject({ plan: 'betrieb', status: 'active', billing: 'invoice', vehicles: 5, cancelAtPeriodEnd: false })
    expect(sub.billingAddress).toMatchObject({ company: 'Muster Sanitär AG', email: 'buchhaltung@muster.ch' })
    expect(sub.trialStartedAt).toBe('2026-08-01T08:00:00.000Z')
    expect(invoice).toMatchObject({ amount: 180, periodStart: '2026-09-19', periodEnd: '2027-09-19', dueAt: '2026-10-19' })
    expect(sub.invoices).toEqual([invoice])
  })

  it('während der Testzeit beginnt das bezahlte Jahr erst an deren Ende', () => {
    const { invoice } = ordered('2026-09-10', trialSince('2026-09-01'))
    expect(invoice.periodStart).toBe('2026-10-01')
    expect(invoice.periodEnd).toBe('2027-10-01')
    // Rechnung trotzdem ab heute, zahlbar in 30 Tagen
    expect(invoice.issuedAt).toBe('2026-09-10')
  })

  it('ohne bisherigen Eintrag beginnt das Jahr heute', () => {
    const { invoice } = ordered('2026-09-19', null)
    expect(invoice.periodStart).toBe('2026-09-19')
  })

  it('ein laufendes Abo lässt sich nicht ein zweites Mal bestellen', () => {
    const { sub } = ordered()
    expect(orderSubscription({ existing: sub, order, userId: 'user-a', today: '2026-09-20', iban: IBAN })).toEqual({ error: 'already_active' })
    const stripe: Subscription = { plan: 'privat', status: 'active', stripeCustomerId: 'cus_1' }
    expect(orderSubscription({ existing: stripe, order, userId: 'user-a', today: '2026-09-20', iban: IBAN })).toEqual({ error: 'already_active' })
  })

  it('nach Ablauf eines gekündigten Abos geht eine neue Bestellung', () => {
    const { sub } = ordered('2026-09-19')
    const { sub: canceled } = cancelSubscription(sub, '2026-10-01')
    const again = orderSubscription({ existing: canceled, order, userId: 'user-a', today: '2027-09-20', iban: IBAN })
    expect('error' in again).toBe(false)
  })
})

describe('effectiveSubscription', () => {
  it('bleibt aktiv bis zum Ende des bezahlten Jahres, danach wie abgelaufen', () => {
    const { sub } = ordered('2026-09-19')
    expect(effectiveSubscription(sub, '2027-09-18').status).toBe('active')
    expect(effectiveSubscription(sub, '2027-09-19').status).toBe('canceled')
  })

  it('Stripe-Abos bleiben unberührt', () => {
    const stripe: Subscription = { plan: 'privat', status: 'active', stripeCustomerId: 'cus_1' }
    expect(effectiveSubscription(stripe, '2030-01-01')).toBe(stripe)
  })
})

describe('cancelSubscription', () => {
  it('kündigt auf Ende der Laufzeit, Zugang bleibt bis dahin', () => {
    const { sub } = ordered('2026-09-19')
    const { sub: canceled, voided } = cancelSubscription(sub, '2026-12-01')
    expect(canceled.cancelAtPeriodEnd).toBe(true)
    expect(voided).toEqual([])
    expect(effectiveSubscription(canceled, '2027-09-18').status).toBe('active')
    expect(renewalDue(canceled, '2027-09-01')).toBe(false)
  })

  it('storniert eine Verlängerung, deren Jahr noch nicht begonnen hat, wenn sie offen ist', () => {
    const { sub } = ordered('2026-09-19')
    const renewed = renewSubscription({ sub, userId: 'user-a', vehicles: 6, today: '2027-08-20', iban: IBAN })
    const { sub: canceled, voided } = cancelSubscription(renewed, '2027-09-01')
    expect(voided).toHaveLength(1)
    expect(voided[0]!.periodStart).toBe('2027-09-19')
    expect(canceled.invoices).toHaveLength(1)
    expect(effectiveSubscription(canceled, '2027-09-19').status).toBe('canceled')
  })

  it('eine bezahlte Verlängerung bleibt stehen', () => {
    const { sub } = ordered('2026-09-19')
    const renewed = renewSubscription({ sub, userId: 'user-a', vehicles: 6, today: '2027-08-20', iban: IBAN })
    const paid = markInvoicePaid(renewed, renewed.invoices!.at(-1)!.reference, '2027-08-25')
    const { voided } = cancelSubscription(paid, '2027-09-01')
    expect(voided).toEqual([])
  })

  it('Kündigung vor Beginn des ersten Jahres storniert die Rechnung, das Abo endet', () => {
    const { sub } = ordered('2026-09-10', trialSince('2026-09-01'))
    const { sub: canceled, voided } = cancelSubscription(sub, '2026-09-15')
    expect(voided).toHaveLength(1)
    expect(canceled.status).toBe('canceled')
    expect(canceled.invoices).toEqual([])
  })

  it('Kündigung lässt sich zurücknehmen, solange das Abo läuft', () => {
    const { sub } = ordered('2026-09-19')
    const { sub: canceled } = cancelSubscription(sub, '2026-12-01')
    expect(resumeSubscription(canceled).cancelAtPeriodEnd).toBe(false)
  })
})

describe('Verlängerung', () => {
  it('ist 30 Tage vor Ablauf fällig, nicht früher, und nur einmal', () => {
    const { sub } = ordered('2026-09-19')
    expect(renewalDue(sub, '2027-08-19')).toBe(false)
    expect(renewalDue(sub, '2027-08-20')).toBe(true)
    const renewed = renewSubscription({ sub, userId: 'user-a', vehicles: 6, today: '2027-08-20', iban: IBAN })
    expect(renewalDue(renewed, '2027-08-21')).toBe(false)
  })

  it('rechnet den aktuellen Fahrzeugstand ab und schliesst lückenlos an', () => {
    const { sub } = ordered('2026-09-19')
    const renewed = renewSubscription({ sub, userId: 'user-a', vehicles: 7, today: '2027-08-20', iban: IBAN })
    const next = renewed.invoices!.at(-1)!
    expect(next).toMatchObject({ amount: 252, vehicles: 7, periodStart: '2027-09-19', periodEnd: '2028-09-19', issuedAt: '2027-08-20' })
    expect(renewed.vehicles).toBe(7)
    expect(effectiveSubscription(renewed, '2028-09-18').status).toBe('active')
  })
})

describe('Zahlungen', () => {
  it('markiert eine Rechnung über Referenz oder Nummer als bezahlt', () => {
    const { sub, invoice } = ordered('2026-09-19')
    expect(markInvoicePaid(sub, invoice.reference, '2026-10-02').invoices![0]!.paidAt).toBe('2026-10-02')
    expect(markInvoicePaid(sub, invoice.number, '2026-10-02').invoices![0]!.paidAt).toBe('2026-10-02')
  })

  it('unbekannte Referenz wirft', () => {
    const { sub } = ordered('2026-09-19')
    expect(() => markInvoicePaid(sub, 'RF00XYZ', '2026-10-02')).toThrow()
  })

  it('bucht nur den vollen Betrag, Teilzahlung wirft', () => {
    const { sub, invoice } = ordered('2026-09-19')
    const paid = markInvoicePaid(sub, invoice.reference, '2026-10-02', { amount: invoice.amount })
    expect(paid.invoices![0]!.paidAt).toBe('2026-10-02')
    expect(() => markInvoicePaid(sub, invoice.reference, '2026-10-02', { amount: invoice.amount - 10 }))
      .toThrow(/Betrag/)
  })

  it('merkt sich die Bankreferenz und bucht dieselbe Buchung nicht zweimal', () => {
    const { sub, invoice } = ordered('2026-09-19')
    const paid = markInvoicePaid(sub, invoice.reference, '2026-10-02', { bankRef: '2026100200000001' })
    expect(paid.invoices![0]!.bankRef).toBe('2026100200000001')
    expect(() => markInvoicePaid(paid, invoice.reference, '2026-10-05', { bankRef: '2026100200000001' }))
      .toThrow(/bereits/)
  })

  it('eine zweite Zahlung auf eine bezahlte Rechnung wirft', () => {
    const { sub, invoice } = ordered('2026-09-19')
    const paid = markInvoicePaid(sub, invoice.reference, '2026-10-02')
    expect(() => markInvoicePaid(paid, invoice.reference, '2026-10-05')).toThrow(/bezahlt/)
  })

  it('überfällig ist eine offene Rechnung nach dem Zahlungsziel', () => {
    const { sub } = ordered('2026-09-19')
    expect(overdueInvoices(sub, '2026-10-19')).toEqual([])
    expect(overdueInvoices(sub, '2026-10-20')).toHaveLength(1)
    const paid = markInvoicePaid(sub, sub.invoices![0]!.reference, '2026-10-25')
    expect(overdueInvoices(paid, '2026-10-26')).toEqual([])
  })
})
