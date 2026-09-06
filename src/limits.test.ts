import { describe, expect, it } from 'vitest'
import { PLANS } from './plans.ts'
import { checkLimit, currentMonth, emptyUsage } from './limits.ts'

describe('plans', () => {
  it('free plan exists and has strictly smaller limits than paid plans', () => {
    expect(PLANS.free).toBeDefined()
    for (const [id, plan] of Object.entries(PLANS)) {
      if (id === 'free')
        continue
      expect(plan.limits.ocrPages).toBeGreaterThan(PLANS.free.limits.ocrPages)
      expect(plan.limits.chatTokens).toBeGreaterThan(PLANS.free.limits.chatTokens)
    }
  })
})

describe('checkLimit', () => {
  it('allows a request while usage is below the plan limit', () => {
    const usage = { ...emptyUsage(), ocrPages: 4 }
    const result = checkLimit('free', usage, 'ocrPages')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(PLANS.free.limits.ocrPages - 4)
  })

  it('blocks a request once the plan limit is reached', () => {
    const usage = { ...emptyUsage(), ocrPages: PLANS.free.limits.ocrPages }
    const result = checkLimit('free', usage, 'ocrPages')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('never returns negative remaining when usage exceeds the limit', () => {
    const usage = { ...emptyUsage(), chatTokens: PLANS.free.limits.chatTokens + 999 }
    expect(checkLimit('free', usage, 'chatTokens').remaining).toBe(0)
  })

  it('falls back to the free plan for unknown plan ids', () => {
    const usage = { ...emptyUsage(), ocrPages: PLANS.free.limits.ocrPages }
    expect(checkLimit('does-not-exist', usage, 'ocrPages').allowed).toBe(false)
  })
})

describe('currentMonth', () => {
  it('formats as YYYY-MM in UTC', () => {
    expect(currentMonth(new Date('2026-09-06T23:59:59Z'))).toBe('2026-09')
    expect(currentMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
  })
})
