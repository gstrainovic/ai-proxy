import { describe, expect, it } from 'vitest'
import { createVerifyToken } from './supabase.ts'

// Integrationstest gegen das lokale Supabase (dms). Wird übersprungen, wenn es nicht läuft.
const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/rest/v1/`, { headers: { apikey: SERVICE_ROLE_KEY }, signal: AbortSignal.timeout(2000) })
    return res.status < 500
  }
  catch {
    return false
  }
}

const reachable = await serverReachable()

describe.skipIf(!reachable)('verifyToken (integration, local Supabase)', () => {
  const { verifyToken, issueTestToken } = createVerifyToken({ url: URL, serviceRoleKey: SERVICE_ROLE_KEY })

  it('returns null for garbage and for the service role key itself', async () => {
    expect(await verifyToken('not-a-jwt')).toBeNull()
    expect(await verifyToken(SERVICE_ROLE_KEY)).toBeNull()
  })

  it('resolves a real access token to the user id', async () => {
    const { userId, accessToken } = await issueTestToken(`vitest-auth-${Date.now()}@test.local`)
    expect(await verifyToken(accessToken)).toEqual({ id: userId })
  })
})
