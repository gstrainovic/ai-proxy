/**
 * Französische Typografie- und Stilregeln (Regeln des fr_FR-Teams von WordPress, User-Skill wp-plugin-ch, Datei
 * fr-richtlinien.md). Eingabe ist sichtbarer Text: Code, URLs und Attribute sind schon entfernt. Rückgabe: Liste der
 * Verstösse mit etwas Kontext, leer heisst regelkonform. Nur für Tests (src/franzoesisch.test.ts).
 */
export const NBSP = String.fromCharCode(0xA0)

function kontext(text: string, i: number): string {
  return text.slice(Math.max(0, i - 30), i + 30).replace(/\s+/g, m => (m === NBSP ? m : ' '))
}

const x = (m: string) => 'x'.repeat(m.length)

/** URLs, Mailadressen, Pfade und Dateinamen sind keine Prosa */
function ohneAdressen(text: string): string {
  return text
    .replace(/\b(?:https?|mailto|tel):\S+/g, x)
    .replace(/\bwww\.\S+/g, x)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, x)
    .replace(/(^|\s)\/[\w./?=&%#-]+/g, (m, vor: string) => vor + x(m.slice(vor.length)))
    .replace(/\b[\w-]+\.(?:zip|png|jpg|php|ts|vue|md|json|csv|pdf|xml|txt)\b/g, x)
}

const REGELN: [string, RegExp][] = [
  ['gerader Apostroph statt ’', /\p{L}'\p{L}/gu],
  ['drei Punkte statt …', /\.\.\./g],
  // Vor : ; ? ! » % gehört ein NBSP. Ausgenommen: Uhrzeiten (10:00), «?!» und Zeilenanfang (Grenze eines Elements).
  ['fehlender NBSP vor :', /(?<![\xA0\n]|^):(?!\d)/gm],
  ['fehlender NBSP vor ; ? ! » %', /(?<![\xA0\n?!]|^)[;?!»%]/gm],
  ['fehlender NBSP nach «', /«(?!\xA0)/g],
  ['Tausendertrenner ohne NBSP', /\d(?:['’]| (?=\d{3}\b))\d{3}\b/g],
  ['Währung ohne NBSP', /\d ?(?:CHF|EUR|€|Fr\.)|(?:CHF|EUR|Fr\.) ?\d/g],
  ['Dezimalpunkt bei Betrag', /\d\.\d{2}[\xA0 ]?(?:CHF|EUR|€)|(?:CHF|EUR)[\xA0 ]?\d+\.\d/g],
  ['Einheit ohne NBSP', /\d ?(?:km|kg|Mo|Go|Ko|MB|GB|KB)\b/g],
  ['«Wordpress» statt «WordPress»', /\bWordpress\b|\bwordpress\b(?!\.(?:org|com))/g],
  ['«e-mail» nach Glossar', /\b(?:[Ee]mail|E-Mail|e-Mail|[Ee]-?MAIL)\b/g],
  ['Leerzeichen vor Punkt oder Komma', /\p{L} [.,](?=\s|$)/gmu],
]

const SIEZEN: [string, RegExp] = ['Du-Form statt «vous»', /(?<!\p{L})(?:[Tt](?:u|oi|on|es)(?!\p{L})|[Tt]’(?=\p{L}))/gu]

export function verstoesse(text: string, { duzenErlaubt = false, ausnahmen = [] as string[] } = {}): string[] {
  let prosa = ohneAdressen(text)
  for (const a of ausnahmen)
    prosa = prosa.split(a).join(x(a))
  const funde: string[] = []
  for (const [regel, muster] of duzenErlaubt ? REGELN : [...REGELN, SIEZEN]) {
    for (const m of prosa.matchAll(muster))
      funde.push(`${regel}: «${kontext(text, m.index)}»`)
  }
  return [...new Set(funde)]
}

const ENTITAETEN: Record<string, string> = { nbsp: NBSP, amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', rsquo: '’', laquo: '«', raquo: '»', hellip: '…' }

export function entitaeten(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]!.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITAETEN[e] ?? m))
}

const INLINE = 'a|strong|em|b|i|span|abbr|small|sup|sub|mark|u|s|time|label|bdi|router-link'

/** Sichtbarer Text von HTML: Titel, Description, alt-Texte und Textknoten ohne Code und Skripte */
export function sichtbarerText(html: string): string {
  const teile: string[] = []
  for (const m of html.matchAll(/<title>([\s\S]*?)<\/title>/g)) teile.push(m[1]!)
  for (const m of html.matchAll(/<meta name="description" content="([^"]*)"/g)) teile.push(m[1]!)
  for (const m of html.matchAll(/<img [^>]*alt="([^"]*)"/g)) teile.push(m[1]!)
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? html)
    .replace(/<(script|style|code|pre|template)\b[\s\S]*?<\/\1>/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    // eslint-disable-next-line regexp/prefer-character-class -- Tagnamen, keine Zeichenklasse
    .replace(new RegExp(`</?(?:${INLINE})\\b[^>]*>`, 'g'), '')
    .replace(/<[^>]+>/g, '\n')
  teile.push(body)
  return entitaeten(teile.join('\n'))
}
