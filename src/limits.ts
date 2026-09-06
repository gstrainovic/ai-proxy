import type { LimitKind, PlanId } from './plans.ts'
import { isPlanId, PLANS } from './plans.ts'

export interface Usage {
  ocrPages: number
  chatTokens: number
}

export interface LimitResult {
  allowed: boolean
  remaining: number
  limit: number
  plan: PlanId
}

export function emptyUsage(): Usage {
  return { ocrPages: 0, chatTokens: 0 }
}

export function resolvePlan(planId: unknown): PlanId {
  return isPlanId(planId) ? planId : 'free'
}

export function checkLimit(planId: unknown, usage: Usage, kind: LimitKind): LimitResult {
  const plan = resolvePlan(planId)
  const limit = PLANS[plan].limits[kind]
  const remaining = Math.max(0, limit - usage[kind])
  return { allowed: remaining > 0, remaining, limit, plan }
}

/** Monat als YYYY-MM in UTC, Schlüssel für die Nutzungszähler. */
export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}
