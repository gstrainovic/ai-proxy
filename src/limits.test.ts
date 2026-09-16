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

describe('fahrzeug-staffel', () => {
  it('rechnet 36 CHF im Jahr für bis zu drei Fahrzeuge, danach 30 CHF je Fahrzeug', async () => {
    const { yearlyPriceChf } = await import('./plans.ts')
    expect(yearlyPriceChf(1)).toBe(36)
    expect(yearlyPriceChf(3)).toBe(36)
    expect(yearlyPriceChf(4)).toBe(66)
    expect(yearlyPriceChf(10)).toBe(246)
    expect(yearlyPriceChf(25)).toBe(696)
  })

  it('wählt den kleinsten Plan, der die Fahrzeuge abdeckt', async () => {
    const { planForVehicles } = await import('./plans.ts')
    expect(planForVehicles(1).id).toBe('free')
    expect(planForVehicles(3).id).toBe('klein')
    expect(planForVehicles(4).id).toBe('mittel')
    expect(planForVehicles(10).id).toBe('mittel')
    expect(planForVehicles(11).id).toBe('gross')
    // mehr als der grösste Plan: grösster Plan, der Rest läuft über eine Anfrage
    expect(planForVehicles(40).id).toBe('gross')
  })

  it('gibt jedem Plan Scans nach Fahrzeugen, mindestens das Konto-Minimum', async () => {
    const { PLANS, OCR_PAGES_PER_VEHICLE, MIN_OCR_PAGES } = await import('./plans.ts')
    for (const plan of Object.values(PLANS)) {
      if (plan.id === 'free')
        continue
      expect(plan.limits.ocrPages).toBe(Math.max(MIN_OCR_PAGES, (plan.maxVehicles ?? 0) * OCR_PAGES_PER_VEHICLE))
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
