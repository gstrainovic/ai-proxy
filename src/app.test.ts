import type { AppDeps } from './app.ts'
import { describe, expect, it } from 'vitest'
import { PLANS } from './plans.ts'
import { createApp } from './app.ts'
import { currentMonth } from './limits.ts'
import { MemoryStore } from './stores/memory.ts'
import type { PlanCatalog } from './plans.ts'

function mistralResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setup(overrides: Partial<AppDeps> = {}) {
  const calls: { url: string, init: RequestInit }[] = []
  const store = new MemoryStore()
  const deps: AppDeps = {
    mistralApiKey: 'server-secret-key',
    mistralBaseUrl: 'https://mistral.test/v1',
    verifyToken: async token => (token === 'valid-token' ? { id: 'user-1' } : null),
    store,
    authBypass: false,
    mistralFetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return mistralResponse({ ok: true })
    },
    ...overrides,
  }
  return { app: createApp(deps), deps, calls, store }
}

const auth = { 'Authorization': 'Bearer valid-token', 'content-type': 'application/json' }

describe('auth', () => {
  it('rejects requests without a bearer token', async () => {
    const { app, calls } = setup()
    const res = await app.request('/v1/chat/completions', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('rejects an invalid token', async () => {
    const { app } = setup()
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      body: '{}',
      headers: { 'Authorization': 'Bearer nope', 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('accepts x-user-id header only in bypass mode', async () => {
    const withBypass = setup({ authBypass: true })
    const ok = await withBypass.app.request('/me/usage', { headers: { 'x-user-id': 'e2e-user' } })
    expect(ok.status).toBe(200)

    const noBypass = setup()
    const denied = await noBypass.app.request('/me/usage', { headers: { 'x-user-id': 'e2e-user' } })
    expect(denied.status).toBe(401)
  })
})

describe('chat proxy', () => {
  it('forwards the request with the server key and records token usage', async () => {
    const { app, calls, store } = setup({
      mistralFetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return mistralResponse({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } })
      },
    })
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ model: 'mistral-small-latest', messages: [] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ usage: { total_tokens: 150 } })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://mistral.test/v1/chat/completions')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer server-secret-key')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'mistral-small-latest' })

    const usage = await store.getUsage('user-1', currentMonth())
    expect(usage.chatTokens).toBe(150)
    expect(usage.ocrPages).toBe(0)
  })

  it('blocks with 402 once the chat token limit is reached and does not call Mistral', async () => {
    const { app, calls, store } = setup()
    await store.addUsage('user-1', currentMonth(), { chatTokens: PLANS.free.limits.chatTokens, ocrPages: 0 })
    const res = await app.request('/v1/chat/completions', { method: 'POST', headers: auth, body: '{}' })
    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.error.code).toBe('limit_reached')
    expect(body.error.message).toMatch(/Chat-Tokens/)
    expect(calls).toHaveLength(0)
  })

  it('passes Mistral error status and body through', async () => {
    const { app } = setup({
      mistralFetch: async () => mistralResponse({ message: 'Rate limit exceeded' }, 429),
    })
    const res = await app.request('/v1/chat/completions', { method: 'POST', headers: auth, body: '{}' })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ message: 'Rate limit exceeded' })
  })
})

describe('ocr proxy', () => {
  it('forwards to /ocr and records processed pages', async () => {
    const { app, calls, store } = setup({
      mistralFetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return mistralResponse({ pages: [{ index: 0, markdown: 'x' }, { index: 1, markdown: 'y' }], usage_info: { pages_processed: 2, doc_size_bytes: 10 } })
      },
    })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: auth, body: JSON.stringify({ model: 'mistral-ocr-latest' }) })
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://mistral.test/v1/ocr')
    expect((await store.getUsage('user-1', currentMonth())).ocrPages).toBe(2)
  })

  it('blocks with 402 once the scan limit is reached', async () => {
    const { app, calls, store } = setup()
    await store.addUsage('user-1', currentMonth(), { ocrPages: PLANS.free.limits.ocrPages, chatTokens: 0 })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: auth, body: '{}' })
    expect(res.status).toBe(402)
    expect(((await res.json()) as any).error.message).toMatch(/Scans/)
    expect(calls).toHaveLength(0)
  })

  it('uses the higher limits of a paid plan', async () => {
    const { app, store } = setup()
    await store.setSubscription('user-1', { plan: 'betrieb', status: 'active' })
    await store.addUsage('user-1', currentMonth(), { ocrPages: PLANS.free.limits.ocrPages + 1, chatTokens: 0 })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: auth, body: '{}' })
    expect(res.status).toBe(200)
  })
})

