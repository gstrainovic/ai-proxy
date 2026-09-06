import process from 'node:process'

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
  corsOrigin: string
  appUrl: string
  stripeSecretKey: string
  stripeWebhookSecret: string
  stripePrices: Record<string, string>
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
    corsOrigin: env.CORS_ORIGIN || '*',
    appUrl: env.APP_URL || 'http://localhost:5173',
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    stripePrices: {
      basic: env.STRIPE_PRICE_BASIC || '',
      pro: env.STRIPE_PRICE_PRO || '',
    },
  }
}
