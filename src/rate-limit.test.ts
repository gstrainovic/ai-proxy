import { describe, expect, it } from 'vitest'
import { BURST_LIMIT, BURST_WINDOW_MS, checkBurst, createBurstState } from './rate-limit.ts'

describe('checkBurst', () => {
  it('lässt Anfragen bis zur Schwelle durch', () => {
    const state = createBurstState()
    for (let i = 0; i < BURST_LIMIT; i++)
      expect(checkBurst(state, 'user-1', 1000 + i).allowed).toBe(true)
  })

  it('bremst darüber und nennt die Wartezeit in Sekunden', () => {
    const state = createBurstState()
    for (let i = 0; i < BURST_LIMIT; i++)
      checkBurst(state, 'user-1', 1000)
    const blocked = checkBurst(state, 'user-1', 1000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(Math.ceil(BURST_WINDOW_MS / 1000))
  })

  it('zählt je Nutzer getrennt', () => {
    const state = createBurstState()
    for (let i = 0; i < BURST_LIMIT; i++)
      checkBurst(state, 'user-1', 1000)
    expect(checkBurst(state, 'user-2', 1000).allowed).toBe(true)
  })

  it('vergisst alte Anfragen, sobald das Fenster vorbei ist', () => {
    const state = createBurstState()
    for (let i = 0; i < BURST_LIMIT; i++)
      checkBurst(state, 'user-1', 1000)
    expect(checkBurst(state, 'user-1', 1000 + BURST_WINDOW_MS + 1).allowed).toBe(true)
  })
})

describe('checkBurst mit eigener Schwelle', () => {
  it('nimmt die Schwelle aus dem Zustand, z. B. hoch für E2E-Läufe', () => {
    const state = createBurstState(3)
    for (let i = 0; i < 3; i++)
      expect(checkBurst(state, 'user-1', 1000).allowed).toBe(true)
    expect(checkBurst(state, 'user-1', 1000).allowed).toBe(false)
  })
})
