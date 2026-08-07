import { describe, expect, it } from 'vitest'
import { ClubPostPropsSchema } from './ClubPost'

const baseProps = {
  clubName: 'SV Nordstadt',
  eyebrow: 'Spieltag',
  headline: 'Auf geht’s',
  detail: 'Samstag',
  primaryColor: '#142c24',
  accentColor: '#c7ff4a',
}

describe('ClubPost props', () => {
  it('rejects unsafe color input', () => {
    expect(
      ClubPostPropsSchema.safeParse({
        ...baseProps,
        primaryColor: 'red',
      }).success,
    ).toBe(false)
  })

  it('defaults to the curated Manrope/DM Sans pairing and no logo when brand props are omitted', () => {
    const parsed = ClubPostPropsSchema.parse(baseProps)
    expect(parsed.displayFont).toEqual({ kind: 'curated', key: 'manrope' })
    expect(parsed.bodyFont).toEqual({ kind: 'curated', key: 'dm_sans' })
    expect(parsed.logoUrl).toBeNull()
  })

  it('accepts a custom uploaded font with a signed URL', () => {
    const parsed = ClubPostPropsSchema.parse({
      ...baseProps,
      displayFont: { kind: 'custom', family: 'Vereins Grotesk', url: 'https://storage.example.test/brand/font.woff2', weight: 700, style: 'normal' },
    })
    expect(parsed.displayFont).toMatchObject({ kind: 'custom', family: 'Vereins Grotesk' })
  })

  it('rejects a custom font spec without a valid URL', () => {
    expect(
      ClubPostPropsSchema.safeParse({
        ...baseProps,
        displayFont: { kind: 'custom', family: 'Vereins Grotesk', url: 'not-a-url' },
      }).success,
    ).toBe(false)
  })

  it('rejects a curated font key outside the registry', () => {
    expect(
      ClubPostPropsSchema.safeParse({
        ...baseProps,
        displayFont: { kind: 'curated', key: 'comic_sans' },
      }).success,
    ).toBe(false)
  })

  it('accepts a signed logo URL', () => {
    const parsed = ClubPostPropsSchema.parse({ ...baseProps, logoUrl: 'https://storage.example.test/brand/logo.png' })
    expect(parsed.logoUrl).toBe('https://storage.example.test/brand/logo.png')
  })
})
