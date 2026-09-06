import type { PlanId } from '../plans.ts'
import type { Usage } from '../limits.ts'

export interface Subscription {
  plan: PlanId
  status: 'active' | 'past_due' | 'canceled'
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  currentPeriodEnd?: number
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
