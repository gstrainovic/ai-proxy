import { describe, expect, it } from 'vitest'
import { InstantStore } from './instant.ts'

// Integrationstest gegen den lokalen InstantDB-Server (E2E-App). Wird übersprungen, wenn er nicht läuft.
const API_URI = process.env.INSTANT_API_URI || 'http://localhost:8888'
const APP_ID = process.env.INSTANT_APP_ID || 'cd7e6912-773b-4ee1-be18-4d95c3b20e9f'
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(API_URI, { signal: AbortSignal.timeout(2000) })
    return res.status < 500
  }
  catch {
    return false
  }
}

const reachable = await serverReachable()

describe.skipIf(!reachable)('instantStore (integration, local InstantDB)', () => {
  const store = new InstantStore({ apiURI: API_URI, appId: APP_ID, adminToken: ADMIN_TOKEN })
  const userId = `vitest-user-${Date.now()}`
  const month = '2026-09'

  it('starts with empty usage for an unknown user', async () => {
    expect(await store.getUsage(userId, month)).toEqual({ ocrPages: 0, chatTokens: 0 })
  })

  it('accumulates usage across calls and isolates months', async () => {
    await store.addUsage(userId, month, { ocrPages: 2 })
    await store.addUsage(userId, month, { chatTokens: 500, ocrPages: 1 })
    expect(await store.getUsage(userId, month)).toEqual({ ocrPages: 3, chatTokens: 500 })
    expect(await store.getUsage(userId, '2026-10')).toEqual({ ocrPages: 0, chatTokens: 0 })
  })

  it('stores and reads a subscription', async () => {
    expect(await store.getSubscription(userId)).toBeNull()
    await store.setSubscription(userId, { plan: 'basic', status: 'active', stripeCustomerId: 'cus_1' })
    expect(await store.getSubscription(userId)).toMatchObject({ plan: 'basic', status: 'active', stripeCustomerId: 'cus_1' })
    await store.setSubscription(userId, { plan: 'pro', status: 'active' })
    expect(await store.getSubscription(userId)).toMatchObject({ plan: 'pro' })
  })

  it('finds a user by stripe customer id', async () => {
    const customerId = `cus_lookup_${Date.now()}`
    await store.setSubscription(userId, { plan: 'pro', status: 'active', stripeCustomerId: customerId })
    expect(await store.findUserByStripeCustomer(customerId)).toBe(userId)
    expect(await store.findUserByStripeCustomer('cus_missing')).toBeNull()
  })
})
