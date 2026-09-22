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

describe('loadConfig Rückmeldungen', () => {
  const env = { ...base, INSTANT_APP_ID: 'app', INSTANT_ADMIN_TOKEN: 'tok' }

  it('läuft ohne Rechnungsangaben: FEEDBACK_TO und RESEND_TOKEN genügen', () => {
    const config = loadConfig({ ...env, RESEND_TOKEN: 're_x', FEEDBACK_TO: 'info@wartungsheft.ch' })
    expect(config.invoicing).toBeNull()
    expect(config.feedback).toMatchObject({ to: 'info@wartungsheft.ch', resendToken: 're_x' })
  })

  it('ohne Ziel bleibt die Rückmeldung aus', () => {
    expect(loadConfig({ ...env, RESEND_TOKEN: 're_x' }).feedback).toBeNull()
  })

  it('das Postfach der Rechnung dient als Ziel, wenn FEEDBACK_TO fehlt', () => {
    const config = loadConfig({
      ...env,
      RESEND_TOKEN: 're_x',
      INVOICE_IBAN: 'CH93 0076 2011 6238 5295 7',
      INVOICE_CREDITOR_NAME: 'Goran Strainovic',
      INVOICE_STREET: 'Bahnstrasse 9b',
      INVOICE_ZIP: '9323',
      INVOICE_CITY: 'Steinach',
      INVOICE_EMAIL: 'info@wartungsheft.ch',
    })
    expect(config.feedback?.to).toBe('info@wartungsheft.ch')
  })
})

describe('loadConfig Jahresrechnung', () => {
  const env = { ...base, INSTANT_APP_ID: 'app', INSTANT_ADMIN_TOKEN: 'tok' }
  const invoiceEnv = {
    ...env,
    INVOICE_IBAN: 'CH93 0076 2011 6238 5295 7',
    INVOICE_CREDITOR_NAME: 'Goran Strainovic',
    INVOICE_TRADE_NAME: 'Strainovic IT',
    INVOICE_BRAND: 'Wartungsheft',
    INVOICE_STREET: 'Bahnstrasse 9b',
    INVOICE_ZIP: '9323',
    INVOICE_CITY: 'Steinach',
    INVOICE_EMAIL: 'info@wartungsheft.ch',
    INVOICE_WEBSITE: 'wartungsheft.ch',
  }

  it('ohne INVOICE_IBAN ist die Rechnung aus', () => {
    expect(loadConfig(env).invoicing).toBeNull()
  })

  it('mit IBAN: Empfänger vollständig, Versand über Resend mit Absender und Kopie', () => {
    const config = loadConfig({ ...invoiceEnv, RESEND_TOKEN: 're_x', INVOICE_FROM: 'Wartungsheft <rechnung@wartungsheft.ch>' })
    expect(config.invoicing).toMatchObject({
      creditor: { name: 'Goran Strainovic', tradeName: 'Strainovic IT', brand: 'Wartungsheft', street: 'Bahnstrasse 9b', zip: '9323', city: 'Steinach', iban: 'CH93 0076 2011 6238 5295 7', email: 'info@wartungsheft.ch', website: 'wartungsheft.ch' },
      resendToken: 're_x',
      from: 'Wartungsheft <rechnung@wartungsheft.ch>',
      bcc: 'info@wartungsheft.ch',
    })
  })

  it('fehlende Absenderangaben brechen mit klarer Meldung ab', () => {
    const { INVOICE_STREET: _, ...rest } = invoiceEnv
    expect(() => loadConfig(rest)).toThrow(/INVOICE_STREET/)
  })

  it('ungültige IBAN bricht beim Start ab, nicht erst bei der ersten Rechnung', () => {
    expect(() => loadConfig({ ...invoiceEnv, INVOICE_IBAN: 'CH00 0000 0000 0000 0000 0' })).toThrow(/IBAN/)
  })
})

describe('loadConfig Rechnung von Hand', () => {
  const env = { ...base, INSTANT_APP_ID: 'app', INSTANT_ADMIN_TOKEN: 'tok' }

  it('ohne IBAN geht der Auftrag an INVOICE_EMAIL, ersatzweise FEEDBACK_TO', () => {
    expect(loadConfig({ ...env, INVOICE_EMAIL: 'info@wartungsheft.ch', RESEND_TOKEN: 're_x' }).invoiceRequests)
      .toEqual({ to: 'info@wartungsheft.ch', from: 'Wartungsheft <info@wartungsheft.ch>', resendToken: 're_x' })
    expect(loadConfig({ ...env, FEEDBACK_TO: 'info@wartungsheft.ch', FEEDBACK_FROM: 'Wartungsheft <rueckmeldung@wartungsheft.ch>' }).invoiceRequests)
      .toEqual({ to: 'info@wartungsheft.ch', from: 'Wartungsheft <rueckmeldung@wartungsheft.ch>', resendToken: '' })
  })

  it('Rückmeldungen gehen auch ohne IBAN an INVOICE_EMAIL', () => {
    expect(loadConfig({ ...env, INVOICE_EMAIL: 'info@wartungsheft.ch' }).feedback?.to).toBe('info@wartungsheft.ch')
  })

  it('ohne Postfach aus, mit IBAN nicht gebraucht', () => {
    expect(loadConfig(env).invoiceRequests).toBeNull()
    const withIban = loadConfig({
      ...env,
      INVOICE_IBAN: 'CH93 0076 2011 6238 5295 7',
      INVOICE_CREDITOR_NAME: 'Goran Strainovic',
      INVOICE_STREET: 'Bahnstrasse 9b',
      INVOICE_ZIP: '9323',
      INVOICE_CITY: 'Steinach',
      INVOICE_EMAIL: 'info@wartungsheft.ch',
    })
    expect(withIban.invoiceRequests).toBeNull()
  })
})

describe('loadConfig fair use', () => {
  it('liest AI_PROXY_BURST_LIMIT, sonst 20 Anfragen pro Minute', () => {
    const env = { ...base, SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' }
    expect(loadConfig(env).burstLimit).toBe(20)
    expect(loadConfig({ ...env, AI_PROXY_BURST_LIMIT: '500' }).burstLimit).toBe(500)
  })
})
