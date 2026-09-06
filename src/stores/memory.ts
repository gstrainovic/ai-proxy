import type { Usage } from '../limits.ts'
import type { Store, Subscription } from './types.ts'
import { emptyUsage } from '../limits.ts'

export class MemoryStore implements Store {
  private usage = new Map<string, Usage>()
  private subscriptions = new Map<string, Subscription>()

  async getUsage(userId: string, month: string): Promise<Usage> {
    return { ...(this.usage.get(`${userId}:${month}`) ?? emptyUsage()) }
  }

  async addUsage(userId: string, month: string, delta: Partial<Usage>): Promise<Usage> {
    const key = `${userId}:${month}`
    const current = this.usage.get(key) ?? emptyUsage()
    const next: Usage = {
      ocrPages: current.ocrPages + (delta.ocrPages ?? 0),
      chatTokens: current.chatTokens + (delta.chatTokens ?? 0),
    }
    this.usage.set(key, next)
    return { ...next }
  }

  async setUsage(userId: string, month: string, usage: Usage): Promise<void> {
    this.usage.set(`${userId}:${month}`, { ...usage })
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    return this.subscriptions.get(userId) ?? null
  }

  async setSubscription(userId: string, sub: Subscription): Promise<void> {
    this.subscriptions.set(userId, sub)
  }

  async findUserByStripeCustomer(customerId: string): Promise<string | null> {
    for (const [userId, sub] of this.subscriptions) {
      if (sub.stripeCustomerId === customerId)
        return userId
    }
    return null
  }
}
