import type { BillingDeps } from './billing.ts'
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { MemoryStore } from './stores/memory.ts'

const WEBHOOK_SECRET = 'whsec_test_secret'
const stripeForSignatures = new Stripe('sk_test_dummy')

function fakeStripe(created: any[] = []) {
  return {
    checkout: {
      sessions: {
        create: async (params: any) => {
          created.push(params)
          return { url: 'https://checkout.stripe.test/session_1' }
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: any) => {
          created.push(params)
          return { url: 'https://billing.stripe.test/portal_1' }
        },
      },
    },
    webhooks: stripeForSignatures.webhooks,
  } as unknown as Stripe
}

function setup(billing?: Partial<BillingDeps>) {
  const store = new MemoryStore()
  const created: any[] = []
  const app = createApp({
    mistralApiKey: 'k',
    mistralBaseUrl: 'https://mistral.test/v1',
    verifyToken: async token => (token === 'valid-token' ? { id: 'user-1' } : null),
    store,
    authBypass: false,
    mistralFetch: async () => new Response('{}'),
    billing: billing === undefined
      ? {
          stripe: fakeStripe(created),
          webhookSecret: WEBHOOK_SECRET,
          prices: { basic: 'price_basic', pro: 'price_pro' },
          appUrl: 'https://app.test',
        }
      : billing as BillingDeps,
  })
  return { app, store, created }
}

const auth = { 'Authorization': 'Bearer valid-token', 'content-type': 'application/json' }

function signedWebhook(event: object) {
  const payload = JSON.stringify(event)
  const header = stripeForSignatures.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  return { payload, header }
}

describe('billing checkout', () => {
  it('creates a subscription checkout session for a paid plan', async () => {
    const { app, created } = setup()
    const res = await app.request('/billing/checkout', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'pro' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/session_1' })
    expect(created[0]).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_pro', quantity: 1 }],
      client_reference_id: 'user-1',
      metadata: { userId: 'user-1', plan: 'pro' },
    })
    expect(created[0].success_url).toContain('https://app.test')
  })

  it('rejects the free plan and unknown plans', async () => {
    const { app } = setup()
    for (const plan of ['free', 'gold']) {
      const res = await app.request('/billing/checkout', { method: 'POST', headers: auth, body: JSON.stringify({ plan }) })
      expect(res.status).toBe(400)
    }
  })

  it('returns 501 with a German message when Stripe is not configured', async () => {
    const { app } = setup(null as any)
    const res = await app.request('/billing/checkout', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'pro' }) })
    expect(res.status).toBe(501)
    expect(((await res.json()) as any).error.message).toMatch(/nicht konfiguriert/)
  })

  it('opens the billing portal for a user with a stripe customer', async () => {
    const { app, store, created } = setup()
    await store.setSubscription('user-1', { plan: 'pro', status: 'active', stripeCustomerId: 'cus_1' })
    const res = await app.request('/billing/portal', { method: 'POST', headers: auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.test/portal_1' })
    expect(created[0]).toMatchObject({ customer: 'cus_1' })
  })
})

describe('stripe webhook', () => {
  it('rejects an invalid signature', async () => {
    const { app } = setup()
    const res = await app.request('/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=bad', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    })
    expect(res.status).toBe(400)
  })

  it('activates the plan on checkout.session.completed', async () => {
    const { app, store } = setup()
    const { payload, header } = signedWebhook({
      id: 'evt_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', client_reference_id: 'user-1', customer: 'cus_1', subscription: 'sub_1', metadata: { userId: 'user-1', plan: 'basic' } } },
    })
    const res = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload })
    expect(res.status).toBe(200)
    expect(await store.getSubscription('user-1')).toMatchObject({ plan: 'basic', status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' })
  })

  it('updates plan and status on customer.subscription.updated using the price id', async () => {
    const { app, store } = setup()
    await store.setSubscription('user-1', { plan: 'basic', status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' })
    const { payload, header } = signedWebhook({
      id: 'evt_2',
      object: 'event',
      type: 'customer.subscription.updated',
      data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'past_due', items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_800_000_000 }] } } },
    })
    const res = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload })
    expect(res.status).toBe(200)
    expect(await store.getSubscription('user-1')).toMatchObject({ plan: 'pro', status: 'past_due', currentPeriodEnd: 1_800_000_000 })
  })

  it('falls back to free on customer.subscription.deleted', async () => {
    const { app, store } = setup()
    await store.setSubscription('user-1', { plan: 'pro', status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' })
    const { payload, header } = signedWebhook({
      id: 'evt_3',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [{ price: { id: 'price_pro' } }] } } },
    })
    const res = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload })
    expect(res.status).toBe(200)
    expect(await store.getSubscription('user-1')).toMatchObject({ plan: 'free', status: 'canceled' })
  })

  it('ignores unrelated events but still returns 200', async () => {
    const { app } = setup()
    const { payload, header } = signedWebhook({ id: 'evt_4', object: 'event', type: 'invoice.paid', data: { object: {} } })
    const res = await app.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload })
    expect(res.status).toBe(200)
  })
})
