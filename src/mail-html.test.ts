import { describe, expect, it } from 'vitest'
import { textToHtml } from './mail-html.ts'

const signatur = [
  'Guten Tag',
  '',
  'Text mit <Tag> & Co.',
  '',
  'Freundliche Grüsse',
  'Goran Strainovic',
  '',
  'Wartungsheft',
  'Strainovic IT',
  'Bahnstrasse 9b',
  '9323 Steinach',
  'info@wartungsheft.ch',
  'www.wartungsheft.ch',
].join('\n')

describe('textToHtml', () => {
  it('setzt jede Zeile mit <br> und Leerzeilen als Absatz', () => {
    const html = textToHtml(signatur)
    expect(html).toContain('Strainovic IT<br>\nBahnstrasse 9b<br>\n9323 Steinach<br>\n')
    expect(html).toContain('Freundliche Grüsse<br>\nGoran Strainovic</p>')
    expect(html.match(/<p/g)).toHaveLength(4)
  })

  it('escaped < > &', () => {
    expect(textToHtml('a < b & c > d')).toContain('a &lt; b &amp; c &gt; d')
    expect(textToHtml(signatur)).not.toContain('<Tag>')
  })

  it('macht URLs und Mailadressen zu Links, Satzzeichen am Ende bleiben draussen', () => {
    const html = textToHtml('Siehe https://wartungsheft.ch/settings?a=1&b=2. Oder www.wartungsheft.ch, info@wartungsheft.ch')
    expect(html).toContain('<a href="https://wartungsheft.ch/settings?a=1&amp;b=2">https://wartungsheft.ch/settings?a=1&amp;b=2</a>. ')
    expect(html).toContain('<a href="https://www.wartungsheft.ch">www.wartungsheft.ch</a>,')
    expect(html).toContain('<a href="mailto:info@wartungsheft.ch">info@wartungsheft.ch</a>')
  })

  it('schlicht: System-Schrift, keine Bilder, UTF-8', () => {
    const html = textToHtml(signatur)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('font-family')
    expect(html).not.toContain('<img')
  })
})
