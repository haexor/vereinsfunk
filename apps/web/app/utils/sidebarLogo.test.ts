import { describe, expect, it } from 'vitest'
import { resolveSidebarLogoAsset, type SidebarLogoAsset } from './sidebarLogo'

const organizationLogo: SidebarLogoAsset = {
  id: 'organization-logo', departmentId: null, teamId: null, kind: 'logo_primary',
  objectPath: 'organizations/1/brand/organization.png', status: 'ready',
}
const departmentLogo: SidebarLogoAsset = {
  id: 'department-logo', departmentId: 'department-1', teamId: null, kind: 'logo_primary',
  objectPath: 'organizations/1/departments/1/brand/department.png', status: 'ready',
}

describe('resolveSidebarLogoAsset', () => {
  it('prefers the explicitly selected logo', () => {
    expect(resolveSidebarLogoAsset([organizationLogo, departmentLogo], 'department-1', 'organization-logo'))
      .toBe(organizationLogo)
  })

  it('uses an uploaded department logo before the club logo when nothing is selected', () => {
    expect(resolveSidebarLogoAsset([organizationLogo, departmentLogo], 'department-1', null))
      .toBe(departmentLogo)
  })

  it('falls back to the club logo and never shows processing files', () => {
    expect(resolveSidebarLogoAsset([
      { ...departmentLogo, status: 'processing' },
      organizationLogo,
    ], 'department-1', null)).toBe(organizationLogo)
  })
})