describe('usage endpoint', () => {
  it('returns plan, limits, current usage and the running trial', async () => {
    const { app, store } = setup()
    await store.addUsage('user-1', currentMonth(), { ocrPages: 3, chatTokens: 4000 })
    const res = await app.request('/me/usage', { headers: { Authorization: 'Bearer valid-token' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      plan: 'free',
      month: currentMonth(),
      usage: { ocrPages: 3, chatTokens: 4000 },
      limits: PLANS.free.limits,
      trial: { active: true, daysLeft: 30 },
    })
    // der erste Aufruf hat die Testzeit begonnen
    expect(await store.getSubscription('user-1')).toMatchObject({ status: 'trial' })
  })

  it('blocks scan and chat with 402 once the trial is over, no Mistral call', async () => {
    const { app, store, calls } = setup()
    const started = new Date(Date.now() - 31 * 86_400_000).toISOString()
    await store.setSubscription('user-1', { plan: 'free', status: 'trial', trialStartedAt: started })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: { 'Authorization': 'Bearer valid-token', 'Content-Type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('trial_expired')
    expect(body.message).toContain('Testzeit vorbei')
    expect(body.message).toContain('36 CHF')
    expect(calls.length).toBe(0)
    // die Nutzungsabfrage bleibt frei und meldet die abgelaufene Testzeit
    const usage = await app.request('/me/usage', { headers: { Authorization: 'Bearer valid-token' } })
    expect(await usage.json()).toMatchObject({ trial: { active: false, daysLeft: 0 } })
  })

  it('has a health endpoint', async () => {
    const { app } = setup()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })
})

describe('limit error format', () => {
  it('uses the Mistral error shape so the AI SDK surfaces the German message', async () => {
    const { app, store } = setup()
    await store.addUsage('user-1', currentMonth(), { chatTokens: PLANS.free.limits.chatTokens, ocrPages: 0 })
    const res = await app.request('/v1/chat/completions', { method: 'POST', headers: auth, body: '{}' })
    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.object).toBe('error')
    expect(body.type).toBe('limit_reached')
    expect(body.message).toMatch(/Monatslimit erreicht/)
    expect(body.error.message).toBe(body.message)
  })
})

describe('model allow-list', () => {
  it('rejects chat models that are not on the allow-list', async () => {
    const { app, calls } = setup()
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ model: 'mistral-large-latest', messages: [] }),
    })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('test hook /test/usage', () => {
  it('sets usage for the current user in bypass mode', async () => {
    const { app, store } = setup({ authBypass: true })
    const res = await app.request('/test/usage', {
      method: 'PUT',
      headers: { 'x-user-id': 'e2e-user', 'content-type': 'application/json' },
      body: JSON.stringify({ usage: { ocrPages: 4, chatTokens: 99 } }),
    })
    expect(res.status).toBe(200)
    expect(await store.getUsage('e2e-user', currentMonth())).toEqual({ ocrPages: 4, chatTokens: 99 })
  })

  it('does not exist outside bypass mode', async () => {
    const { app } = setup()
    const res = await app.request('/test/usage', {
      method: 'PUT',
      headers: { ...auth },
      body: JSON.stringify({ usage: { ocrPages: 4, chatTokens: 99 } }),
    })
    expect(res.status).toBe(404)
  })
})

describe('embeddings proxy', () => {
  it('forwards to /embeddings and counts total_tokens as chatTokens', async () => {
    const { app, calls, store } = setup({
      mistralFetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return mistralResponse({ data: [{ embedding: [0.1], index: 0 }], usage: { prompt_tokens: 42, total_tokens: 42, completion_tokens: 0 } })
      },
    })
    const res = await app.request('/v1/embeddings', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ model: 'mistral-embed', input: ['Hallo'] }),
    })
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://mistral.test/v1/embeddings')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer server-secret-key')
    expect((await store.getUsage('user-1', currentMonth())).chatTokens).toBe(42)
  })

  it('rejects models other than mistral-embed', async () => {
    const { app, calls } = setup()
    const res = await app.request('/v1/embeddings', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ model: 'mistral-large-latest', input: ['x'] }),
    })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('blocks embeddings when the chat token limit is reached', async () => {
    const { app, calls, store } = setup()
    await store.addUsage('user-1', currentMonth(), { chatTokens: PLANS.free.limits.chatTokens, ocrPages: 0 })
    const res = await app.request('/v1/embeddings', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ model: 'mistral-embed', input: ['x'] }),
    })
    expect(res.status).toBe(402)
    expect(calls).toHaveLength(0)
  })
})

