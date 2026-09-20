import { describe, expect, it } from 'vitest'
import { PLANS, planForVehicles, yearlyPriceChf } from './plans.ts'

describe('Kontingente', () => {
  it('die Testzeit steht nie schlechter da als das günstigste Abo', () => {
    // Sonst stösst jemand in den 30 Tagen an eine Grenze, die er als zahlender Kunde nicht hätte
    expect(PLANS.free.limits.ocrPages).toBeGreaterThanOrEqual(PLANS.privat.limits.ocrPages)
    expect(PLANS.free.limits.chatTokens).toBeGreaterThanOrEqual(PLANS.privat.limits.chatTokens)
  })

  it('wer mehr zahlt, bekommt mehr', () => {
    expect(PLANS.betrieb.limits.ocrPages).toBeGreaterThan(PLANS.privat.limits.ocrPages)
    expect(PLANS.betrieb.limits.chatTokens).toBeGreaterThan(PLANS.privat.limits.chatTokens)
  })
})

describe('Preise', () => {
  it('privat ein Preis bis zur Fahrzeuggrenze, darüber pro Fahrzeug', () => {
    expect(yearlyPriceChf(1, 'privat')).toBe(25)
    expect(yearlyPriceChf(5, 'privat')).toBe(25)
    expect(yearlyPriceChf(6, 'privat')).toBe(216)
  })

  it('Betrieb zahlt pro Fahrzeug, auch bei einem', () => {
    expect(yearlyPriceChf(1, 'betrieb')).toBe(36)
    expect(yearlyPriceChf(10, 'betrieb')).toBe(360)
  })

  it('der Plan folgt der Fahrzeugzahl', () => {
    expect(planForVehicles(3, 'privat').id).toBe('privat')
    expect(planForVehicles(6, 'privat').id).toBe('betrieb')
    expect(planForVehicles(1, 'betrieb').id).toBe('betrieb')
  })
})
