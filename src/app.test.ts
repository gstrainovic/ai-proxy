import type { AppDeps } from './app.ts'
import { describe, expect, it } from 'vitest'
import { PLANS } from './plans.ts'
import { createApp } from './app.ts'
import { currentMonth } from './limits.ts'
import { MemoryStore } from './stores/memory.ts'

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
    await store.setSubscription('user-1', { plan: 'pro', status: 'active' })
    await store.addUsage('user-1', currentMonth(), { ocrPages: PLANS.free.limits.ocrPages + 1, chatTokens: 0 })
    const res = await app.request('/v1/ocr', { method: 'POST', headers: auth, body: '{}' })
    expect(res.status).toBe(200)
  })
})

describe('usage endpoint', () => {
  it('returns plan, limits and current usage', async () => {
    const { app, store } = setup()
    await store.addUsage('user-1', currentMonth(), { ocrPages: 3, chatTokens: 4000 })
    const res = await app.request('/me/usage', { headers: { Authorization: 'Bearer valid-token' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      plan: 'free',
      month: currentMonth(),
      usage: { ocrPages: 3, chatTokens: 4000 },
      limits: PLANS.free.limits,
    })
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
