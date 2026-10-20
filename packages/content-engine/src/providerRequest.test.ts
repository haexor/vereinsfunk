import { describe, expect, it } from 'vitest'
import { joinUrlPath } from './providerRequest.js'

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
