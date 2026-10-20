import { describe, expect, it } from 'vitest'
import { parseModelListingIds } from './llmProviders.js'

describe('parseModelListingIds', () => {
  it('reads the ids of an OpenAI-compatible model listing, sorted and without duplicates', () => {
    const models = parseModelListingIds({
      object: 'list',
      data: [
        { id: 'claude-sonnet-5', object: 'model' },
        { id: 'claude-opus-5', object: 'model' },
        { id: 'claude-opus-5', object: 'model' },
      ],
    })
    expect(models).toEqual(['claude-opus-5', 'claude-sonnet-5'])
  })

  it('skips entries without a usable id instead of failing the whole listing', () => {
    // Ein Anbieter, der zusaetzliche oder unbrauchbare Eintraege liefert, soll das Auswahlfeld
    // nicht blockieren -- der Rest der Liste bleibt verwendbar.
    const models = parseModelListingIds({
      data: [{ id: 'claude-opus-5' }, { id: '   ' }, { id: 42 }, {}, null, 'nonsense', { id: 'x'.repeat(121) }],
    })
    expect(models).toEqual(['claude-opus-5'])
  })

  it.each<[unknown, string]>([
    [null, 'kein Objekt'],
    [{}, 'kein data-Feld'],
    [{ data: {} }, 'data ist keine Liste'],
    [{ data: [] }, 'leere Liste'],
  ])('returns an empty list for %j (%s)', (payload) => {
    expect(parseModelListingIds(payload)).toEqual([])
  })
})
