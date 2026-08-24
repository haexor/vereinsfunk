import { describe, expect, it } from 'vitest'
import { EmbeddedProviderSecretSchema, unwrapEmbeddedSecret } from './secretBox.js'

describe('EmbeddedProviderSecretSchema', () => {
  const secret = { api_key_ciphertext: '\\x00', key_version: 'v1' }

  it('accepts a bare object and a single-element array identically', () => {
    expect(EmbeddedProviderSecretSchema.safeParse(secret).success).toBe(true)
    expect(EmbeddedProviderSecretSchema.safeParse([secret]).success).toBe(true)
  })

  // llm_provider_configuration_id is PRIMARY KEY on llm_provider_secrets -- a valid PostgREST
  // response can never embed more than one row, so a two-element array signals a schema mismatch
  // rather than a real ambiguity to unwrap.
  it('rejects an array with more than one element', () => {
    expect(EmbeddedProviderSecretSchema.safeParse([secret, secret]).success).toBe(false)
  })

  it('rejects an empty array', () => {
    expect(EmbeddedProviderSecretSchema.safeParse([]).success).toBe(false)
  })
})

describe('unwrapEmbeddedSecret', () => {
  it('returns a bare object unchanged', () => {
    expect(unwrapEmbeddedSecret({ value: 1 })).toEqual({ value: 1 })
  })

  it('unwraps a single-element array', () => {
    expect(unwrapEmbeddedSecret([{ value: 1 }])).toEqual({ value: 1 })
  })
})
