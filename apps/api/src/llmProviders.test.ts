import { describe, expect, it } from 'vitest'
import { joinUrlPath, parseModelListingIds } from './llmProviders.js'

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

describe('joinUrlPath', () => {
  it('appends the path to a base url without a trailing slash', () => {
    expect(joinUrlPath('https://api.openai.com/v1', 'models')).toBe('https://api.openai.com/v1/models')
  })

  it('appends the path to a base url with a trailing slash', () => {
    expect(joinUrlPath('https://api.openai.com/v1/', 'models')).toBe('https://api.openai.com/v1/models')
  })

  it('keeps the query string on the base url instead of swallowing the last path segment', () => {
    // String-Konkatenation ("…/v1?key=abc" + "/") wuerde den "/" hinter das "?" haengen und damit
    // sowohl "v1" als auch den Query-String beim Aufloesen verschlucken.
    expect(joinUrlPath('https://openrouter.ai/api/v1?key=abc', 'models')).toBe('https://openrouter.ai/api/v1/models?key=abc')
  })
})
