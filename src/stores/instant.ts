import type { Usage } from '../limits.ts'
import type { Store, Subscription } from './types.ts'
import { id, init } from '@instantdb/admin'
import { emptyUsage } from '../limits.ts'

export interface InstantStoreConfig {
  apiURI: string
  appId: string
  adminToken: string
}

/**
 * Nutzungszähler und Abos in InstantDB, geschrieben über das Admin-SDK (umgeht Perms).
 * Entities: `usage` {userId, month, ocrPages, chatTokens}, `subscriptions` {userId, plan, status, stripe*}.
 * Der Client darf beide nur lesen (siehe instant.perms.ts).
 */
export class InstantStore implements Store {
  private db: ReturnType<typeof init>

  constructor(config: InstantStoreConfig) {
    this.db = init({ appId: config.appId, adminToken: config.adminToken, apiURI: config.apiURI })
  }

  private async findUsage(userId: string, month: string): Promise<any | null> {
    const result = await this.db.query({ usage: { $: { where: { userId, month } } } })
    return (result.usage as any[])[0] ?? null
  }

  async getUsage(userId: string, month: string): Promise<Usage> {
    const row = await this.findUsage(userId, month)
    if (!row)
      return emptyUsage()
    return { ocrPages: Number(row.ocrPages ?? 0), chatTokens: Number(row.chatTokens ?? 0) }
  }

  async addUsage(userId: string, month: string, delta: Partial<Usage>): Promise<Usage> {
    const row = await this.findUsage(userId, month)
    const current = row ? await this.getUsage(userId, month) : emptyUsage()
    const next: Usage = {
      ocrPages: current.ocrPages + (delta.ocrPages ?? 0),
      chatTokens: current.chatTokens + (delta.chatTokens ?? 0),
    }
    const entityId = row?.id ?? id()
    await this.db.transact(this.db.tx.usage[entityId].update({ userId, month, ...next, updatedAt: Date.now() }))
    return next
  }

  async setUsage(userId: string, month: string, usage: Usage): Promise<void> {
    const row = await this.findUsage(userId, month)
    const entityId = row?.id ?? id()
    await this.db.transact(this.db.tx.usage[entityId].update({ userId, month, ...usage, updatedAt: Date.now() }))
  }

  private async findSubscriptionRow(userId: string): Promise<any | null> {
    const result = await this.db.query({ subscriptions: { $: { where: { userId } } } })
    return (result.subscriptions as any[])[0] ?? null
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    const row = await this.findSubscriptionRow(userId)
    if (!row)
      return null
    return {
      plan: row.plan,
      status: row.status,
      stripeCustomerId: row.stripeCustomerId ?? undefined,
      stripeSubscriptionId: row.stripeSubscriptionId ?? undefined,
      currentPeriodEnd: row.currentPeriodEnd ?? undefined,
    }
  }

  async setSubscription(userId: string, sub: Subscription): Promise<void> {
    const row = await this.findSubscriptionRow(userId)
    const entityId = row?.id ?? id()
    await this.db.transact(this.db.tx.subscriptions[entityId].update({
      userId,
      plan: sub.plan,
      status: sub.status,
      stripeCustomerId: sub.stripeCustomerId ?? null,
      stripeSubscriptionId: sub.stripeSubscriptionId ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      updatedAt: Date.now(),
    }))
  }

  async findUserByStripeCustomer(customerId: string): Promise<string | null> {
    const result = await this.db.query({ subscriptions: { $: { where: { stripeCustomerId: customerId } } } })
    return ((result.subscriptions as any[])[0]?.userId as string | undefined) ?? null
  }
}
