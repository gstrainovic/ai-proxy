/**
 * Abo-Pläne mit monatlichen Limits.
 * Wird von Frontend (Anzeige) und AI-Proxy (Durchsetzung) gemeinsam genutzt.
 * Limits: ocrPages = gescannte Seiten (Rechnungen, PDFs), chatTokens = Input+Output-Tokens des Chat-Modells
 * (Embedding-Tokens zählen ebenfalls auf chatTokens).
 *
 * Jede App bringt ihren eigenen Katalog mit (`PlanCatalog`, per `createApp(deps.plans)` injiziert).
 * `PLANS`/`PlanId` sind der Standard-Katalog von auto-service.
 */
export type PlanId = 'free' | 'privat' | 'betrieb'
export type LimitKind = 'ocrPages' | 'chatTokens'

export interface Plan {
  id: string
  name: string
  priceChfPerMonth: number
  /** Nur bei auto-service: Fahrzeuge, die der Plan abdeckt; Preis und Kontingente hängen daran. Fehlt = ohne Grenze */
  maxVehicles?: number
  /** Preis gilt pro Fahrzeug (Betrieb), nicht pro Konto */
  perVehicle?: boolean
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
 * Zwei Listen, gleiche Funktionen. Privat: 25 CHF im Jahr für bis zu fünf Fahrzeuge (Parität mit Drivvo Person
 * 24.90, dazu Belegscan, MFK, Schweiz, keine Werbung). Betrieb: 36 CHF pro Fahrzeug und Jahr ab dem ersten, ohne
 * Grundgebühr (Drivvo Flotte 42 ab fünf, Fleethouse 2,90 € im Monat). Der Unterschied zwischen den Listen ist die
 * Jahresrechnung auf die Firma, nicht der Funktionsumfang; Details business-plan/03-produkt.md «Abgrenzung».
 */
export type Audience = 'privat' | 'betrieb'
export const PRIVATE_YEARLY_CHF = 25
export const PRIVATE_MAX_VEHICLES = 5
export const BUSINESS_VEHICLE_YEARLY_CHF = 36

export const PLANS: Record<PlanId, Plan> = {
  // Kein Gratis-Plan, sondern die Testzeit (trial.ts): 30 Tage mit allem und ohne Fahrzeuggrenze, damit auch ein
  // Betrieb seine ganze Flotte testen kann; danach 402
  free: {
    id: 'free',
    name: 'Testzeit',
    priceChfPerMonth: 0,
    limits: { ocrPages: 100, chatTokens: 1_500_000 },
  },
  privat: {
    id: 'privat',
    name: 'Privat',
    priceChfPerMonth: PRIVATE_YEARLY_CHF / 12,
    maxVehicles: PRIVATE_MAX_VEHICLES,
    limits: { ocrPages: Math.max(MIN_OCR_PAGES, PRIVATE_MAX_VEHICLES * OCR_PAGES_PER_VEHICLE), chatTokens: 2_000_000 },
  },
  // Pro Fahrzeug abgerechnet, darum keine Fahrzeuggrenze; das Kontingent ist Fair Use für Flotten bis rund 50 Fahrzeuge
  betrieb: {
    id: 'betrieb',
    name: 'Betrieb',
    priceChfPerMonth: BUSINESS_VEHICLE_YEARLY_CHF / 12,
    perVehicle: true,
    limits: { ocrPages: 2500, chatTokens: 12_000_000 },
  },
}

/** Jahrespreis nach Zielgruppe; ohne Angabe Betrieb, damit nie versehentlich der billigere Preis genannt wird */
export function yearlyPriceChf(vehicles: number, audience: Audience = 'betrieb'): number {
  const n = Math.max(1, Math.ceil(vehicles))
  if (audience === 'privat' && n <= PRIVATE_MAX_VEHICLES)
    return PRIVATE_YEARLY_CHF
  return n * BUSINESS_VEHICLE_YEARLY_CHF
}

/** Plan nach Zielgruppe: Privat, solange die Fahrzeuge in den Privatplan passen, sonst Betrieb */
export function planForVehicles(vehicles: number, audience: Audience = 'betrieb', catalog: PlanCatalog = DEFAULT_CATALOG): Plan {
  const plans = Object.values(catalog.plans).filter(p => p.priceChfPerMonth > 0)
  const perAccount = plans.filter(p => !p.perVehicle).sort((a, b) => (a.maxVehicles ?? Infinity) - (b.maxVehicles ?? Infinity))
  const perVehicle = plans.find(p => p.perVehicle)
  if (audience === 'privat') {
    const fits = perAccount.find(p => vehicles <= (p.maxVehicles ?? Infinity))
    if (fits)
      return fits
  }
  return perVehicle ?? perAccount[perAccount.length - 1]!
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
