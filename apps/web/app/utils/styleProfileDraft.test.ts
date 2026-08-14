import { describe, expect, it } from 'vitest'
import { emptyStyleProfileDraft, styleRulesFromDraft } from './styleProfileDraft'

describe('styleRulesFromDraft', () => {
  it('drops a half-filled example pair instead of sending it to the LLM', () => {
    const draft = emptyStyleProfileDraft()
    draft.examples = [
      { id: '1', input: '3:1 Sieg im Lokalderby', output: '' },
      { id: '2', input: '', output: 'Ein starker Auftritt heute!' },
      { id: '3', input: 'Sieg im Auswärtsspiel', output: 'Klare Ansage nach dem Abpfiff.' },
    ]

    expect(styleRulesFromDraft(draft).examples).toEqual([
      { input: 'Sieg im Auswärtsspiel', output: 'Klare Ansage nach dem Abpfiff.' },
    ])
  })
})
