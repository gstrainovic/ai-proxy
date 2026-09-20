import { describe, expect, it } from 'vitest'
import { feedbackMail, MAX_AUDIO_BYTES, MAX_TEXT_LENGTH, parseFeedback } from './feedback.ts'

describe('parseFeedback', () => {
  it('nimmt Text an und schneidet zu lange Eingaben ab', () => {
    const lang = 'a'.repeat(MAX_TEXT_LENGTH + 500)
    const result = parseFeedback({ text: lang, page: '/dashboard' })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.feedback.text.length).toBe(MAX_TEXT_LENGTH)
  })

  it('verlangt Text oder Aufnahme', () => {
    const result = parseFeedback({ text: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toMatch(/Text|Aufnahme/)
  })

  it('nimmt eine Aufnahme ohne Text an', () => {
    expect(parseFeedback({ audioBytes: 1000 }).ok).toBe(true)
  })

  it('lehnt zu grosse Aufnahmen ab', () => {
    const result = parseFeedback({ audioBytes: MAX_AUDIO_BYTES + 1 })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toMatch(/zu lang|zu gross/)
  })
})

describe('feedbackMail', () => {
  const basis = { userId: 'user-1', email: 'kunde@example.ch', page: '/vehicles/42', app: '2026-09-20' }

  it('Betreff nennt die Herkunft, der Text nennt Nutzer und Seite', () => {
    const mail = feedbackMail({ ...basis, text: 'Das Datum wird falsch erkannt.' })
    expect(mail.subject).toContain('Rückmeldung')
    expect(mail.text).toContain('Das Datum wird falsch erkannt.')
    expect(mail.text).toContain('kunde@example.ch')
    expect(mail.text).toContain('/vehicles/42')
  })

  it('stellt das Transkript vor den Hinweis auf die Aufnahme', () => {
    const mail = feedbackMail({ ...basis, transcript: 'Beim Scannen stimmt das Datum nicht.' })
    expect(mail.text).toContain('Beim Scannen stimmt das Datum nicht.')
    expect(mail.text).toMatch(/Sprachnachricht/i)
  })

  it('ohne E-Mail steht wenigstens die Nutzer-ID drin', () => {
    const mail = feedbackMail({ ...basis, email: null, text: 'Test' })
    expect(mail.text).toContain('user-1')
  })
})
