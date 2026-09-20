import type { AppDeps } from './app.ts'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { currentMonth } from './limits.ts'
import { MemoryStore } from './stores/memory.ts'

function setup(options: { fails?: boolean, burstLimit?: number } = {}) {
  const store = new MemoryStore()
  const deps: AppDeps = {
    mistralApiKey: 'k',
    mistralBaseUrl: 'https://mistral.test/v1',
    verifyToken: async token => (token === 'valid-token' ? { id: 'user-1' } : null),
    store,
    authBypass: false,
    burstLimit: options.burstLimit,
    mistralFetch: async (input) => {
      if (!String(input).includes('/audio/transcriptions'))
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      if (options.fails)
        return new Response('kaputt', { status: 500 })
      return new Response(JSON.stringify({ text: 'Bremsbeläge vorne ersetzt.' }), { headers: { 'content-type': 'application/json' } })
    },
  }
  return Object.assign(createApp(deps), { store })
}

const headers = { Authorization: 'Bearer valid-token' }

function audioForm(bytes = 2048) {
  const fd = new FormData()
  fd.append('audio', new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }), 'diktat.webm')
  return fd
}

describe('POST /me/transcribe', () => {
  it('verlangt Anmeldung', async () => {
    expect((await setup().request('/me/transcribe', { method: 'POST', body: audioForm() })).status).toBe(401)
  })

  it('gibt den erkannten Text zurück', async () => {
    const res = await setup().request('/me/transcribe', { method: 'POST', headers, body: audioForm() })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).text).toBe('Bremsbeläge vorne ersetzt.')
  })

  it('ohne Aufnahme 400', async () => {
    expect((await setup().request('/me/transcribe', { method: 'POST', headers, body: new FormData() })).status).toBe(400)
  })

  it('zu lange Aufnahme 400', async () => {
    const res = await setup().request('/me/transcribe', { method: 'POST', headers, body: audioForm(6 * 1024 * 1024) })
    expect(res.status).toBe(400)
  })

  it('scheitert die Erkennung, sagt die Antwort es deutlich', async () => {
    const res = await setup({ fails: true }).request('/me/transcribe', { method: 'POST', headers, body: audioForm() })
    expect(res.status).toBe(502)
    expect(((await res.json()) as any).error.message).toMatch(/nicht verstanden/i)
  })

  it('nach der Testzeit 402 wie Scan und Chat', async () => {
    const app = setup()
    const started = new Date(Date.now() - 31 * 86_400_000).toISOString()
    await app.store.setSubscription('user-1', { plan: 'free', status: 'trial', trialStartedAt: started })
    const res = await app.request('/me/transcribe', { method: 'POST', headers, body: audioForm() })
    expect(res.status).toBe(402)
    expect(((await res.json()) as any).error.code).toBe('trial_expired')
  })

  it('die Fair-Use-Bremse gilt auch fürs Diktat', async () => {
    const app = setup({ burstLimit: 2 })
    await app.request('/me/transcribe', { method: 'POST', headers, body: audioForm() })
    await app.request('/me/transcribe', { method: 'POST', headers, body: audioForm() })
    const res = await app.request('/me/transcribe', { method: 'POST', headers, body: audioForm() })
    expect(res.status).toBe(429)
  })

  it('zählt die Aufnahme auf das Kontingent', async () => {
    const app = setup()
    // 30 KB Opus sind rund 10 Sekunden; die Umrechnung steht in TOKENS_PER_AUDIO_SECOND
    await app.request('/me/transcribe', { method: 'POST', headers, body: audioForm(30_000) })
    const usage = await app.store.getUsage('user-1', currentMonth())
    expect(usage.chatTokens).toBeGreaterThan(0)
  })
})
