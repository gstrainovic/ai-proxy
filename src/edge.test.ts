import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { createEdgeApp } from './edge.ts'

// Supabase-Attrappe, die jede Anfrage mit 500 beantwortet: die Fair-Use-Bremse greift vor jedem Store-Zugriff
const fakeSupabase = createServer((_req, res) => res.writeHead(500, { 'content-type': 'application/json' }).end('{"message":"stub"}'))
await new Promise<void>(resolve => fakeSupabase.listen(0, '127.0.0.1', resolve))
afterAll(() => fakeSupabase.close())

const env = {
  MISTRAL_API_KEY: 'test-key',
  SUPABASE_URL: `http://127.0.0.1:${(fakeSupabase.address() as AddressInfo).port}`,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

function chat(app: ReturnType<typeof createEdgeApp>) {
  return app.request('/ai-proxy/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer service-role-key', 'x-user-id': 'account-1', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'mistral-small-latest', messages: [] }),
  })
}

describe('createEdgeApp', () => {
  it('liest die Fair-Use-Schwelle aus AI_PROXY_BURST_LIMIT', async () => {
    const app = createEdgeApp({ ...env, AI_PROXY_BURST_LIMIT: '1' })
    await chat(app)
    const second = await chat(app)
    expect(second.status).toBe(429)
    expect(second.headers.get('Retry-After')).toBe('60')
  })
})
