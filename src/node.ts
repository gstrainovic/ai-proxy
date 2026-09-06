#!/usr/bin/env node
/**
 * AI-Proxy: hält den Mistral-Key, prüft die Nutzer-Session, zählt Nutzung, setzt Plan-Limits durch.
 * Backend nach Umgebung: InstantDB (INSTANT_APP_ID + INSTANT_ADMIN_TOKEN) oder Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Start: node --env-file-if-exists=.env src/node.ts — Produktion: Docker-Image (siehe Dockerfile) mit gesetzten Umgebungsvariablen.
 */
import type { Store } from './stores/types.ts'
import process from 'node:process'
import { serve } from '@hono/node-server'
import Stripe from 'stripe'
import { createApp } from './app.ts'
import { createVerifyToken as createInstantVerifyToken } from './auth/instant.ts'
import { createVerifyToken as createSupabaseVerifyToken } from './auth/supabase.ts'
import { loadConfig } from './config.ts'
import { InstantStore } from './stores/instant.ts'
import { SupabaseStore } from './stores/supabase.ts'

const config = loadConfig()

let store: Store
let verifyToken: (token: string) => Promise<{ id: string } | null>
if (config.backend === 'supabase') {
  store = new SupabaseStore(config.supabase!)
  verifyToken = createSupabaseVerifyToken(config.supabase!).verifyToken
}
else {
  const instant = { apiURI: config.instantApiUri, appId: config.instantAppId, adminToken: config.instantAdminToken }
  store = new InstantStore(instant)
  verifyToken = createInstantVerifyToken(instant).verifyToken
}

const billing = config.stripeSecretKey && config.stripeWebhookSecret
  ? {
      stripe: new Stripe(config.stripeSecretKey),
      webhookSecret: config.stripeWebhookSecret,
      prices: { basic: config.stripePrices.basic || undefined, pro: config.stripePrices.pro || undefined },
      appUrl: config.appUrl,
    }
  : null

const app = createApp({
  mistralApiKey: config.mistralApiKey,
  mistralBaseUrl: config.mistralBaseUrl,
  verifyToken,
  store,
  authBypass: config.authBypass,
  mistralFetch: fetch,
  corsOrigin: config.corsOrigin,
  billing,
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.warn(`[ai-proxy] läuft auf http://localhost:${info.port} (Backend: ${config.backend})${config.authBypass ? ' (AUTH-BYPASS aktiv, nur lokal!)' : ''}${billing ? '' : ' (Stripe nicht konfiguriert)'}`)
  if (config.authBypass && process.env.NODE_ENV === 'production')
    throw new Error('AI_PROXY_AUTH_BYPASS darf in Produktion nicht gesetzt sein')
})
