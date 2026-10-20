import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useActiveScope } from './useActiveScope'

const MEMBERSHIP = {
  organizationId: 'verein-1',
  organizationName: 'SV Musterstadt',
  organizationTimezone: 'Europe/Vienna',
  organizationRoles: [],
  departments: [],
}

describe('useActiveScope', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the active organization and its timezone, falling back for an unknown one', async () => {
    const scope = ref({ organizationId: 'verein-1', departmentId: null as string | null })
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useSession', async () => ref({ scopes: [MEMBERSHIP] }))
    vi.stubGlobal('useScope', async () => scope)

    const active = await useActiveScope()
    expect(active.organization.value?.organizationName).toBe('SV Musterstadt')
    expect(active.organizationTimezone.value).toBe('Europe/Vienna')

    scope.value = { organizationId: 'verein-2', departmentId: null }
    expect(active.organization.value).toBeNull()
    expect(active.organizationTimezone.value).toBe('Europe/Berlin')
  })
})
