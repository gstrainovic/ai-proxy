import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { creditsForReference, parseCamt054 } from './camt.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const qrr = readFileSync(join(fixtures, 'camt054-qrr.xml'), 'utf8')
const muster = readFileSync(join(fixtures, 'camt054-postfinance-muster.xml'), 'utf8')
const echt = readFileSync(join(fixtures, 'camt054-testplattform-qrr.xml'), 'utf8')

describe('parseCamt054', () => {
  it('liest die Sammelbuchung als eine Gutschrift pro TxDtls', () => {
    const credits = parseCamt054(qrr)
    expect(credits.map(c => c.reference)).toEqual([
      '000000002026100516660768994',
      '000000002026100517593686550',
      'RF23WH20261005B65MKI',
    ])
  })

  it('liest Betrag, Währung, Buchungsdatum und Bankreferenz je Zahlung', () => {
    const [first] = parseCamt054(qrr)
    expect(first).toMatchObject({
      reference: '000000002026100516660768994',
      referenceType: 'QRR',
      amount: 108,
      currency: 'CHF',
      bookedAt: '2026-10-12',
      bankRef: '2026101200000001',
      debtor: 'Muster Sanitär AG',
      message: 'Rechnung WH-20261005-RJXT5V',
    })
  })

  it('übernimmt Gebühren und den ursprünglichen Zahler', () => {
    const second = parseCamt054(qrr)[1]!
    expect(second.charges).toBe(1.5)
    expect(second.ultimateDebtor).toBe('Weber Holding AG')
    expect(second.message).toBe('')
  })

  it('erkennt SCOR als Referenzart', () => {
    const scor = parseCamt054(qrr)[2]!
    expect(scor.referenceType).toBe('SCOR')
    expect(scor.bookedAt).toBe('2026-10-13')
  })

  it('lässt Belastungen aus', () => {
    expect(parseCamt054(qrr).some(c => c.debtor === 'Swisscom (Schweiz) AG')).toBe(false)
    expect(parseCamt054(qrr)).toHaveLength(3)
  })

  it('liest die Musterdatei von PostFinance: Gutschrift ohne Referenz', () => {
    const credits = parseCamt054(muster)
    expect(credits).toHaveLength(1)
    expect(credits[0]).toMatchObject({
      reference: '',
      referenceType: '',
      amount: 522.1,
      currency: 'CHF',
      bookedAt: '2022-03-10',
      bankRef: '2000000000000000',
      debtor: 'Bernasconi Maria',
    })
  })

  it('lässt die Statusmeldungen ?REJECT? und ?ERROR? aus der Mitteilung weg', () => {
    expect(parseCamt054(muster)[0]!.message).toBe('')
  })

  it('liest die Zahlung auf eine QR-Rechnung von Wartungsheft (Datei der PostFinance-Testplattform)', () => {
    const credits = parseCamt054(echt)
    expect(credits).toHaveLength(1)
    expect(credits[0]).toMatchObject({
      reference: '000000002026092009137547182',
      referenceType: 'QRR',
      amount: 108,
      currency: 'CHF',
      bookedAt: '2026-09-21',
      bankRef: '4329063900000007',
      // Eine QR-Einzahlung kennt keinen Dbtr, der Zahler steht in UltmtDbtr
      debtor: 'Muster Sanitär AG',
      ultimateDebtor: 'Muster Sanitär AG',
      message: 'Rechnung WH-20260920-F40XNI',
      charges: 1.75,
    })
  })

  it('wirft bei einer Datei, die keine camt.054-Meldung ist', () => {
    expect(() => parseCamt054('<Document><Foo/></Document>')).toThrow(/camt\.054/)
  })
})

describe('creditsForReference', () => {
  it('gibt nur Gutschriften mit Referenz zurück', () => {
    expect(creditsForReference(parseCamt054(qrr))).toHaveLength(3)
    expect(creditsForReference(parseCamt054(muster))).toEqual([])
  })

  it('normalisiert Leerzeichen in der Referenz', () => {
    const credits = parseCamt054(qrr.replace('RF23WH20261005B65MKI', 'RF23 WH20 2610 05B6 5MKI'))
    expect(credits[2]!.reference).toBe('RF23WH20261005B65MKI')
  })
})
