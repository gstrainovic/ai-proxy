/**
 * Abo-Pläne mit monatlichen Limits.
 * Wird von Frontend (Anzeige) und AI-Proxy (Durchsetzung) gemeinsam genutzt.
 * Limits: ocrPages = gescannte Seiten (Rechnungen, PDFs), chatTokens = Input+Output-Tokens des Chat-Modells
 * (Embedding-Tokens zählen ebenfalls auf chatTokens).
 *
 * Jede App bringt ihren eigenen Katalog mit (`PlanCatalog`, per `createApp(deps.plans)` injiziert).
 * `PLANS`/`PlanId` sind der Standard-Katalog von auto-service.
 */
export type PlanId = 'free' | 'basic' | 'pro'
export type LimitKind = 'ocrPages' | 'chatTokens'

export interface Plan {
  id: string
  name: string
  priceChfPerMonth: number
  limits: Record<LimitKind, number>
}

/** Plan-Katalog einer App: alle Pläne plus der Plan für Nutzer ohne Abo. */
export interface PlanCatalog {
  plans: Record<string, Plan>
  defaultPlan: string
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceChfPerMonth: 0,
    limits: { ocrPages: 5, chatTokens: 100_000 },
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    priceChfPerMonth: 5,
    limits: { ocrPages: 60, chatTokens: 1_000_000 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceChfPerMonth: 15,
    limits: { ocrPages: 400, chatTokens: 5_000_000 },
  },
}

/** Standard-Katalog (auto-service). */
export const DEFAULT_CATALOG: PlanCatalog = { plans: PLANS, defaultPlan: 'free' }

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS
}

/** Prüft, ob ein Wert ein Plan des gegebenen Katalogs ist. */
export function isPlanIn(catalog: PlanCatalog, value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(catalog.plans, value)
}

export const LIMIT_LABELS: Record<LimitKind, string> = {
  ocrPages: 'Scans (Seiten)',
  chatTokens: 'Chat-Tokens',
}
