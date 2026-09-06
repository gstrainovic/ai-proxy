import type { SupabaseClient } from '@supabase/supabase-js'
import type { Usage } from '../limits.ts'
import type { Store, Subscription } from './types.ts'
import { createClient } from '@supabase/supabase-js'
import { emptyUsage } from '../limits.ts'

export interface SupabaseStoreConfig {
  url: string
  serviceRoleKey: string
}

/**
 * Nutzungszähler und Abos in Supabase (Postgres), geschrieben mit dem Service-Role-Key (umgeht RLS).
 * Tabellen `ai_usage` und `ai_subscriptions`, RPC `ai_add_usage` für atomare Erhöhung.
 * Schema: dms/supabase/migrations/00007_ai_proxy.sql. Clients dürfen ihre eigenen Zeilen nur lesen.
 */
export class SupabaseStore implements Store {
  private db: SupabaseClient

  constructor(config: SupabaseStoreConfig) {
    this.db = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  }

  async getUsage(userId: string, month: string): Promise<Usage> {
    const { data, error } = await this.db
      .from('ai_usage')
      .select('ocr_pages, chat_tokens')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle()
    if (error)
      throw new Error(`ai_usage lesen fehlgeschlagen: ${error.message}`)
    if (!data)
      return emptyUsage()
    return { ocrPages: Number(data.ocr_pages ?? 0), chatTokens: Number(data.chat_tokens ?? 0) }
  }

  async addUsage(userId: string, month: string, delta: Partial<Usage>): Promise<Usage> {
    const { data, error } = await this.db.rpc('ai_add_usage', {
      p_user_id: userId,
      p_month: month,
      p_ocr_pages: delta.ocrPages ?? 0,
      p_chat_tokens: delta.chatTokens ?? 0,
    })
    if (error)
      throw new Error(`ai_add_usage fehlgeschlagen: ${error.message}`)
    return { ocrPages: Number(data.ocr_pages ?? 0), chatTokens: Number(data.chat_tokens ?? 0) }
  }

  async setUsage(userId: string, month: string, usage: Usage): Promise<void> {
    const { error } = await this.db
      .from('ai_usage')
      .upsert({ user_id: userId, month, ocr_pages: usage.ocrPages, chat_tokens: usage.chatTokens, updated_at: new Date().toISOString() })
    if (error)
      throw new Error(`ai_usage schreiben fehlgeschlagen: ${error.message}`)
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    const { data, error } = await this.db
      .from('ai_subscriptions')
      .select('plan, status, stripe_customer_id, stripe_subscription_id, current_period_end')
      .eq('user_id', userId)
      .maybeSingle()
    if (error)
      throw new Error(`ai_subscriptions lesen fehlgeschlagen: ${error.message}`)
    if (!data)
      return null
    return {
      plan: data.plan,
      status: data.status,
      stripeCustomerId: data.stripe_customer_id ?? undefined,
      stripeSubscriptionId: data.stripe_subscription_id ?? undefined,
      currentPeriodEnd: data.current_period_end ?? undefined,
    }
  }

  async setSubscription(userId: string, sub: Subscription): Promise<void> {
    const { error } = await this.db.from('ai_subscriptions').upsert({
      user_id: userId,
      plan: sub.plan,
      status: sub.status,
      stripe_customer_id: sub.stripeCustomerId ?? null,
      stripe_subscription_id: sub.stripeSubscriptionId ?? null,
      current_period_end: sub.currentPeriodEnd ?? null,
      updated_at: new Date().toISOString(),
    })
    if (error)
      throw new Error(`ai_subscriptions schreiben fehlgeschlagen: ${error.message}`)
  }

  async findUserByStripeCustomer(customerId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('ai_subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    if (error)
      throw new Error(`ai_subscriptions suchen fehlgeschlagen: ${error.message}`)
    return data?.user_id ?? null
  }
}
