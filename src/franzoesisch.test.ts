import { describe, expect, it } from 'vitest'
import { NBSP, verstoesse } from './franzoesisch.ts'
import { invoiceTexts } from './invoice-texts.ts'

/**
 * Französische Texte der Abo-Rechnung (PDF und Mails) nach den Regeln des fr-Teams: U+00A0 vor : ; ? ! » % und nach
 * «, Apostroph ’. Die Rechnung duzt wie die App (invoice-texts.ts), darum ohne Prüfung auf «vous».
 */

/** Alle Texte mit Pfad; Funktionen werden mit Platzhaltern aufgerufen (eine und zwei Einheiten für die Mehrzahl) */
function blaetter(wert: unknown, pfad = ''): [string, string][] {
  if (typeof wert === 'function')
    return [1, 2].flatMap(n => blaetter((wert as (...a: unknown[]) => unknown)(n, 'X', 'Y', 'Z'), `${pfad}(${n})`))
  if (wert && typeof wert === 'object')
    return Object.entries(wert).flatMap(([k, v]) => blaetter(v, pfad ? `${pfad}.${k}` : k))
  return typeof wert === 'string' ? [[pfad, wert]] : []
}

describe('französische Texte der Abo-Rechnung', () => {
  it('die Prüfung erkennt typische Fehler und lässt korrekten Text durch', () => {
    expect(verstoesse('Montant_: X, payable jusqu’au Y_? «_oui_»'.replace(/_/g, NBSP), { duzenErlaubt: true })).toEqual([])
    for (const falsch of ['Montant : X', 'jusqu\'au', '« oui', 'oui »'])
      expect(verstoesse(falsch, { duzenErlaubt: true }), falsch).toHaveLength(1)
  })

  it('pDF und Mails halten die Typografie ein', () => {
    const funde = blaetter(invoiceTexts('fr')).flatMap(([pfad, text]) => verstoesse(text, { duzenErlaubt: true }).map(f => `${pfad}: ${f}`))
    expect(funde).toEqual([])
  })
})
