/**
 * Rückmeldungen aus der App: Text, Sprachnachricht oder beides. Reine Funktionen — Prüfung der Eingabe und der
 * Mailtext für den Betreiber. Aufnahme und Versand hängen im Proxy (`/feedback` in app.ts): das Audio geht zur
 * Transkription an Mistral (Voxtral) und als Anhang mit der Mail an das Postfach.
 *
 * Warum eine Sprachnachricht: Die Zielgruppe schreibt ungern lange Texte, aber spricht täglich Nachrichten.
 * Das Transkript macht die Rückmeldung für den Betreiber lesbar statt abhörbar.
 */
import { Buffer } from 'node:buffer'

/** Zeichen, die eine Rückmeldung höchstens hat; alles darüber wird abgeschnitten statt abgelehnt */
export const MAX_TEXT_LENGTH = 4000
/** Rund drei Minuten Opus; mehr ist keine Rückmeldung mehr, sondern ein Anruf */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024

export interface Feedback {
  text: string
  page?: string
  audioBytes?: number
}

export type FeedbackResult = { ok: true, feedback: Feedback } | { ok: false, error: string }

export function parseFeedback(input: { text?: string, page?: string, audioBytes?: number }): FeedbackResult {
  const text = (input.text ?? '').trim().slice(0, MAX_TEXT_LENGTH)
  const audioBytes = input.audioBytes ?? 0
  if (audioBytes > MAX_AUDIO_BYTES)
    return { ok: false, error: 'Die Aufnahme ist zu lang. Bitte höchstens drei Minuten.' }
  if (!text && !audioBytes)
    return { ok: false, error: 'Bitte einen Text schreiben oder eine Aufnahme aufsprechen.' }
  return { ok: true, feedback: { text, page: input.page, audioBytes: audioBytes || undefined } }
}

export interface FeedbackMailInput {
  userId: string
  /** E-Mail des Absenders, falls bekannt: sonst bleibt nur die Nutzer-ID für die Antwort */
  email?: string | null
  text?: string
  /** Transkript der Sprachnachricht (Voxtral) */
  transcript?: string
  page?: string
  /** Version oder Datum der App, hilft beim Einordnen */
  app?: string
}

/** Mail an den Betreiber: erst die Worte des Kunden, dann der Zusammenhang */
export function feedbackMail(input: FeedbackMailInput): { subject: string, text: string } {
  const teile: string[] = []
  if (input.transcript) {
    teile.push('Sprachnachricht, automatisch transkribiert:', '', input.transcript)
    if (input.text)
      teile.push('', 'Dazu geschrieben:', '', input.text)
  }
  else {
    teile.push(input.text ?? '')
  }

  teile.push(
    '',
    '—',
    `Von: ${input.email ?? `Konto ${input.userId}`}`,
    ...(input.email ? [`Konto: ${input.userId}`] : []),
    ...(input.page ? [`Seite: ${input.page}`] : []),
    ...(input.app ? [`App: ${input.app}`] : []),
    input.transcript ? 'Die Aufnahme hängt als Datei an dieser Mail.' : '',
  )

  const erste = (input.transcript ?? input.text ?? '').split('\n')[0]!.trim()
  const kurz = erste.length > 60 ? `${erste.slice(0, 60)}…` : erste
  return {
    subject: `Wartungsheft: Rückmeldung${kurz ? ` — ${kurz}` : ''}`,
    text: teile.filter((z, i, alle) => z !== '' || alle[i - 1] !== '').join('\n'),
  }
}

/** Versand der Rückmeldung an das Postfach des Betreibers, über Resend wie die Rechnungen */
export function createFeedbackNotifier(config: {
  token: string
  /** Absender, z. B. `Wartungsheft <erinnerung@wartungsheft.ch>` */
  from: string
  /** Postfach des Betreibers */
  to: string
  fetch?: typeof fetch
}): (notice: { subject: string, text: string, replyTo?: string | null, audio?: { filename: string, contentType: string, bytes: Uint8Array } }) => Promise<void> {
  const fetchFn = config.fetch ?? fetch
  return async (notice) => {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        // Antworten gehen direkt an den Kunden, ohne dass der Betreiber die Adresse suchen muss
        ...(notice.replyTo ? { reply_to: notice.replyTo } : {}),
        subject: notice.subject,
        text: notice.text,
        ...(notice.audio
          ? { attachments: [{ filename: notice.audio.filename, content: Buffer.from(notice.audio.bytes).toString('base64') }] }
          : {}),
      }),
    })
    if (!res.ok)
      throw new Error(`Resend ${res.status}: ${await res.text()}`)
  }
}
