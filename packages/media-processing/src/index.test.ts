import { describe, expect, it } from 'vitest'
import { assertNormalizedBox, assertSafeObscuringDecision } from './index.js'

describe('media processing guardrails', () => {
  it('accepts normalized boxes and rejects boxes outside the image', () => {
    expect(assertNormalizedBox({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })).toBeDefined()
    expect(() => assertNormalizedBox({ x: 0.9, y: 0.1, width: 0.2, height: 0.2 })).toThrow()
  })
  it('requires a supported opaque obscuring style', () => expect(() => assertSafeObscuringDecision({ kind: 'obscure', style: 'solid_blur' })).not.toThrow())
})
