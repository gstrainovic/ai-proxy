/**
 * Testzeit statt Gratis-Stufe: Ein Konto ohne Abo darf 30 Tage alles nutzen, danach bleiben Lesen, Erfassen von
 * Hand und Exporte in der App frei, nur KI-Scan und Chat brauchen das Abo. Eine dauerhafte Gratis-Stufe mit einem
 * Fahrzeug würde genau den Privathalter mit einem Auto verschenken, der sonst 36 CHF im Jahr zahlt.
 */
import type { Subscription } from './stores/types.ts'

export const TRIAL_DAYS = 30

export interface TrialState {
  active: boolean
  daysLeft: number
  /** ISO-Datum des letzten Testtags */
  endsAt: string
}

/** Zustand der Testzeit; null für Konten mit aktivem Abo */
export function trialState(sub: Subscription | null, now: Date = new Date()): TrialState | null {
  if (sub && sub.status === 'active')
    return null
  const startedAt = sub?.trialStartedAt ? new Date(sub.trialStartedAt) : now
  const end = new Date(startedAt.getTime() + TRIAL_DAYS * 86_400_000)
  const msLeft = end.getTime() - now.getTime()
  return {
    active: msLeft > 0,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86_400_000)),
    endsAt: end.toISOString().slice(0, 10),
  }
}

/** Beginnt die Testzeit beim ersten Aufruf; ein bestehendes Abo bleibt unberührt */
export function startTrial(now: Date = new Date()): Subscription {
  return { plan: 'free', status: 'trial', trialStartedAt: now.toISOString() }
}
