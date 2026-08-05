import { describe, expect, it } from 'vitest'
import { sanitizeSvg, SvgRejectedError, SvgTooComplexError } from './index.js'

const FORBIDDEN_SUBSTRINGS = [
  'onload', 'onerror', 'onclick', '<script', 'javascript:', '<iframe', '<foreignobject',
  '<image', 'url(', '<style', '<!entity', '<!doctype', 'xlink:show', 'xlink:actuate', '<set',
  '<animate', 'behavior:', '@import', '<embed', '<object',
]

function assertHarmless(sanitized: string) {
  const lowered = sanitized.toLowerCase()
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    expect(lowered, `sanitized output must not contain "${forbidden}"`).not.toContain(forbidden)
  }
}

describe('sanitizeSvg: known XSS/SSRF payload corpus', () => {
  it('strips an onload handler on the root element', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('strips onerror handlers on nested elements', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect onerror="alert(1)" onclick="alert(2)" width="1" height="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('removes a <script> element hidden inside <defs>', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><script>alert(document.cookie)</script></defs><circle r="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('strips a javascript: URI from a <use href>', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use href="javascript:alert(1)"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('strips an external xlink:href from <use> (SSRF vector)', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.example/x.svg#logo"/></svg>')
    expect(result.sanitized.toLowerCase()).not.toContain('evil.example')
    expect(result.modified).toBe(true)
  })

  it('keeps a local fragment href on <use> unchanged', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="a" d="M0 0h1v1z"/></defs><use href="#a"/></svg>')
    expect(result.sanitized).toContain('href="#a"')
  })

  it('rejects a DOCTYPE with a custom entity before parsing (XXE)', () => {
    const payload = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>'
    expect(() => sanitizeSvg(payload)).toThrow(SvgRejectedError)
  })

  it('rejects nested entity expansion before parsing (billion laughs)', () => {
    const payload = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg">&b;</svg>'
    expect(() => sanitizeSvg(payload)).toThrow(SvgRejectedError)
  })

  it('removes a <foreignObject> carrying an <iframe>', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('removes an <image> element entirely, including data: URIs', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/><circle r="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('drops a style declaration containing url()', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(javascript:alert(1))" width="1" height="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('drops a style declaration containing @import', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect style="@import url(evil.css);fill:#fff" width="1" height="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('keeps an allowlisted style property intact', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill: #163a2c; opacity: 0.5" width="1" height="1"/></svg>')
    expect(result.sanitized).toContain('fill: #163a2c')
    expect(result.sanitized).toContain('opacity: 0.5')
  })

  it('removes <set> and <animate*> elements', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"><animate attributeName="x" to="100" /><set attributeName="fill" to="red"/></rect></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('removes <embed> and <object> elements', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><embed src="evil.swf"/><object data="evil.swf"></object><circle r="1"/></svg>')
    assertHarmless(result.sanitized)
    expect(result.modified).toBe(true)
  })

  it('strips xlink:show and xlink:actuate attributes', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use href="#a" xlink:show="new" xlink:actuate="onLoad"/><defs><path id="a" d="M0 0h1v1z"/></defs></svg>')
    assertHarmless(result.sanitized)
  })

  it('rejects an oversized document before parsing', () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(1_000_000)}</svg>`
    expect(() => sanitizeSvg(huge)).toThrow(SvgTooComplexError)
  })

  it('rejects a document with too many nodes while staying under the byte limit', () => {
    const many = `<svg xmlns="http://www.w3.org/2000/svg">${'<circle r="1"/>'.repeat(6_000)}</svg>`
    expect(() => sanitizeSvg(many)).toThrow(SvgTooComplexError)
  })

  it('rejects a document with excessive nesting depth', () => {
    const deep = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(200)}<circle r="1"/>${'</g>'.repeat(200)}</svg>`
    expect(() => sanitizeSvg(deep)).toThrow(SvgTooComplexError)
  })

  it('strips a fill="url(...)" pointing to an external address (SSRF vector)', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/paint)" width="1" height="1"/></svg>')
    expect(result.sanitized.toLowerCase()).not.toContain('evil.example')
    expect(result.modified).toBe(true)
  })

  it('rejects a document without a root <svg> element', () => {
    expect(() => sanitizeSvg('<html><body>not an svg</body></html>')).toThrow(SvgRejectedError)
  })

  it('accepts a standard DOCTYPE without an internal subset, as emitted by Illustrator/Inkscape', () => {
    const payload = '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'
    expect(() => sanitizeSvg(payload)).not.toThrow()
  })
})

describe('sanitizeSvg: legitimate logo', () => {
  const legitimateLogo = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#163a2c"/>
          <stop offset="100%" stop-color="#caff4a"/>
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#grad)"/>
      <path d="M20 32 L44 20 L44 44 Z" fill="#ffffff"/>
    </svg>
  `

  it('passes through a well-formed logo with no attributes removed', () => {
    const result = sanitizeSvg(legitimateLogo)
    expect(result.sanitized).toContain('linearGradient')
    expect(result.sanitized).toContain('fill="url(#grad)"')
    expect(result.sanitized).toContain('d="M20 32 L44 20 L44 44 Z"')
    expect(result.modified).toBe(false)
  })
})
