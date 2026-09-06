import type { LimitKind, PlanCatalog } from './plans.ts'
import { DEFAULT_CATALOG, isPlanIn } from './plans.ts'

export interface Usage {
  ocrPages: number
  chatTokens: number
}

export interface LimitResult {
  allowed: boolean
  remaining: number
  limit: number
  plan: string
}

export function emptyUsage(): Usage {
  return { ocrPages: 0, chatTokens: 0 }
}

/** Unbekannte oder fehlende Pläne fallen auf den Standardplan des Katalogs zurück. */
export function resolvePlan(planId: unknown, catalog: PlanCatalog = DEFAULT_CATALOG): string {
  return isPlanIn(catalog, planId) ? planId : catalog.defaultPlan
}

export function checkLimit(planId: unknown, usage: Usage, kind: LimitKind, catalog: PlanCatalog = DEFAULT_CATALOG): LimitResult {
  const plan = resolvePlan(planId, catalog)
  const limit = catalog.plans[plan].limits[kind]
  const remaining = Math.max(0, limit - usage[kind])
  return { allowed: remaining > 0, remaining, limit, plan }
}

/** Monat als YYYY-MM in UTC, Schlüssel für die Nutzungszähler. */
export function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}
