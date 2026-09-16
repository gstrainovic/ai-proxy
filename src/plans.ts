/**
 * Abo-Pläne mit monatlichen Limits.
 * Wird von Frontend (Anzeige) und AI-Proxy (Durchsetzung) gemeinsam genutzt.
 * Limits: ocrPages = gescannte Seiten (Rechnungen, PDFs), chatTokens = Input+Output-Tokens des Chat-Modells
 * (Embedding-Tokens zählen ebenfalls auf chatTokens).
 *
 * Jede App bringt ihren eigenen Katalog mit (`PlanCatalog`, per `createApp(deps.plans)` injiziert).
 * `PLANS`/`PlanId` sind der Standard-Katalog von auto-service.
 */
export type PlanId = 'free' | 'klein' | 'mittel' | 'gross'
export type LimitKind = 'ocrPages' | 'chatTokens'

export interface Plan {
  id: string
  name: string
  priceChfPerMonth: number
  /** Nur bei auto-service: Fahrzeuge, die der Plan abdeckt; Preis und Kontingente hängen daran. Fehlt = ohne Grenze */
  maxVehicles?: number
  limits: Record<LimitKind, number>
}

/**
 * Fair Use statt knappem Kontingent: Ein Scan kostet rund 0,0015 CHF, das Kontingent ist darum keine Kostenbremse,
 * sondern nur ein Riegel gegen Skripte. Die Schwelle liegt weit über jedem echten Gebrauch (50 Scans pro Fahrzeug
 * und Monat, mindestens 150 pro Konto). Gegen Stossbetrieb wirkt zusätzlich das Kurzzeit-Limit in rate-limit.ts.
 */
export const OCR_PAGES_PER_VEHICLE = 50
export const MIN_OCR_PAGES = 150

/** Plan-Katalog einer App: alle Pläne plus der Plan für Nutzer ohne Abo. */
export interface PlanCatalog {
  plans: Record<string, Plan>
  defaultPlan: string
}

/**
 * Eine Preisliste, gestaffelt nach Fahrzeugen statt nach Zielgruppe: 36 CHF im Jahr für bis zu drei Fahrzeuge,
 * jedes weitere 30 CHF im Jahr. Zehn Fahrzeuge kosten so 246 CHF im Jahr, fünfundzwanzig 696 CHF; das liegt im
 * unteren Drittel des Marktes (Fleethouse 2,90 €, Fleetio ab 4 USD, CARMADA 6 € plus Grundgebühr je Fahrzeug).
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Zum Ausprobieren',
    priceChfPerMonth: 0,
    maxVehicles: 1,
    limits: { ocrPages: 10, chatTokens: 200_000 },
  },
  klein: {
    id: 'klein',
    name: 'Bis 3 Fahrzeuge',
    priceChfPerMonth: 3,
    maxVehicles: 3,
    limits: { ocrPages: 150, chatTokens: 2_000_000 },
  },
  mittel: {
    id: 'mittel',
    name: 'Bis 10 Fahrzeuge',
    priceChfPerMonth: 20.5,
    maxVehicles: 10,
    limits: { ocrPages: 500, chatTokens: 5_000_000 },
  },
  gross: {
    id: 'gross',
    name: 'Bis 25 Fahrzeuge',
    priceChfPerMonth: 58,
    maxVehicles: 25,
    limits: { ocrPages: 1250, chatTokens: 12_000_000 },
  },
}

/** Jahrespreis der Staffel: 36 CHF für bis zu drei Fahrzeuge, jedes weitere 30 CHF */
export function yearlyPriceChf(vehicles: number): number {
  return 36 + Math.max(0, Math.ceil(vehicles) - 3) * 30
}

/** Kleinster Plan, der so viele Fahrzeuge abdeckt; mehr als der grösste Plan gibt es auf Anfrage */
export function planForVehicles(vehicles: number, catalog: PlanCatalog = DEFAULT_CATALOG): Plan {
  const plans = Object.values(catalog.plans).sort((a, b) => (a.maxVehicles ?? Infinity) - (b.maxVehicles ?? Infinity))
  return plans.find(p => vehicles <= (p.maxVehicles ?? Infinity)) ?? plans[plans.length - 1]!
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
