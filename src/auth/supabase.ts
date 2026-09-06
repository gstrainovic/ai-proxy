import type { AuthUser } from '../app.ts'
import { createClient } from '@supabase/supabase-js'

export interface SupabaseAuthConfig {
  url: string
  serviceRoleKey: string
}

/**
 * Prüft Supabase-Access-Tokens (JWT der Nutzer-Session) über `auth.getUser(jwt)` gegen den Auth-Server.
 * `issueTestToken` legt per Admin-API einen Nutzer an und liefert ein echtes Access-Token (Tests, lokal).
 */
export function createVerifyToken(config: SupabaseAuthConfig) {
  const admin = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  async function verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const { data, error } = await admin.auth.getUser(token)
      if (error || !data.user?.id)
        return null
      // Der Service-Role-Key ist selbst ein JWT ohne Nutzer, der darf nie als Nutzer durchgehen
      return data.user.aud === 'authenticated' ? { id: data.user.id } : null
    }
    catch {
      return null
    }
  }

  async function issueTestToken(email: string): Promise<{ userId: string, accessToken: string }> {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (createError || !created.user)
      throw new Error(`Testnutzer anlegen fehlgeschlagen: ${createError?.message}`)
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkError || !link.properties?.hashed_token)
      throw new Error(`Magic-Link fehlgeschlagen: ${linkError?.message}`)
    const { data: session, error: verifyError } = await admin.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
    if (verifyError || !session.session)
      throw new Error(`Session fehlgeschlagen: ${verifyError?.message}`)
    return { userId: created.user.id, accessToken: session.session.access_token }
  }

  return { verifyToken, issueTestToken }
}
