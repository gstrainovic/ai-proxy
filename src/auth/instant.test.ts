import { describe, expect, it } from 'vitest'
import { createVerifyToken } from './instant.ts'

const API_URI = process.env.INSTANT_API_URI || 'http://localhost:8888'
const APP_ID = process.env.INSTANT_APP_ID || 'cd7e6912-773b-4ee1-be18-4d95c3b20e9f'
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(API_URI, { signal: AbortSignal.timeout(2000) })
    return res.status < 500
  }
  catch {
    return false
  }
}

const reachable = await serverReachable()

describe.skipIf(!reachable)('verifyToken (integration, local InstantDB)', () => {
  const { verifyToken, issueTestToken } = createVerifyToken({ apiURI: API_URI, appId: APP_ID, adminToken: ADMIN_TOKEN })

  it('returns null for an unknown token', async () => {
    expect(await verifyToken('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('resolves a real refresh token to the user id', async () => {
    const email = `vitest-${Date.now()}@e2e.local`
    const { userId, refreshToken } = await issueTestToken(email)
    const user = await verifyToken(refreshToken)
    expect(user).toEqual({ id: userId })
  })
})
