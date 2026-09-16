/**
 * Fair-Use-Bremse: Das Monatskontingent ist bewusst grosszügig, weil ein Scan Bruchteile eines Rappens kostet.
 * Gefährlich ist nicht der fleissige Nutzer, sondern ein Skript, das in Minuten Tausende Seiten schickt.
 * Darum hier ein Kurzzeit-Limit pro Nutzer, unabhängig vom Plan.
 */

/** So viele Anfragen pro Nutzer und Fenster */
export const BURST_LIMIT = 20
/** Länge des Fensters in Millisekunden */
export const BURST_WINDOW_MS = 60_000

export interface BurstState {
  hits: Map<string, number[]>
}

export interface BurstResult {
  allowed: boolean
  retryAfterSeconds: number
}

export function createBurstState(): BurstState {
  return { hits: new Map() }
}

export function checkBurst(state: BurstState, userId: string, now: number = Date.now()): BurstResult {
  const since = now - BURST_WINDOW_MS
  const recent = (state.hits.get(userId) ?? []).filter(t => t > since)
  if (recent.length >= BURST_LIMIT) {
    state.hits.set(userId, recent)
    return { allowed: false, retryAfterSeconds: Math.ceil(BURST_WINDOW_MS / 1000) }
  }
  recent.push(now)
  state.hits.set(userId, recent)
  // Nutzer ohne Aktivität im Fenster fallen raus, damit die Map nicht wächst
  if (state.hits.size > 1000) {
    for (const [id, times] of state.hits) {
      if (!times.some(t => t > since))
        state.hits.delete(id)
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}
