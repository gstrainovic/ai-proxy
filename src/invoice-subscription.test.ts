import type { Order } from './invoice.ts'
import type { Subscription } from './stores/types.ts'
import { describe, expect, it } from 'vitest'
import {
  effectiveSubscription,
  markInvoicePaid,
  orderSubscription,
  overdueInvoices,
  renewalDue,
  renewSubscription,
  stopSubscription,
} from './invoice-subscription.ts'

const IBAN = 'CH93 0076 2011 6238 5295 7'

const order: Order = {
  audience: 'betrieb',
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

  it('nach Ablauf des bezahlten Jahres geht eine neue Bestellung', () => {
    const { sub, invoice } = ordered('2026-09-19')
    const paid = markInvoicePaid(sub, invoice.reference, '2026-10-02')
    const again = orderSubscription({ existing: paid, order, userId: 'user-a', today: '2027-09-20', iban: IBAN })
    expect('error' in again).toBe(false)
  })
})

/** Erste Rechnung bestellt am 19.09.2026 (nach der Testzeit) und bezahlt */
function orderedAndPaid(paidAt = '2026-10-02') {
  const { sub, invoice } = ordered('2026-09-19')
  return markInvoicePaid(sub, invoice.reference, paidAt)
}

function renewed(sub: Subscription, vehicles = 6, today = '2027-08-20') {
  return renewSubscription({ sub, userId: 'user-a', vehicles, today, iban: IBAN })
}

describe('Zugang (effectiveSubscription): verbindlich erst mit der Zahlung', () => {
  it('nach der Bestellung Zugang bis zur Zahlungsfrist, ohne Zahlung danach nicht mehr', () => {
    const { sub, invoice } = ordered('2026-09-19')
    expect(invoice.dueAt).toBe('2026-10-19')
    expect(effectiveSubscription(sub, '2026-10-19').status).toBe('active')
    expect(effectiveSubscription(sub, '2026-10-20').status).toBe('canceled')
    expect(effectiveSubscription(sub, '2027-03-01').status).toBe('canceled')
  })

  it('eine späte Zahlung schaltet das bezahlte Jahr wieder frei, bis zu dessen Ende', () => {
    const { sub, invoice } = ordered('2026-09-19')
    const paid = markInvoicePaid(sub, invoice.reference, '2026-11-15')
    expect(effectiveSubscription(paid, '2026-11-15').status).toBe('active')
    expect(effectiveSubscription(paid, '2027-09-18').status).toBe('active')
    expect(effectiveSubscription(paid, '2027-09-19').status).toBe('canceled')
  })

  it('während der Testzeit bestellt: Zugang bis Testende, danach bis zur Zahlungsfrist', () => {
    // Testzeit 01.09.–30.09., bestellt am 25.09., zahlbar bis 25.10.
    const { sub } = ordered('2026-09-25', trialSince('2026-09-01'))
    expect(effectiveSubscription(sub, '2026-10-25').status).toBe('active')
    expect(effectiveSubscription(sub, '2026-10-26').status).toBe('canceled')
  })

  it('kurz nach Testbeginn bestellt: Zugang bis zur Frist, die knapp nach dem Testende liegt', () => {
    // Testzeit bis 30.09., bestellt am 02.09., Frist 02.10.
    const { sub } = ordered('2026-09-02', trialSince('2026-09-01'))
    expect(effectiveSubscription(sub, '2026-10-02').status).toBe('active')
    expect(effectiveSubscription(sub, '2026-10-03').status).toBe('canceled')
  })

  it('Verlängerung unbezahlt: das bezahlte Jahr läuft zu Ende, danach kein Zugang', () => {
    const next = renewed(orderedAndPaid())
    expect(effectiveSubscription(next, '2027-09-18').status).toBe('active')
    expect(effectiveSubscription(next, '2027-09-19').status).toBe('canceled')
  })

  it('Verlängerung spät bezahlt: Zugang wieder bis zum Ende des neuen Jahres', () => {
    const next = renewed(orderedAndPaid())
    const paid = markInvoicePaid(next, next.invoices![1]!.reference, '2027-10-05')
    expect(effectiveSubscription(paid, '2027-10-05').status).toBe('active')
    expect(effectiveSubscription(paid, '2028-09-18').status).toBe('active')
    expect(effectiveSubscription(paid, '2028-09-19').status).toBe('canceled')
  })

  it('Stripe-Abos bleiben unberührt', () => {
    const stripe: Subscription = { plan: 'privat', status: 'active', stripeCustomerId: 'cus_1' }
    expect(effectiveSubscription(stripe, '2030-01-01')).toBe(stripe)
  })
})

