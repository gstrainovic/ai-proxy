#!/usr/bin/env node
/**
 * AI-Proxy: hält den Mistral-Key, prüft die InstantDB-Session, zählt Nutzung, setzt Plan-Limits durch.
 * Start: node --env-file-if-exists=.env src/node.ts — Produktion: Docker-Image (siehe Dockerfile) mit gesetzten Umgebungsvariablen.
 */
import process from 'node:process'
import { serve } from '@hono/node-server'
import Stripe from 'stripe'
import { createApp } from './app.ts'
import { createVerifyToken } from './auth/instant.ts'
import { loadConfig } from './config.ts'
import { InstantStore } from './stores/instant.ts'

const config = loadConfig()
const instant = { apiURI: config.instantApiUri, appId: config.instantAppId, adminToken: config.instantAdminToken }
const { verifyToken } = createVerifyToken(instant)

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
  store: new InstantStore(instant),
  authBypass: config.authBypass,
  mistralFetch: fetch,
  corsOrigin: config.corsOrigin,
  billing,
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.warn(`[ai-proxy] läuft auf http://localhost:${info.port}${config.authBypass ? ' (AUTH-BYPASS aktiv, nur lokal!)' : ''}${billing ? '' : ' (Stripe nicht konfiguriert)'}`)
  if (config.authBypass && process.env.NODE_ENV === 'production')
    throw new Error('AI_PROXY_AUTH_BYPASS darf in Produktion nicht gesetzt sein')
})
