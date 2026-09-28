/**
 * HTML-Fassung einer Textmail. Outlook zieht in reinen Textmails «überflüssige Zeilenumbrüche» zusammen und klebt
 * etwa die Signatur auf eine Zeile; darum geht jede Mail als Text plus diese schlichte HTML-Fassung raus: jede Zeile
 * mit <br>, Leerzeilen als Absatz, URLs und Mailadressen als Links, «>»-Zitate als Blockquote, keine Bilder, kein
 * Tracking. Gleiche Regeln wie `text_to_html` in ~/projects/tools/mailbox.py.
 */

const LINK = /(?<url>(?:https?:\/\/|www\.)[^\s<>"]+)|(?<mail>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g
const HTML_STYLE = 'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; '
  + 'font-size: 14px; line-height: 1.5; color: #222222;'
const P_STYLE = 'margin: 0 0 1em 0;'
const QUOTE_STYLE = 'margin: 0 0 1em 0; padding-left: 0.8em; border-left: 3px solid #cccccc; color: #555555;'

function escapeHtml(text: string): string {
  // replace mit /g statt replaceAll: die Wartungsheft-App baut mit einer älteren lib
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function linkify(line: string): string {
  let out = ''
  let pos = 0
  for (const m of line.matchAll(LINK)) {
    let target = m[0]
    let trail = ''
    let href: string
    if (m.groups?.url) {
      const stripped = target.replace(/[.,;:!?)]+$/, '')
      trail = target.slice(stripped.length)
      target = stripped
      href = target.startsWith('http') ? target : `https://${target}`
    }
    else {
      href = `mailto:${target}`
    }
    out += `${escapeHtml(line.slice(pos, m.index))}<a href="${escapeHtml(href)}">${escapeHtml(target)}</a>${escapeHtml(trail)}`
    pos = m.index + m[0].length
  }
  return out + escapeHtml(line.slice(pos))
}

function blocks(lines: string[]): string[] {
  const out: string[] = []
  const paragraph: string[] = []
  const quote: string[] = []
  const flushParagraph = () => {
    if (paragraph.length)
      out.push(`<p style="${P_STYLE}">${paragraph.map(linkify).join('<br>\n')}</p>`)
    paragraph.length = 0
  }
  const flushQuote = () => {
    if (quote.length)
      out.push(`<blockquote style="${QUOTE_STYLE}">\n${blocks(quote.map(l => l.replace(/^> ?/, ''))).join('\n')}\n</blockquote>`)
    quote.length = 0
  }
  for (const line of lines) {
    if (line.startsWith('>')) {
      flushParagraph()
      quote.push(line)
    }
    else if (!line.trim()) {
      flushParagraph()
      flushQuote()
    }
    else {
      flushQuote()
      paragraph.push(line.trimEnd())
    }
  }
  flushParagraph()
  flushQuote()
  return out
}

export function textToHtml(text: string): string {
  const body = blocks(text.split(/\r?\n/)).join('\n')
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n<div style="${HTML_STYLE}">\n${body}\n</div>\n</body>\n</html>\n`
}
