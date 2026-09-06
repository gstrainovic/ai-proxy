/**
 * Abo-Pläne mit monatlichen Limits.
 * Wird von Frontend (Anzeige) und AI-Proxy (Durchsetzung) gemeinsam genutzt.
 * Limits: ocrPages = gescannte Seiten (Rechnungen, PDFs), chatTokens = Input+Output-Tokens des Chat-Modells.
 */
export type PlanId = 'free' | 'basic' | 'pro'
export type LimitKind = 'ocrPages' | 'chatTokens'

export interface Plan {
  id: PlanId
  name: string
  priceChfPerMonth: number
  limits: Record<LimitKind, number>
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

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS
}

export const LIMIT_LABELS: Record<LimitKind, string> = {
  ocrPages: 'Scans (Seiten)',
  chatTokens: 'Chat-Tokens',
}
