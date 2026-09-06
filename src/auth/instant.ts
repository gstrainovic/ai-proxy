import type { AuthUser } from '../app.ts'
import { init } from '@instantdb/admin'

export interface AuthConfig {
  apiURI: string
  appId: string
  adminToken: string
}

/**
 * Prüft InstantDB-Refresh-Tokens über das Admin-SDK.
 * `issueTestToken` erzeugt per Admin-SDK einen echten Nutzer samt Refresh-Token (Tests, lokaler Server).
 */
export function createVerifyToken(config: AuthConfig) {
  const db = init({ appId: config.appId, adminToken: config.adminToken, apiURI: config.apiURI })

  async function verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const user = await db.auth.verifyToken(token)
      return user?.id ? { id: user.id } : null
    }
    catch {
      return null
    }
  }

  async function issueTestToken(email: string): Promise<{ userId: string, refreshToken: string }> {
    const refreshToken = await db.auth.createToken(email)
    const user = await db.auth.verifyToken(refreshToken)
    return { userId: user.id, refreshToken }
  }

  return { verifyToken, issueTestToken }
}
