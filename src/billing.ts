import type { Context } from 'hono'
import type Stripe from 'stripe'
import type { PlanId } from './plans.ts'
import type { Store, Subscription } from './stores/types.ts'
import { isPlanId, PLANS } from './plans.ts'

export interface BillingDeps {
  stripe: Stripe
  webhookSecret: string
  /** Stripe Price-IDs je bezahltem Plan */
  prices: Partial<Record<PlanId, string>>
  appUrl: string
}

function planForPrice(prices: BillingDeps['prices'], priceId: string | undefined): PlanId | null {
  for (const [plan, id] of Object.entries(prices)) {
    if (id && id === priceId)
      return plan as PlanId
  }
  return null
}

function mapStatus(status: string): Subscription['status'] {
  if (status === 'active' || status === 'trialing')
    return 'active'
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete')
    return 'past_due'
  return 'canceled'
}

export function notConfigured(c: Context) {
  return c.json({ error: { code: 'billing_not_configured', message: 'Zahlung ist noch nicht konfiguriert.' } }, 501)
}

export async function createCheckout(c: Context, deps: BillingDeps, store: Store, userId: string) {
  const body = await c.req.json<{ plan?: string }>().catch(() => ({} as { plan?: string }))
  const plan = body.plan
  if (!isPlanId(plan) || PLANS[plan].priceChfPerMonth === 0)
    return c.json({ error: { code: 'invalid_plan', message: 'Ungültiger Plan.' } }, 400)
  const price = deps.prices[plan]
  if (!price)
    return c.json({ error: { code: 'plan_not_configured', message: `Für den Plan ${PLANS[plan].name} ist kein Stripe-Preis hinterlegt.` } }, 501)

  const existing = await store.getSubscription(userId)
  const session = await deps.stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${deps.appUrl}/settings?checkout=success`,
    cancel_url: `${deps.appUrl}/settings?checkout=cancel`,
    client_reference_id: userId,
    metadata: { userId, plan },
    ...(existing?.stripeCustomerId ? { customer: existing.stripeCustomerId } : {}),
  })
  return c.json({ url: session.url })
}

export async function createPortal(c: Context, deps: BillingDeps, store: Store, userId: string) {
  const existing = await store.getSubscription(userId)
  if (!existing?.stripeCustomerId)
    return c.json({ error: { code: 'no_customer', message: 'Kein Abo vorhanden.' } }, 404)
  const session = await deps.stripe.billingPortal.sessions.create({
    customer: existing.stripeCustomerId,
    return_url: `${deps.appUrl}/settings`,
  })
  return c.json({ url: session.url })
}

export async function handleWebhook(c: Context, deps: BillingDeps, store: Store) {
  const signature = c.req.header('stripe-signature') ?? ''
  const payload = await c.req.text()
  let event: Stripe.Event
  try {
    event = deps.stripe.webhooks.constructEvent(payload, signature, deps.webhookSecret)
  }
  catch {
    return c.json({ error: { code: 'invalid_signature', message: 'Ungültige Stripe-Signatur.' } }, 400)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.client_reference_id ?? session.metadata?.userId
    const plan = session.metadata?.plan
    if (userId && isPlanId(plan)) {
      await store.setSubscription(userId, {
        plan,
        status: 'active',
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
      })
    }
  }
  else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const userId = await store.findUserByStripeCustomer(customerId)
    if (userId) {
      const item = sub.items?.data?.[0]
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : mapStatus(sub.status)
      const plan = status === 'canceled' ? 'free' : (planForPrice(deps.prices, item?.price?.id) ?? 'free')
      const existing = await store.getSubscription(userId)
      await store.setSubscription(userId, {
        plan,
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: item?.current_period_end ?? existing?.currentPeriodEnd,
      })
    }
  }

  return c.json({ received: true })
}
