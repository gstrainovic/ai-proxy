import type { Audience } from '../plans.ts'
import type { BillingAddress, InvoiceRecord } from '../invoice.ts'
import type { Usage } from '../limits.ts'

export interface Subscription {
  /** Plan-ID des App-Katalogs (siehe PlanCatalog) */
  plan: string
  status: 'active' | 'past_due' | 'canceled' | 'trial'
  /** Beginn der Testzeit (ISO), gesetzt beim ersten Aufruf ohne Abo */
  trialStartedAt?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  currentPeriodEnd?: number
  /** Zahlweg: Stripe oder Jahresrechnung (invoice-subscription.ts); fehlt = Stripe oder kein Abo */
  billing?: 'stripe' | 'invoice'
  /** Nur Jahresrechnung: Rechnungsadresse, abgerechnete Fahrzeuge, Kündigung auf Ende der Laufzeit, Rechnungen */
  billingAddress?: BillingAddress
  /** Preisliste des Kunden, entscheidet über Preis und Plan bei der Verlängerung; fehlt = Betrieb */
  audience?: Audience
  vehicles?: number
  cancelAtPeriodEnd?: boolean
  /** Laufzeit ergibt sich aus der letzten Rechnung (`periodEnd`) */
  invoices?: InvoiceRecord[]
}

/** Persistenz für Nutzungszähler und Abos. Implementierungen: MemoryStore (Tests), InstantStore (Produktion). */
export interface Store {
  getUsage: (userId: string, month: string) => Promise<Usage>
  addUsage: (userId: string, month: string, delta: Partial<Usage>) => Promise<Usage>
  setUsage: (userId: string, month: string, usage: Usage) => Promise<void>
  getSubscription: (userId: string) => Promise<Subscription | null>
  setSubscription: (userId: string, sub: Subscription) => Promise<void>
  findUserByStripeCustomer: (customerId: string) => Promise<string | null>
}
