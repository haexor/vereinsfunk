import { describe, expect, it } from 'vitest'
import { resolveDividerColor } from './photoLayoutPresets'

const COLORS = { primaryColor: '#163a2c', accentColor: '#caff4a' }

describe('resolveDividerColor', () => {
  it('maps the brand roles to the current club colours and keeps a fixed hex value', () => {
    expect(resolveDividerColor('primary', COLORS)).toBe('#163a2c')
    expect(resolveDividerColor('accent', COLORS)).toBe('#caff4a')
    expect(resolveDividerColor('#ffffff', COLORS)).toBe('#ffffff')
  })
})
