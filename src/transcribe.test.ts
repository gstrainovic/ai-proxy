import type { AppDeps } from './app.ts'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { MemoryStore } from './stores/memory.ts'

function setup(options: { fails?: boolean } = {}) {
  const deps: AppDeps = {
    mistralApiKey: 'k',
    mistralBaseUrl: 'https://mistral.test/v1',
    verifyToken: async token => (token === 'valid-token' ? { id: 'user-1' } : null),
    store: new MemoryStore(),
    authBypass: false,
    mistralFetch: async (input) => {
      if (!String(input).includes('/audio/transcriptions'))
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      if (options.fails)
        return new Response('kaputt', { status: 500 })
      return new Response(JSON.stringify({ text: 'Bremsbeläge vorne ersetzt.' }), { headers: { 'content-type': 'application/json' } })
    },
  }
  return createApp(deps)
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
})
