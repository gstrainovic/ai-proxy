import type { Creditor } from './invoice.ts'
import process from 'node:process'
import { isIBANValid } from 'swissqrbill/utils'
import { BURST_LIMIT } from './rate-limit.ts'

export type Backend = 'instant' | 'supabase'

export interface SupabaseConfig {
  url: string
  serviceRoleKey: string
}

export interface ServerConfig {
  port: number
  mistralApiKey: string
  mistralBaseUrl: string
  /** Welcher Store und welche Token-Prüfung: InstantDB (auto-service) oder Supabase (dms). */
  backend: Backend
  instantApiUri: string
  instantAppId: string
  instantAdminToken: string
  supabase: SupabaseConfig | null
  authBypass: boolean
  /** Fair-Use-Bremse: Anfragen pro Nutzer und Minute (AI_PROXY_BURST_LIMIT, Default 20). */
  burstLimit: number
  corsOrigin: string
  appUrl: string
  stripeSecretKey: string
  stripeWebhookSecret: string
  /** Stripe Price-IDs aus STRIPE_PRICE_<PLAN>, Schlüssel = Plan-ID in Kleinbuchstaben. */
  stripePrices: Record<string, string>
  /** Optional: Geheimnis für Server-zu-Server-Aufrufe mit x-user-id (AI_PROXY_INTERNAL_TOKEN). */
  internalToken: string
  /** Jahresrechnung für Betriebe; null ohne INVOICE_IBAN */
  invoicing: InvoicingConfig | null
  /** Rückmeldungen aus der App; null ohne Ziel-Postfach */
  feedback: FeedbackConfig | null
  /** Rechnung von Hand: nur ohne INVOICE_IBAN, Auftrag an dieses Postfach; null ohne Postfach */
  invoiceRequests: FeedbackConfig | null
}

export interface FeedbackConfig {
  /** Postfach, das die Rückmeldungen bekommt */
  to: string
  from: string
  /** Ohne Token landet die Rückmeldung im Log (lokal, E2E) */
  resendToken: string
}

export interface InvoicingConfig {
  creditor: Creditor
  /** Ohne Token wird die Rechnung nur protokolliert (lokal, E2E) */
  resendToken: string
  from: string
  bcc: string
}

/** Empfänger aus INVOICE_*; null ohne INVOICE_IBAN. Prüft die IBAN schon beim Start. */
export function loadInvoicing(env: NodeJS.ProcessEnv): InvoicingConfig | null {
  if (!env.INVOICE_IBAN)
    return null
  if (!isIBANValid(env.INVOICE_IBAN.replaceAll(' ', '')))
    throw new Error('INVOICE_IBAN ist keine gültige IBAN')
  const email = required(env, 'INVOICE_EMAIL')
  const brand = env.INVOICE_BRAND || undefined
  return {
    creditor: {
      name: required(env, 'INVOICE_CREDITOR_NAME'),
      tradeName: env.INVOICE_TRADE_NAME || undefined,
      brand,
      street: required(env, 'INVOICE_STREET'),
      zip: required(env, 'INVOICE_ZIP'),
      city: required(env, 'INVOICE_CITY'),
      iban: env.INVOICE_IBAN,
      email,
      website: env.INVOICE_WEBSITE || undefined,
    },
    resendToken: env.RESEND_TOKEN || '',
    from: env.INVOICE_FROM || `${brand ?? 'Rechnung'} <${email}>`,
    bcc: env.INVOICE_BCC || email,
  }
}

/**
 * Rückmeldungen aus der App hängen nicht an der Rechnungsstellung: eine Instanz ohne IBAN soll Fehler und
 * Wünsche trotzdem entgegennehmen. Ziel ist FEEDBACK_TO, ersatzweise das Postfach aus INVOICE_EMAIL.
 */
export function loadFeedback(env: NodeJS.ProcessEnv, invoicing: InvoicingConfig | null): FeedbackConfig | null {
  // INVOICE_EMAIL auch ohne IBAN: dann ist invoicing null, das Postfach aber da (Rechnung von Hand)
  const to = env.FEEDBACK_TO || invoicing?.creditor.email || env.INVOICE_EMAIL || ''
  if (!to)
    return null
  return {
    to,
    from: env.FEEDBACK_FROM || invoicing?.from || `Wartungsheft <${to}>`,
    resendToken: env.RESEND_TOKEN || '',
  }
}

/**
 * Ohne IBAN keine QR-Rechnung, aber trotzdem Bestellungen: der Auftrag, die Rechnung von Hand zu schreiben, geht an
 * INVOICE_EMAIL, ersatzweise FEEDBACK_TO. Mit IBAN null, dann verschickt der Proxy die Rechnung selbst.
 */
export function loadInvoiceRequests(env: NodeJS.ProcessEnv, invoicing: InvoicingConfig | null): FeedbackConfig | null {
  if (invoicing)
    return null
  const to = env.INVOICE_EMAIL || env.FEEDBACK_TO || ''
  if (!to)
    return null
  return {
    to,
    from: env.INVOICE_FROM || env.FEEDBACK_FROM || `Wartungsheft <${to}>`,
    resendToken: env.RESEND_TOKEN || '',
  }
}

function stripePricesFrom(env: NodeJS.ProcessEnv): Record<string, string> {
  const prices: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('STRIPE_PRICE_') && value)
      prices[name.slice('STRIPE_PRICE_'.length).toLowerCase()] = value
  }
  return prices
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value)
    throw new Error(`Umgebungsvariable ${name} fehlt`)
  return value
}

function detectBackend(env: NodeJS.ProcessEnv): Backend {
  if (env.SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY)
    return 'supabase'
  if (env.INSTANT_APP_ID || env.INSTANT_ADMIN_TOKEN)
    return 'instant'
  throw new Error('Kein Backend konfiguriert: entweder SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY oder INSTANT_APP_ID + INSTANT_ADMIN_TOKEN setzen')
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const authBypass = env.AI_PROXY_AUTH_BYPASS === '1'
  const mistralApiKey = required(env, 'MISTRAL_API_KEY')
  const backend = detectBackend(env)
  const invoicing = loadInvoicing(env)
  return {
    port: Number(env.PORT || 8787),
    mistralApiKey,
    mistralBaseUrl: env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    backend,
    instantApiUri: env.INSTANT_API_URI || 'http://localhost:8888',
    instantAppId: backend === 'instant' ? required(env, 'INSTANT_APP_ID') : '',
    instantAdminToken: backend === 'instant' ? required(env, 'INSTANT_ADMIN_TOKEN') : '',
    supabase: backend === 'supabase'
      ? { url: required(env, 'SUPABASE_URL'), serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY') }
      : null,
    authBypass,
    burstLimit: Number(env.AI_PROXY_BURST_LIMIT || BURST_LIMIT),
    corsOrigin: env.CORS_ORIGIN || '*',
    appUrl: env.APP_URL || 'http://localhost:5173',
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    stripePrices: stripePricesFrom(env),
    internalToken: env.AI_PROXY_INTERNAL_TOKEN || '',
    invoicing,
    feedback: loadFeedback(env, invoicing),
    invoiceRequests: loadInvoiceRequests(env, invoicing),
  }
}
