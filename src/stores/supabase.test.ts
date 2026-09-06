import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { SupabaseStore } from './supabase.ts'

// Integrationstest gegen das lokale Supabase (dms). Wird übersprungen, wenn es nicht läuft.
const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/rest/v1/`, { headers: { apikey: SERVICE_ROLE_KEY }, signal: AbortSignal.timeout(2000) })
    return res.status < 500
  }
  catch {
    return false
  }
}

const reachable = await serverReachable()

describe.skipIf(!reachable)('supabaseStore (integration, local Supabase)', () => {
  const store = new SupabaseStore({ url: URL, serviceRoleKey: SERVICE_ROLE_KEY })
  const admin = createClient(URL, SERVICE_ROLE_KEY)
  const month = '2026-09'
  let userId = ''

  it('creates a test user', async () => {
    const { data, error } = await admin.auth.admin.createUser({ email: `vitest-store-${Date.now()}@test.local`, email_confirm: true })
    expect(error).toBeNull()
    userId = data.user!.id
  })

  it('starts with empty usage for an unknown month', async () => {
    expect(await store.getUsage(userId, month)).toEqual({ ocrPages: 0, chatTokens: 0 })
  })

  it('accumulates usage atomically across calls and isolates months', async () => {
    await Promise.all([
      store.addUsage(userId, month, { ocrPages: 2 }),
      store.addUsage(userId, month, { chatTokens: 500, ocrPages: 1 }),
      store.addUsage(userId, month, { chatTokens: 250 }),
    ])
    expect(await store.getUsage(userId, month)).toEqual({ ocrPages: 3, chatTokens: 750 })
    expect(await store.getUsage(userId, '2026-10')).toEqual({ ocrPages: 0, chatTokens: 0 })
  })

  it('setUsage overwrites the counters', async () => {
    await store.setUsage(userId, month, { ocrPages: 7, chatTokens: 9 })
    expect(await store.getUsage(userId, month)).toEqual({ ocrPages: 7, chatTokens: 9 })
  })

  it('stores and reads a subscription', async () => {
    expect(await store.getSubscription(userId)).toBeNull()
    await store.setSubscription(userId, { plan: 'basic', status: 'active', stripeCustomerId: `cus_${userId.slice(0, 8)}` })
    expect(await store.getSubscription(userId)).toMatchObject({ plan: 'basic', status: 'active', stripeCustomerId: `cus_${userId.slice(0, 8)}` })
    await store.setSubscription(userId, { plan: 'pro', status: 'active' })
    expect(await store.getSubscription(userId)).toMatchObject({ plan: 'pro' })
  })

  it('finds a user by stripe customer id', async () => {
    const customerId = `cus_lookup_${Date.now()}`
    await store.setSubscription(userId, { plan: 'pro', status: 'active', stripeCustomerId: customerId })
    expect(await store.findUserByStripeCustomer(customerId)).toBe(userId)
    expect(await store.findUserByStripeCustomer('cus_missing')).toBeNull()
  })

  it('removes usage and subscription when the user is deleted', async () => {
    await admin.auth.admin.deleteUser(userId)
    expect(await store.getUsage(userId, month)).toEqual({ ocrPages: 0, chatTokens: 0 })
    expect(await store.getSubscription(userId)).toBeNull()
  })
})
