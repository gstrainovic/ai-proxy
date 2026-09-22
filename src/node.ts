#!/usr/bin/env node
/**
 * AI-Proxy: hält den Mistral-Key, prüft die Nutzer-Session, zählt Nutzung, setzt Plan-Limits durch.
 * Backend nach Umgebung: InstantDB (INSTANT_APP_ID + INSTANT_ADMIN_TOKEN) oder Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Start: node --env-file-if-exists=.env src/node.ts — Produktion: Docker-Image (siehe Dockerfile) mit gesetzten Umgebungsvariablen.
 */
import type { FeedbackNotice, InvoiceNotice } from './app.ts'
import type { Store } from './stores/types.ts'
import process from 'node:process'
import { serve } from '@hono/node-server'
import Stripe from 'stripe'
import { createApp } from './app.ts'
import { createVerifyToken as createInstantVerifyToken } from './auth/instant.ts'
import { createVerifyToken as createSupabaseVerifyToken } from './auth/supabase.ts'
import { loadConfig } from './config.ts'
import { createFeedbackNotifier } from './feedback.ts'
import { createResendNotifier } from './invoice-mail.ts'
import { createInvoiceRequestNotifier } from './invoice-request.ts'
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
      prices: config.stripePrices,
      appUrl: config.appUrl,
    }
  : null

// Jahresrechnung: mit IBAN als QR-Rechnung an den Kunden, ohne IBAN als Auftrag an den Betreiber, der sie von Hand
// schreibt (invoice-request.ts). Ohne RESEND_TOKEN nur protokollieren, damit lokal und in E2E nichts verschickt wird.
function logNotice(notice: InvoiceNotice): Promise<void> {
  const numbers = notice.type === 'invoice' ? notice.invoice.number : notice.invoices.map(i => i.number).join(', ')
  console.warn(`[ai-proxy] ${notice.type === 'invoice' ? 'Rechnung' : 'Storno'} ${numbers} für ${notice.userId} (kein RESEND_TOKEN, nicht versandt)`)
  return Promise.resolve()
}
const invoicingConfig = config.invoicing
const requests = config.invoiceRequests
const invoicing = invoicingConfig
  ? {
      iban: invoicingConfig.creditor.iban,
      notify: invoicingConfig.resendToken
        ? createResendNotifier({ token: invoicingConfig.resendToken, from: invoicingConfig.from, bcc: invoicingConfig.bcc, creditor: invoicingConfig.creditor, appUrl: config.appUrl })
        : logNotice,
    }
  : requests
    ? {
        iban: '',
        manual: true,
        notify: requests.resendToken
          ? createInvoiceRequestNotifier({ token: requests.resendToken, from: requests.from, to: requests.to })
          : logNotice,
      }
    : null

/**
 * Rückmeldungen aus der App: FEEDBACK_TO, ersatzweise das Postfach der Rechnung. Bewusst nicht an die IBAN
 * gekoppelt — eine Instanz ohne Rechnungsstellung soll Fehler und Wünsche trotzdem annehmen. Ohne RESEND_TOKEN
 * landet die Rückmeldung im Log statt im Postfach.
 */
const feedback = config.feedback
  ? {
      notify: config.feedback.resendToken
        ? createFeedbackNotifier({ token: config.feedback.resendToken, from: config.feedback.from, to: config.feedback.to })
        : async (notice: FeedbackNotice) => {
          console.warn(`[ai-proxy] Rückmeldung (kein RESEND_TOKEN, nicht versandt): ${notice.subject}\n${notice.text}`)
        },
    }
  : null

const app = createApp({
  mistralApiKey: config.mistralApiKey,
  mistralBaseUrl: config.mistralBaseUrl,
  verifyToken,
  store,
  authBypass: config.authBypass,
  burstLimit: config.burstLimit,
  mistralFetch: fetch,
  corsOrigin: config.corsOrigin,
  billing,
  internalToken: config.internalToken || undefined,
  invoicing,
  feedback,
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.warn(`[ai-proxy] läuft auf http://localhost:${info.port} (Backend: ${config.backend})${config.authBypass ? ' (AUTH-BYPASS aktiv, nur lokal!)' : ''}${billing ? '' : ' (Stripe nicht konfiguriert)'}${invoicing ? (invoicing.iban ? '' : ` (Rechnung von Hand an ${requests!.to})`) : ' (Jahresrechnung nicht konfiguriert)'}`)
  if (config.authBypass && process.env.NODE_ENV === 'production')
    throw new Error('AI_PROXY_AUTH_BYPASS darf in Produktion nicht gesetzt sein')
})
