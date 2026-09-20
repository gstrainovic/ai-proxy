import { describe, expect, it } from 'vitest'
import { PLANS } from './plans.ts'
import { checkLimit, currentMonth, emptyUsage } from './limits.ts'

describe('plans', () => {
  // Die Testzeit liegt auf dem Niveau des Privatplans: wer testet, soll an keine Grenze stossen, die er als
  // zahlender Kunde nicht hätte. Ein bezahlter Plan darf nie weniger bieten.
  it('kein bezahlter Plan hat ein kleineres Kontingent als die Testzeit', () => {
    expect(PLANS.free).toBeDefined()
    for (const [id, plan] of Object.entries(PLANS)) {
      if (id === 'free')
        continue
      expect(plan.limits.ocrPages).toBeGreaterThanOrEqual(PLANS.free.limits.ocrPages)
      expect(plan.limits.chatTokens).toBeGreaterThanOrEqual(PLANS.free.limits.chatTokens)
    }
  })
})

// Zwei Listen, gleiche Funktionen: Privat 25 CHF im Jahr bis 5 Fahrzeuge (Parität mit Drivvo Person 24.90),
// Betrieb 36 CHF pro Fahrzeug und Jahr ab dem ersten (unter Drivvo Flotte 42). Der Unterschied ist die
// Firmenrechnung, nicht der Funktionsumfang.
describe('preisliste', () => {
  it('privat: 25 CHF im Jahr für ein bis fünf Fahrzeuge', async () => {
    const { yearlyPriceChf, PRIVATE_MAX_VEHICLES } = await import('./plans.ts')
    expect(PRIVATE_MAX_VEHICLES).toBe(5)
    expect(yearlyPriceChf(1, 'privat')).toBe(25)
    expect(yearlyPriceChf(5, 'privat')).toBe(25)
  })

  it('privat mit mehr als fünf Fahrzeugen zahlt den Betriebspreis', async () => {
    const { yearlyPriceChf } = await import('./plans.ts')
    expect(yearlyPriceChf(6, 'privat')).toBe(yearlyPriceChf(6, 'betrieb'))
  })

  it('betrieb: 36 CHF pro Fahrzeug und Jahr, ab dem ersten, ohne Grundgebühr', async () => {
    const { yearlyPriceChf } = await import('./plans.ts')
    expect(yearlyPriceChf(1, 'betrieb')).toBe(36)
    expect(yearlyPriceChf(5, 'betrieb')).toBe(180)
    expect(yearlyPriceChf(10, 'betrieb')).toBe(360)
    // Standard ist Betrieb, damit ein Aufruf ohne Zielgruppe nie den billigeren Preis nennt
    expect(yearlyPriceChf(5)).toBe(180)
  })

  it('kennt genau die Pläne Testzeit, Privat und Betrieb', async () => {
    const { PLANS } = await import('./plans.ts')
    expect(Object.keys(PLANS).sort()).toEqual(['betrieb', 'free', 'privat'])
    expect(PLANS.privat.maxVehicles).toBe(5)
    expect(PLANS.privat.priceChfPerMonth).toBeCloseTo(25 / 12, 2)
    expect(PLANS.betrieb.maxVehicles).toBeUndefined()
    expect(PLANS.betrieb.perVehicle).toBe(true)
    expect(PLANS.betrieb.priceChfPerMonth).toBe(3)
  })

  it('wählt den Plan nach Zielgruppe und Fahrzeugen', async () => {
    const { planForVehicles } = await import('./plans.ts')
    expect(planForVehicles(1, 'privat').id).toBe('privat')
    expect(planForVehicles(5, 'privat').id).toBe('privat')
    expect(planForVehicles(6, 'privat').id).toBe('betrieb')
    expect(planForVehicles(1, 'betrieb').id).toBe('betrieb')
    expect(planForVehicles(40, 'betrieb').id).toBe('betrieb')
  })

  it('gibt Privat Scans nach Fahrzeugen und Betrieb ein grosszügiges Fair-Use-Kontingent', async () => {
    const { PLANS, OCR_PAGES_PER_VEHICLE, MIN_OCR_PAGES } = await import('./plans.ts')
    expect(PLANS.privat.limits.ocrPages).toBe(Math.max(MIN_OCR_PAGES, 5 * OCR_PAGES_PER_VEHICLE))
    expect(PLANS.betrieb.limits.ocrPages).toBeGreaterThan(PLANS.privat.limits.ocrPages)
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
