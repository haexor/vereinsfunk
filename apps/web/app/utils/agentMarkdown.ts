import MarkdownIt from 'markdown-it'

// `html: false` ist entscheidend: markdown-it escaped fremdes HTML und validiert Links, bevor
// die erzeugte Ausgabe in der Chat-Blase per v-html gerendert wird.
const renderer = new MarkdownIt({ html: false, breaks: true, linkify: true })

export function renderAgentMarkdown(content: string) {
  return renderer.render(content)
}
