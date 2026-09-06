import process from 'node:process'

export interface ServerConfig {
  port: number
  mistralApiKey: string
  mistralBaseUrl: string
  instantApiUri: string
  instantAppId: string
  instantAdminToken: string
  authBypass: boolean
  corsOrigin: string
  appUrl: string
  stripeSecretKey: string
  stripeWebhookSecret: string
  stripePrices: Record<string, string>
}

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(`Umgebungsvariable ${name} fehlt`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const authBypass = env.AI_PROXY_AUTH_BYPASS === '1'
  return {
    port: Number(env.PORT || 8787),
    mistralApiKey: required('MISTRAL_API_KEY'),
    mistralBaseUrl: env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    instantApiUri: env.INSTANT_API_URI || 'http://localhost:8888',
    instantAppId: required('INSTANT_APP_ID'),
    instantAdminToken: required('INSTANT_ADMIN_TOKEN'),
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