describe('stopSubscription: keine weiteren Rechnungen (Admin, auf Wunsch des Kunden)', () => {
  it('storniert die offene Verlängerung, das bezahlte Jahr läuft zu Ende, keine neue Rechnung', () => {
    const next = renewed(orderedAndPaid())
    const { sub: stopped, voided } = stopSubscription(next)
    expect(voided.map(i => i.periodStart)).toEqual(['2027-09-19'])
    expect(stopped.invoices).toHaveLength(1)
    expect(effectiveSubscription(stopped, '2027-09-18').status).toBe('active')
    expect(effectiveSubscription(stopped, '2027-09-19').status).toBe('canceled')
    expect(renewalDue(stopped, '2027-09-01')).toBe(false)
  })

  it('vor jeder Zahlung: Rechnung storniert, Abo endet, die Testzeit gilt wieder', () => {
    const { sub } = ordered('2026-09-10', trialSince('2026-09-01'))
    const { sub: stopped, voided } = stopSubscription(sub)
    expect(voided).toHaveLength(1)
    expect(stopped.status).toBe('canceled')
    expect(stopped.invoices).toEqual([])
  })

  it('eine bezahlte Rechnung bleibt stehen', () => {
    const { voided } = stopSubscription(orderedAndPaid())
    expect(voided).toEqual([])
  })
})

describe('Verlängerung', () => {
  it('ist 30 Tage vor Ablauf fällig, nicht früher, und nur einmal', () => {
    const sub = orderedAndPaid()
    expect(renewalDue(sub, '2027-08-19')).toBe(false)
    expect(renewalDue(sub, '2027-08-20')).toBe(true)
    expect(renewalDue(renewed(sub), '2027-08-21')).toBe(false)
  })

  it('nur nach einem bezahlten Jahr: unbezahlte Rechnungen erzeugen keine Folge-Rechnung', () => {
    const { sub } = ordered('2026-09-19')
    expect(renewalDue(sub, '2027-08-20')).toBe(false)
    // Verlängerung nicht bezahlt: ein Jahr später keine weitere Rechnung
    const next = renewed(orderedAndPaid())
    expect(renewalDue(next, '2028-08-20')).toBe(false)
  })

  it('rechnet den aktuellen Fahrzeugstand ab und schliesst lückenlos an', () => {
    const next = renewed(orderedAndPaid(), 7).invoices!.at(-1)!
    expect(next).toMatchObject({ amount: 252, vehicles: 7, periodStart: '2027-09-19', periodEnd: '2028-09-19', issuedAt: '2027-08-20' })
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

describe('Privatkunde auf Rechnung', () => {
  const privateOrder: Order = {
    audience: 'privat',
    company: '',
    contact: 'Anna Beispiel',
    street: 'Dorfstrasse 4',
    zip: '9000',
    city: 'St. Gallen',
    email: 'anna@beispiel.ch',
    vehicles: 2,
  }

  function orderedPrivate(today = '2026-09-19', vehicles = 2) {
    const result = orderSubscription({ existing: null, order: { ...privateOrder, vehicles }, userId: 'user-p', today, iban: IBAN })
    if ('error' in result)
      throw new Error(result.error)
    return result
  }

  it('Plan privat, 25 CHF im Jahr, sonst derselbe Ablauf', () => {
    const { sub, invoice } = orderedPrivate('2026-09-19')
    expect(sub).toMatchObject({ plan: 'privat', status: 'active', billing: 'invoice', vehicles: 2 })
    expect(invoice.amount).toBe(25)
    expect(invoice.audience).toBe('privat')
    expect(sub.billingAddress).toMatchObject({ contact: 'Anna Beispiel', company: '' })
  })

  it('die Verlängerung bleibt bei der Preisliste des Kunden', () => {
    const { sub } = orderedPrivate('2026-09-19')
    const renewed = renewSubscription({ sub, userId: 'user-p', vehicles: 3, today: '2027-08-20', iban: IBAN })
    expect(renewed.invoices!.at(-1)).toMatchObject({ amount: 25, audience: 'privat' })
  })

  it('ab sechs Fahrzeugen gilt der Preis pro Fahrzeug, der Plan wird Betrieb', () => {
    const { sub, invoice } = orderedPrivate('2026-09-19', 6)
    expect(invoice.amount).toBe(216)
    expect(sub.plan).toBe('betrieb')
  })
})
