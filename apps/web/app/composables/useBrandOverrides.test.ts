import { describe, expect, it } from 'vitest'
import { useBrandOverrides } from './useBrandOverrides'

describe('useBrandOverrides', () => {
  it('keeps unread profile levels inherited without mutating state', () => {
    const overrides = useBrandOverrides()

    expect(overrides.readOverride('department-1').primaryColor).toBeNull()
    expect(overrides.departmentOverrides.value).toEqual({})
  })

  it('creates editable overrides only for a selected level', () => {
    const overrides = useBrandOverrides()

    overrides.overrideFor('department-1').primaryColor = '#123456'
    overrides.teamOverrideFor('team-1').tone = 'dynamisch'

    expect(overrides.departmentOverrides.value['department-1']?.primaryColor).toBe('#123456')
    expect(overrides.teamOverrides.value['team-1']?.tone).toBe('dynamisch')
  })
})
