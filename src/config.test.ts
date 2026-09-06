import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'

const base = { MISTRAL_API_KEY: 'sk' }

describe('loadConfig backend selection', () => {
  it('uses supabase when SUPABASE_URL and service role key are set, without needing InstantDB vars', () => {
    const config = loadConfig({ ...base, SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'srk' })
    expect(config.backend).toBe('supabase')
    expect(config.supabase).toEqual({ url: 'http://localhost:54321', serviceRoleKey: 'srk' })
  })

  it('uses instant when INSTANT_APP_ID and admin token are set', () => {
    const config = loadConfig({ ...base, INSTANT_APP_ID: 'app', INSTANT_ADMIN_TOKEN: 'tok' })
    expect(config.backend).toBe('instant')
    expect(config.instantAppId).toBe('app')
  })

  it('fails with a clear message when neither backend is configured', () => {
    expect(() => loadConfig({ ...base })).toThrow(/SUPABASE_URL.*INSTANT_APP_ID|INSTANT_APP_ID.*SUPABASE_URL/)
  })

  it('still requires the mistral key', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toThrow(/MISTRAL_API_KEY/)
  })
})

describe('loadConfig stripe prices', () => {
  it('collects every STRIPE_PRICE_<PLAN> variable into a map keyed by lowercased plan id', () => {
    const config = loadConfig({ ...base, SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', STRIPE_PRICE_PRO: 'price_1', STRIPE_PRICE_BUSINESS: 'price_2', STRIPE_PRICE_EMPTY: '' })
    expect(config.stripePrices).toEqual({ pro: 'price_1', business: 'price_2' })
  })

  it('reads the optional internal token', () => {
    const config = loadConfig({ ...base, SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', AI_PROXY_INTERNAL_TOKEN: 'secret' })
    expect(config.internalToken).toBe('secret')
  })
})
