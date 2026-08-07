import { describe, expect, it } from 'vitest'
import { canAssignRole, canRemoveRole, hasPermission } from './index.js'

describe('authorization', () => {
  it('lets editors edit but not approve', () => {
    expect(hasPermission(['editor'], 'post.edit')).toBe(true)
    expect(hasPermission(['editor'], 'post.approve')).toBe(false)
  })

  it('combines permissions from scoped roles', () => {
    expect(hasPermission(['billing_admin', 'approver'], 'post.approve')).toBe(true)
    expect(hasPermission(['billing_admin', 'approver'], 'billing.manage')).toBe(true)
  })

  it('lets department_admin and team_manager manage their own branding, but not editor/contributor', () => {
    expect(hasPermission(['department_admin'], 'brand.manage')).toBe(true)
    expect(hasPermission(['team_manager'], 'brand.manage')).toBe(true)
    expect(hasPermission(['editor'], 'brand.manage')).toBe(false)
    expect(hasPermission(['contributor'], 'brand.manage')).toBe(false)
  })
})

describe('canAssignRole', () => {
  it('never allows assigning organization_owner, even to another organization_owner', () => {
    expect(canAssignRole(['organization_owner'], 'organization_owner')).toBe(false)
  })

  it('lets organization_admin assign roles at or below its own rank', () => {
    expect(canAssignRole(['organization_admin'], 'department_admin')).toBe(true)
    expect(canAssignRole(['organization_admin'], 'team_manager')).toBe(true)
  })

  it('blocks organization_admin from assigning a role more powerful than its own', () => {
    expect(canAssignRole(['organization_admin'], 'organization_owner')).toBe(false)
  })

  it('lets a department_admin assign a peer department_admin in the same department', () => {
    expect(canAssignRole(['department_admin'], 'department_admin')).toBe(true)
  })

  it('blocks a department_admin from assigning an organization-level role', () => {
    expect(canAssignRole(['department_admin'], 'organization_admin')).toBe(false)
  })

  it('blocks a team_manager from assigning anything above its own rank', () => {
    expect(canAssignRole(['team_manager'], 'department_admin')).toBe(false)
    expect(canAssignRole(['team_manager'], 'contributor')).toBe(true)
  })

  it('returns false for no roles at all', () => {
    expect(canAssignRole([], 'viewer')).toBe(false)
  })
})

describe('canRemoveRole', () => {
  // Regression: an earlier version only checked rank on assignment, never on removal/demotion --
  // an organization_admin (rank 90) could remove or demote an organization_owner (rank 100) as
  // long as at least one other owner remained, since nothing compared the actor's rank against
  // the target's CURRENT role.
  it('blocks organization_admin from removing an organization_owner', () => {
    expect(canRemoveRole(['organization_admin'], 'organization_owner')).toBe(false)
  })

  it('unlike canAssignRole, lets an organization_owner remove another organization_owner', () => {
    expect(canRemoveRole(['organization_owner'], 'organization_owner')).toBe(true)
  })

  it('lets organization_admin remove a peer organization_admin', () => {
    expect(canRemoveRole(['organization_admin'], 'organization_admin')).toBe(true)
  })

  it('blocks a department_admin from removing an organization_admin', () => {
    expect(canRemoveRole(['department_admin'], 'organization_admin')).toBe(false)
  })

  it('lets a department_admin remove a lower-ranked department member', () => {
    expect(canRemoveRole(['department_admin'], 'editor')).toBe(true)
  })

  it('returns false for no roles at all', () => {
    expect(canRemoveRole([], 'viewer')).toBe(false)
  })
})