const dmsCatalog: PlanCatalog = {
  defaultPlan: 'starter',
  plans: {
    starter: { id: 'starter', name: 'Starter', priceChfPerMonth: 0, limits: { ocrPages: 3, chatTokens: 1000 } },
    pro: { id: 'pro', name: 'Pro', priceChfPerMonth: 19, limits: { ocrPages: 2000, chatTokens: 10_000_000 } },
  },
}

describe('injected plan catalog', () => {
  it('reports the catalog default plan and its limits in /me/usage and includes all plans', async () => {
    const { app } = setup({ plans: dmsCatalog })
    const res = await app.request('/me/usage', { headers: auth })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plan).toBe('starter')
    expect(body.limits).toEqual({ ocrPages: 3, chatTokens: 1000 })
    expect(Object.keys(body.plans)).toEqual(['starter', 'pro'])
    expect(body.plans.pro.priceChfPerMonth).toBe(19)
  })

  it('enforces the catalog limits and names the catalog plan in the error', async () => {
    const { app, store, calls } = setup({ plans: dmsCatalog })
    await store.addUsage('user-1', currentMonth(), { ocrPages: 3, chatTokens: 0 })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: auth, body: JSON.stringify({ model: 'mistral-ocr-latest' }) })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.message).toContain('Starter')
    expect(body.error).toMatchObject({ code: 'limit_reached', limit: 3, plan: 'starter' })
    expect(calls).toHaveLength(0)
  })

  it('falls back to the catalog default when the stored plan is unknown', async () => {
    const { app, store } = setup({ plans: dmsCatalog })
    await store.setSubscription('user-1', { plan: 'privat', status: 'active' })
    const res = await app.request('/me/usage', { headers: auth })
    expect((await res.json()).plan).toBe('starter')
  })
})

describe('internal token (server-to-server calls on behalf of a user)', () => {
  const internal = { 'Authorization': 'Bearer internal-secret', 'content-type': 'application/json' }

  it('accepts the internal token together with x-user-id and counts usage for that user', async () => {
    const { app, store } = setup({
      internalToken: 'internal-secret',
      mistralFetch: async () => mistralResponse({ usage_info: { pages_processed: 4 } }),
    })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: { ...internal, 'x-user-id': 'pipeline-user' }, body: '{}' })
    expect(res.status).toBe(200)
    expect((await store.getUsage('pipeline-user', currentMonth())).ocrPages).toBe(4)
  })

  it('rejects the internal token without x-user-id and rejects a wrong internal token', async () => {
    const { app } = setup({ internalToken: 'internal-secret' })
    const noUser = await app.request('/me/usage', { headers: internal })
    expect(noUser.status).toBe(401)
    const wrong = await app.request('/me/usage', { headers: { 'Authorization': 'Bearer other', 'x-user-id': 'u' } })
    expect(wrong.status).toBe(401)
  })

  it('ignores x-user-id when no internal token is configured', async () => {
    const { app } = setup()
    const res = await app.request('/me/usage', { headers: { 'Authorization': 'Bearer internal-secret', 'x-user-id': 'u' } })
    expect(res.status).toBe(401)
  })
})

