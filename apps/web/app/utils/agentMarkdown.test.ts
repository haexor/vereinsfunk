import { describe, expect, it } from 'vitest'
import { renderAgentMarkdown } from './agentMarkdown'

describe('agent Markdown', () => {
  it('renders headings, lists and inline emphasis for assistant replies', () => {
    const html = renderAgentMarkdown('## Nächste Schritte\n\n- **Termin** vorbereiten\n- *Mitglieder* einladen')

    expect(html).toContain('<h2>Nächste Schritte</h2>')
    expect(html).toContain('<li><strong>Termin</strong> vorbereiten</li>')
    expect(html).toContain('<li><em>Mitglieder</em> einladen</li>')
  })

  it('escapes HTML and rejects unsafe Markdown links before v-html renders the output', () => {
    const html = renderAgentMarkdown('<script>alert(1)</script>\n\n[Nicht öffnen](javascript:alert(1))')

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
  })

  it('does not render images, which the browser would fetch without a click', () => {
    const html = renderAgentMarkdown('![](https://angreifer.example/?d=geheim)')

    expect(html).not.toContain('<img')
  })

  it('opens links in a new tab without opener, referrer or endorsement', () => {
    const html = renderAgentMarkdown('[Spielplan](https://verein.example/spielplan) und https://verein.example')

    expect(html).toContain('<a href="https://verein.example/spielplan" target="_blank" rel="noopener noreferrer nofollow">Spielplan</a>')
    expect(html).toContain('<a href="https://verein.example" target="_blank" rel="noopener noreferrer nofollow">')
  })
})
