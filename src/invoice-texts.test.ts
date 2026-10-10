import { describe, expect, it } from 'vitest'
import { INVOICE_LANGUAGES, invoiceTexts } from './invoice-texts.ts'

/**
 * Abo-Regeln (find-jobs/akquise/abo-regeln.md) in den Texten an den Kunden: verbindlich erst mit der Zahlung, wer
 * nicht zahlt, muss nichts tun; nichts verlängert sich von selbst; kein Kündigen, keine Mahnung.
 */
const NICHTS_TUN = {
  de: /musst du nichts tun/,
  fr: /tu n’as rien à faire/,
  it: /non devi fare nulla/,
  en: /you don.t need to do anything/,
}

const VERBOTEN = {
  de: [/verlängert sich (automatisch|jeweils|jährlich)/i, /kündbar/i, /kündig/i, /Mahnung/i, /kostenpflichtig/i],
  fr: [/se renouvelle/i, /résili/i, /rappel/i, /payant/i],
  it: [/si rinnova/i, /disd/i, /sollecito/i, /a pagamento/i],
  en: [/renews/i, /cancel(?!led)/i, /reminder/i, /obligation to pay/i],
}

describe('texte der Abo-Rechnung halten die Abo-Regeln ein', () => {
  for (const language of INVOICE_LANGUAGES) {
    it(`${language}: Rechnungsbedingungen und Mail sagen «ohne Zahlung nichts tun», kein Kündigen, keine Verlängerung von selbst`, () => {
      const t = invoiceTexts(language)
      const terms = t.terms('info@wartungsheft.ch')
      const mail = t.mailRenewal('https://wartungsheft.ch/settings')
      expect(terms).toMatch(NICHTS_TUN[language])
      expect(mail).toMatch(NICHTS_TUN[language])
      for (const text of [terms, mail, t.voidedIntro]) {
        for (const muster of VERBOTEN[language])
          expect(text, `${language}: ${muster}`).not.toMatch(muster)
      }
    })
  }

  it('mail nennt den Weg, keine weiteren Rechnungen zu bekommen: Antwort auf die Mail', () => {
    expect(invoiceTexts('de').mailRenewal('u')).toContain('antworte')
    expect(invoiceTexts('de').voidedIntro).toContain('keine weiteren Rechnungen')
  })
})
