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
})
