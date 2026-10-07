import { computed, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScopeModules } from './useScopeModules'

const ORGANIZATION_A = '10000000-1000-4000-8000-000000000001'
const ORGANIZATION_B = '10000000-1000-4000-8000-000000000002'

function entriesFor(organizationId: string) {
  return [{
    scope: 'organization' as const,
    scopeId: organizationId,
    name: organizationId,
    departmentId: null,
    own: null,
    modules: [
      { module: 'social_media' as const, enabled: true, blockedBy: null },
      { module: 'playerboard' as const, enabled: false, blockedBy: 'plan' as const },
    ],
    canEdit: false,
  }]
}

type ModuleEntries = ReturnType<typeof entriesFor>

describe('useScopeModules', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ignores a late response after switching organizations and switching back', async () => {
    const scope = ref({ organizationId: ORGANIZATION_A, departmentId: null })
    const states = new Map<string, Ref<unknown>>()
    const request = vi.fn(async (path: string) => entriesFor(path.includes(ORGANIZATION_B) ? ORGANIZATION_B : ORGANIZATION_A))
    const api = { request }

    vi.stubGlobal('useState', <T>(key: string, init: () => T) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key) as Ref<T>
    })
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useApiClient', () => api)
    vi.stubGlobal('useScope', async () => scope)

    const modules = await useScopeModules()
    expect(modules.entries.value?.[0]?.scopeId).toBe(ORGANIZATION_A)

    let resolveB: (value: ModuleEntries) => void = () => {}
    let resolveA: (value: ModuleEntries) => void = () => {}
    request.mockImplementation((path: string) => new Promise<ModuleEntries>((resolve) => {
      if (path.includes(ORGANIZATION_B)) resolveB = resolve
      else resolveA = resolve
    }))

    scope.value = { organizationId: ORGANIZATION_B, departmentId: null }
    const loadingB = modules.refresh()
    scope.value = { organizationId: ORGANIZATION_A, departmentId: null }
    const loadingA = modules.refresh()

    resolveB(entriesFor(ORGANIZATION_B))
    await loadingB
    resolveA(entriesFor(ORGANIZATION_A))
    await loadingA

    expect(modules.entries.value?.[0]?.scopeId).toBe(ORGANIZATION_A)
  })
})