describe('konto statt person (accountOf)', () => {
  const tokens: Record<string, string> = { 'token-anna': 'anna', 'token-ben': 'ben', 'token-ohne': 'ohne-konto' }
  const konten: Record<string, string> = { anna: 'firma-1', ben: 'firma-1' }
  const headers = (token: string) => ({ 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' })

  function setupKonten() {
    return setup({
      verifyToken: async token => (tokens[token] ? { id: tokens[token] } : null),
      accountOf: async user => konten[user.id] ?? null,
      internalToken: 'internal-secret',
      mistralFetch: async () => mistralResponse({ usage_info: { pages_processed: 3 } }),
    })
  }

  it('zählt den Verbrauch aller Mitglieder auf ein gemeinsames Konto', async () => {
    const { app, store } = setupKonten()
    await app.request('/v1/ocr', { method: 'POST', headers: headers('token-anna'), body: '{}' })
    await app.request('/v1/ocr', { method: 'POST', headers: headers('token-ben'), body: '{}' })
    expect((await store.getUsage('firma-1', currentMonth())).ocrPages).toBe(6)
    const usage = await (await app.request('/me/usage', { headers: headers('token-ben') })).json()
    expect(usage.usage.ocrPages).toBe(6)
  })

  it('führt Testzeit und Abo pro Konto', async () => {
    const { app, store } = setupKonten()
    await app.request('/me/usage', { headers: headers('token-anna') })
    expect(await store.getSubscription('firma-1')).toMatchObject({ status: 'trial' })
    expect(await store.getSubscription('anna')).toBeNull()
  })

  it('lehnt Personen ohne Konto ab', async () => {
    const { app } = setupKonten()
    const res = await app.request('/me/usage', { headers: headers('token-ohne') })
    expect(res.status).toBe(401)
  })

  it('nimmt bei internen Aufrufen x-user-id direkt als Konto', async () => {
    const { app, store } = setupKonten()
    const res = await app.request('/v1/ocr', { method: 'POST', headers: { ...headers('internal-secret'), 'x-user-id': 'firma-2' }, body: '{}' })
    expect(res.status).toBe(200)
    expect((await store.getUsage('firma-2', currentMonth())).ocrPages).toBe(3)
  })
})

describe('fair use', () => {
  it('bremst ab der Schwelle mit 429 und Retry-After', async () => {
    const { app, calls } = setup({ burstLimit: 2 })
    const body = JSON.stringify({ model: 'mistral-small-latest', messages: [] })
    for (let i = 0; i < 2; i++)
      expect((await app.request('/v1/chat/completions', { method: 'POST', body, headers: auth })).status).toBe(200)
    const res = await app.request('/v1/chat/completions', { method: 'POST', body, headers: auth })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(calls).toHaveLength(2)
  })
})

describe('konto löschen (POST /me/delete)', () => {
  it('verlangt eine Anmeldung', async () => {
    const { app } = setup()
    const res = await app.request('/me/delete', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('löscht Verbrauch und Testzeit und das Login', async () => {
    const deleted: string[] = []
    const { app, store } = setup({ deleteAuthUser: async (id) => { deleted.push(id) } })
    await store.addUsage('user-1', currentMonth(), { ocrPages: 4 })
    await store.setSubscription('user-1', { plan: 'privat', status: 'trial', trialStartedAt: '2026-09-01' })
    const res = await app.request('/me/delete', { method: 'POST', headers: auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect((await store.getUsage('user-1', currentMonth())).ocrPages).toBe(0)
    expect(await store.getSubscription('user-1')).toBeNull()
    expect(deleted).toEqual(['user-1'])
  })

  it('behält ein Abo mit gestellten Rechnungen als Buchhaltungsbeleg, aber ohne Verlängerung', async () => {
    const { app, store } = setup({ deleteAuthUser: async () => {} })
    await store.setSubscription('user-1', {
      plan: 'betrieb',
      status: 'active',
      billing: 'invoice',
      vehicles: 3,
      invoices: [{ number: 'R-1', reference: 'x', amount: 108, currency: 'CHF', issueDate: '2026-09-01', dueAt: '2026-10-01', periodStart: '2026-09-01', periodEnd: '2027-09-01', vehicles: 3, status: 'open' } as any],
    })
    const res = await app.request('/me/delete', { method: 'POST', headers: auth })
    expect(res.status).toBe(200)
    const sub = await store.getSubscription('user-1')
    expect(sub?.invoices).toHaveLength(1)
    expect(sub?.status).toBe('canceled')
    expect(sub?.cancelAtPeriodEnd).toBe(true)
  })

  it('antwortet 502, wenn das Login nicht gelöscht werden kann', async () => {
    const { app } = setup({ deleteAuthUser: async () => { throw new Error('admin down') } })
    const res = await app.request('/me/delete', { method: 'POST', headers: auth })
    expect(res.status).toBe(502)
  })

  it('lehnt interne Aufrufe ab', async () => {
    const { app } = setup({ internalToken: 'internal-secret' })
    const res = await app.request('/me/delete', { method: 'POST', headers: { 'Authorization': 'Bearer internal-secret', 'x-user-id': 'user-9' } })
    expect(res.status).toBe(403)
  })
})
