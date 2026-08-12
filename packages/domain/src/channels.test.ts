import { describe, expect, it } from 'vitest'
import { resolveAvailableChannels, type ChannelCandidate } from './index.js'

describe('resolveAvailableChannels', () => {
  function channel(overrides: Partial<ChannelCandidate> = {}): ChannelCandidate {
    return {
      socialConnectionId: 'connection-1',
      status: 'active',
      archivedAt: null,
      responsibleProfileId: null,
      scopeGrants: [{ scope: 'organization', canSchedule: true }],
      ...overrides,
    }
  }

  it('allows a channel granted at organization scope for a department-scoped post', () => {
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [channel()], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual(['connection-1'])
  })

  it('does not let a department-scope grant cover a different department', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'department', departmentId: 'dep-1', canSchedule: true }] })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-2', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('lets a department-scope grant cover one of its own teams', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'department', departmentId: 'dep-1', canSchedule: true }] })
    const result = resolveAvailableChannels({
      scope: 'team', departmentId: 'dep-1', teamId: 'team-1', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual(['connection-1'])
  })

  it('does not let a team-scope grant cover the parent department', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'team', departmentId: 'dep-1', teamId: 'team-1', canSchedule: true }] })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('excludes a channel whose grant has can_schedule=false', () => {
    const candidate = channel({ scopeGrants: [{ scope: 'organization', canSchedule: false }] })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [candidate], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('excludes an inactive or archived channel', () => {
    const inactive = channel({ socialConnectionId: 'c-inactive', status: 'action_required' })
    const archived = channel({ socialConnectionId: 'c-archived', archivedAt: '2026-01-01T00:00:00Z' })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [inactive, archived], allowedChannelIds: null, requireChannelResponsible: false,
    })
    expect(result).toEqual([])
  })

  it('intersects with allowedChannelIds from the effective config', () => {
    const allowed = channel({ socialConnectionId: 'allowed' })
    const notAllowed = channel({ socialConnectionId: 'not-allowed' })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [allowed, notAllowed], allowedChannelIds: ['allowed'], requireChannelResponsible: false,
    })
    expect(result).toEqual(['allowed'])
  })

  it('excludes a channel without a responsible person when the policy requires one', () => {
    const withResponsible = channel({ socialConnectionId: 'has-responsible', responsibleProfileId: 'profile-1' })
    const withoutResponsible = channel({ socialConnectionId: 'no-responsible' })
    const result = resolveAvailableChannels({
      scope: 'department', departmentId: 'dep-1', channels: [withResponsible, withoutResponsible], allowedChannelIds: null, requireChannelResponsible: true,
    })
    expect(result).toEqual(['has-responsible'])
  })
})

