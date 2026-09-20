import type { AppDeps, FeedbackNotice } from './app.ts'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { MemoryStore } from './stores/memory.ts'

function setup(options: { feedback?: boolean, transcribeFails?: boolean } = {}) {
  const notices: FeedbackNotice[] = []
  const deps: AppDeps = {
    mistralApiKey: 'k',
    mistralBaseUrl: 'https://mistral.test/v1',
    verifyToken: async token => (token === 'valid-token' ? { id: 'user-1', email: 'kunde@example.ch' } : null),
    store: new MemoryStore(),
    authBypass: false,
    // Transkription: der Proxy ruft /audio/transcriptions bei Mistral
    mistralFetch: async (input) => {
      if (String(input).includes('/audio/transcriptions')) {
        if (options.transcribeFails)
          return new Response('kaputt', { status: 500 })
        return new Response(JSON.stringify({ text: 'Das Datum wird falsch erkannt.' }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    },
    feedback: options.feedback === false ? null : { notify: async n => void notices.push(n) },
  }
  return { app: createApp(deps), notices }
}

const headers = { Authorization: 'Bearer valid-token' }

function form(fields: { text?: string, page?: string, audio?: Blob }) {
  const fd = new FormData()
  if (fields.text !== undefined)
    fd.append('text', fields.text)
  if (fields.page)
    fd.append('page', fields.page)
  if (fields.audio)
    fd.append('audio', fields.audio, 'nachricht.webm')
  return fd
}

describe('POST /feedback', () => {
  it('verlangt Anmeldung', async () => {
    const { app } = setup()
    expect((await app.request('/feedback', { method: 'POST', body: form({ text: 'hallo' }) })).status).toBe(401)
  })

  it('ohne Konfiguration 501', async () => {
    const { app } = setup({ feedback: false })
    expect((await app.request('/feedback', { method: 'POST', headers, body: form({ text: 'hallo' }) })).status).toBe(501)
  })

  it('leere Rückmeldung wird abgelehnt', async () => {
    const { app } = setup()
    const res = await app.request('/feedback', { method: 'POST', headers, body: form({ text: '  ' }) })
    expect(res.status).toBe(400)
  })

  it('schickt Text mit Seite und Absender an den Betreiber', async () => {
    const { app, notices } = setup()
    const res = await app.request('/feedback', { method: 'POST', headers, body: form({ text: 'Das Datum stimmt nicht', page: '/vehicles/7' }) })
    expect(res.status).toBe(200)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.text).toContain('Das Datum stimmt nicht')
    expect(notices[0]!.text).toContain('kunde@example.ch')
    expect(notices[0]!.text).toContain('/vehicles/7')
    expect(notices[0]!.audio).toBeUndefined()
  })

  it('transkribiert die Aufnahme und hängt sie an', async () => {
    const { app, notices } = setup()
    const audio = new Blob([new Uint8Array(2048)], { type: 'audio/webm' })
    const res = await app.request('/feedback', { method: 'POST', headers, body: form({ audio }) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).transcript).toBe('Das Datum wird falsch erkannt.')
    expect(notices[0]!.text).toContain('Das Datum wird falsch erkannt.')
    expect(notices[0]!.audio?.filename).toBe('nachricht.webm')
  })

  it('scheitert die Transkription, geht die Aufnahme trotzdem raus', async () => {
    const { app, notices } = setup({ transcribeFails: true })
    const audio = new Blob([new Uint8Array(2048)], { type: 'audio/webm' })
    const res = await app.request('/feedback', { method: 'POST', headers, body: form({ audio }) })
    expect(res.status).toBe(200)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.audio).toBeDefined()
  })
})
