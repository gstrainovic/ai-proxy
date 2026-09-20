/**
 * camt.054 (Gutschrifts- und Belastungsanzeige, ISO 20022 / Swiss Payment Standards) lesen: aus einer Datei der Bank
 * wird je Zahlung eine Gutschrift mit Referenz, Betrag und Buchungsdatum. Die Referenz ist dieselbe, die
 * `invoiceReference` (invoice.ts) auf die QR-Rechnung druckt; damit findet `markInvoicePaid` die Rechnung.
 *
 * Reine Funktionen ohne Netz: die Datei kommt aus dem E-Banking oder später über EBICS (Auftragsart Z54 bei
 * PostFinance). Iteriert wird über `NtryDtls/TxDtls`, nicht über `Ntry`: mehrere Zahlungen eines Tages kommen als
 * eine Sammelbuchung mit einem `TxDtls` je Zahlung.
 */
import { XMLParser } from 'fast-xml-parser'

export interface CamtCredit {
  /** QR- oder SCOR-Referenz ohne Leerzeichen, leer bei einer Zahlung ohne Referenz */
  reference: string
  referenceType: 'QRR' | 'SCOR' | ''
  amount: number
  currency: string
  /** Buchungsdatum der Buchung (ISO-Tag) */
  bookedAt: string
  /** `AcctSvcrRef` der Zahlung, eindeutig bei der Bank: verhindert doppeltes Verbuchen */
  bankRef: string
  debtor: string
  ultimateDebtor: string
  /** Mitteilung aus dem QR-Code */
  message: string
  /** Gebühren, die die Bank vom Betrag abgezogen hat */
  charges: number
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Beträge und Referenzen bleiben Text: führende Nullen der QR-Referenz gehen sonst verloren
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
})

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined)
    return []
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  if (typeof value === 'object')
    return text((value as Record<string, unknown>)['#text'])
  return String(value).trim()
}

function amount(node: any): { amount: number, currency: string } {
  return { amount: Number.parseFloat(text(node)) || 0, currency: text(node?.['@Ccy']) }
}

function partyName(node: any): string {
  return text(node?.Pty?.Nm ?? node?.Nm)
}

/** Mitteilung des Zahlers; PostFinance stellt eigene Statusmeldungen wie `?REJECT?0` in dasselbe Feld */
function remittanceMessage(strd: any): string {
  return list<unknown>(strd?.AddtlRmtInf)
    .map(text)
    .filter(line => line && !line.startsWith('?'))
    .join(' ')
}

function reference(strd: any): { reference: string, referenceType: CamtCredit['referenceType'] } {
  const info = strd?.CdtrRefInf
  const ref = text(info?.Ref).replace(/\s/g, '').toUpperCase()
  if (!ref)
    return { reference: '', referenceType: '' }
  const code = text(info?.Tp?.CdOrPrtry?.Cd ?? info?.Tp?.CdOrPrtry?.Prtry).toUpperCase()
  const type = code === 'QRR' || code === 'SCOR' ? code : (ref.startsWith('RF') ? 'SCOR' : 'QRR')
  return { reference: ref, referenceType: type }
}

/**
 * Alle Gutschriften einer camt.054-Datei. Belastungen und Stornos werden ausgelassen, mehrere `Ntfctn` kommen
 * zusammen. Wirft, wenn die Datei keine camt.054-Meldung ist.
 */
export function parseCamt054(xml: string): CamtCredit[] {
  const root = parser.parse(xml)?.Document?.BkToCstmrDbtCdtNtfctn
  if (!root)
    throw new Error('Keine camt.054-Meldung: <BkToCstmrDbtCdtNtfctn> fehlt')

  const credits: CamtCredit[] = []
  for (const notification of list<any>(root.Ntfctn)) {
    for (const entry of list<any>(notification.Ntry)) {
      if (text(entry.RvslInd) === 'true')
        continue
      const bookedAt = text(entry.BookgDt?.Dt ?? entry.BookgDt?.DtTm).slice(0, 10)
      const details = list<any>(entry.NtryDtls).flatMap(d => list<any>(d.TxDtls))
      // Ohne TxDtls zählt die Buchung selbst als eine Zahlung
      for (const tx of details.length ? details : [entry]) {
        if (text(tx.CdtDbtInd ?? entry.CdtDbtInd) !== 'CRDT')
          continue
        const strd = list<any>(tx.RmtInf?.Strd)[0]
        credits.push({
          ...reference(strd),
          ...amount(tx.Amt),
          bookedAt,
          bankRef: text(tx.Refs?.AcctSvcrRef ?? tx.AcctSvcrRef ?? entry.AcctSvcrRef),
          debtor: partyName(tx.RltdPties?.Dbtr),
          ultimateDebtor: partyName(tx.RltdPties?.UltmtDbtr),
          message: remittanceMessage(strd),
          charges: amount(tx.Chrgs?.TtlChrgsAndTaxAmt).amount,
        })
      }
    }
  }
  return credits
}

/** Gutschriften, die sich einer Rechnung zuordnen lassen: alles ohne Referenz geht von Hand */
export function creditsForReference(credits: CamtCredit[]): CamtCredit[] {
  return credits.filter(c => c.reference)
}
