import { describe, expect, it } from 'vitest'
import { ClubPostPropsSchema } from './ClubPost'

describe('ClubPost props', () => {
  it('rejects unsafe color input', () => {
    expect(
      ClubPostPropsSchema.safeParse({
        clubName: 'SV Nordstadt',
        eyebrow: 'Spieltag',
        headline: 'Auf geht’s',
        detail: 'Samstag',
        primaryColor: 'red',
        accentColor: '#c7ff4a',
      }).success,
    ).toBe(false)
  })
})
