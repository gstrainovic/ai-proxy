import { describe, expect, it } from 'vitest'
import { startTrial, TRIAL_DAYS, trialState } from './trial.ts'

const now = new Date('2026-09-16T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

describe('trialState', () => {
  it('läuft 30 Tage ab dem ersten Aufruf', () => {
    const state = trialState({ plan: 'free', status: 'trial', trialStartedAt: daysAgo(10) }, now)
    expect(state).toEqual({ active: true, daysLeft: TRIAL_DAYS - 10, endsAt: '2026-10-06' })
  })

  it('ist am Tag danach vorbei', () => {
    const state = trialState({ plan: 'free', status: 'trial', trialStartedAt: daysAgo(31) }, now)
    expect(state).toMatchObject({ active: false, daysLeft: 0 })
  })

  it('beginnt für ein Konto ohne Eintrag jetzt', () => {
    expect(trialState(null, now)).toMatchObject({ active: true, daysLeft: TRIAL_DAYS })
  })

  it('gilt nicht für Konten mit aktivem Abo', () => {
    expect(trialState({ plan: 'klein', status: 'active' }, now)).toBeNull()
  })

  it('startTrial legt den Beginn fest', () => {
    expect(startTrial(now)).toEqual({ plan: 'free', status: 'trial', trialStartedAt: now.toISOString() })
  })
})
