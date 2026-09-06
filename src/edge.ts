/**
 * Einstieg für Supabase Edge Functions (Deno). Immer mit Supabase-Store und Supabase-JWT-Prüfung.
 * Supabase routet `/functions/v1/<name>/...`, deshalb basePath = Funktionsname (EDGE_FUNCTION_NAME, Default `ai-proxy`).
 * Benötigte Secrets: MISTRAL_API_KEY. SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY setzt Supabase automatisch.
 * Optional: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_BASIC, STRIPE_PRICE_PRO, APP_URL, CORS_ORIGIN.
 */
import Stripe from 'stripe'
import { createApp } from './app.ts'
import { createVerifyToken } from './auth/supabase.ts'
import { loadConfig } from './config.ts'
import { SupabaseStore } from './stores/supabase.ts'

declare const Deno: {
  env: { toObject: () => Record<string, string> }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

const env = Deno.env.toObject()
// Supabase Edge Functions kennen keinen Auth-Bypass: Nutzer kommen immer mit echtem JWT
delete env.AI_PROXY_AUTH_BYPASS
const config = loadConfig(env)
if (config.backend !== 'supabase' || !config.supabase)
  throw new Error('Edge-Einstieg braucht SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY')

const billing = config.stripeSecretKey && config.stripeWebhookSecret
  ? {
      stripe: new Stripe(config.stripeSecretKey),
      webhookSecret: config.stripeWebhookSecret,
      prices: { basic: config.stripePrices.basic || undefined, pro: config.stripePrices.pro || undefined },
      appUrl: config.appUrl,
    }
  : null

const functionName = env.EDGE_FUNCTION_NAME || 'ai-proxy'

export const app = createApp({
  mistralApiKey: config.mistralApiKey,
  mistralBaseUrl: config.mistralBaseUrl,
  verifyToken: createVerifyToken(config.supabase).verifyToken,
  store: new SupabaseStore(config.supabase),
  authBypass: false,
  mistralFetch: fetch,
  corsOrigin: config.corsOrigin,
  billing,
}, { basePath: `/${functionName}` })

Deno.serve(app.fetch)
