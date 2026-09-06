/**
 * Einstieg für Supabase Edge Functions (Deno). Immer mit Supabase-Store und Supabase-JWT-Prüfung.
 * Supabase routet `/functions/v1/<name>/...`, deshalb basePath = Funktionsname (Default `ai-proxy`).
 *
 * Verwendung in `supabase/functions/ai-proxy/index.ts`:
 *   Deno.serve(createEdgeApp(Deno.env.toObject(), { plans: MY_PLANS }).fetch)
 *
 * Umgebung: MISTRAL_API_KEY (Secret). SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY setzt Supabase automatisch.
 * Der Service-Role-Key dient zugleich als internes Token: andere Edge Functions rufen den Proxy damit
 * plus Header `x-user-id` im Namen eines Nutzers auf (Pipeline ohne Nutzer-Session).
 * Optional: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN>, APP_URL, CORS_ORIGIN.
 */
import type { App } from './app.ts'
import type { PlanCatalog } from './plans.ts'
import Stripe from 'stripe'
import { createApp } from './app.ts'
import { createVerifyToken } from './auth/supabase.ts'
import { loadConfig } from './config.ts'
import { SupabaseStore } from './stores/supabase.ts'

export interface EdgeOptions {
  plans?: PlanCatalog
  /** Name der Edge Function = Pfadpräfix. Default `ai-proxy`. */
  functionName?: string
}

export function createEdgeApp(rawEnv: Record<string, string | undefined>, options: EdgeOptions = {}): App {
  const env = { ...rawEnv }
  // Supabase Edge Functions kennen keinen Auth-Bypass: Nutzer kommen immer mit echtem JWT
  delete env.AI_PROXY_AUTH_BYPASS
  const config = loadConfig(env)
  if (config.backend !== 'supabase' || !config.supabase)
    throw new Error('Edge-Einstieg braucht SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY')

  const billing = config.stripeSecretKey && config.stripeWebhookSecret
    ? {
        stripe: new Stripe(config.stripeSecretKey),
        webhookSecret: config.stripeWebhookSecret,
        prices: config.stripePrices,
        appUrl: config.appUrl,
      }
    : null

  const functionName = options.functionName || env.EDGE_FUNCTION_NAME || 'ai-proxy'

  return createApp({
    mistralApiKey: config.mistralApiKey,
    mistralBaseUrl: config.mistralBaseUrl,
    verifyToken: createVerifyToken(config.supabase).verifyToken,
    store: new SupabaseStore(config.supabase),
    authBypass: false,
    mistralFetch: fetch,
    corsOrigin: config.corsOrigin,
    billing,
    plans: options.plans,
    internalToken: config.supabase.serviceRoleKey,
  }, { basePath: `/${functionName}` })
}
