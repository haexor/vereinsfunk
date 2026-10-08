import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppModuleSchema, type ScopeModules } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { appModuleOrder, appModuleRegistry, enabledModulesOf, moduleForPath, moduleToggleState, nextModuleSelection, scopeModulesFor } from './registry'

const ORG = '10000000-1000-4000-8000-000000000001'
const DEPT = '10000000-1100-4000-8000-000000000001'
const TEAM = '10000000-1200-4000-8000-000000000001'

function entry(overrides: Partial<ScopeModules>): ScopeModules {
  return {
    scope: 'department', scopeId: DEPT, name: 'Fussball', departmentId: DEPT, own: null, canEdit: true,
    modules: [
      { module: 'social_media', enabled: true, blockedBy: null },
      { module: 'playerboard', enabled: true, blockedBy: null },
    ],
    ...overrides,
  }
}

describe('module registry', () => {
  it('lists every module of the contract exactly once', () => {
    expect([...appModuleOrder]).toEqual([...AppModuleSchema.options])
    expect(Object.keys(appModuleRegistry).sort()).toEqual([...AppModuleSchema.options].sort())
  })

  it('keeps the existing social media URLs without a module prefix', () => {
    expect(moduleForPath('/beitraege')).toBe('social_media')
    expect(moduleForPath('/erstellen')).toBe('social_media')
    expect(moduleForPath('/kanaele')).toBe('social_media')
  })

  it('matches sub paths but not bare prefixes, and leaves framework routes alone', () => {
    expect(moduleForPath('/playerboard/rangliste')).toBe('playerboard')
    expect(moduleForPath('/beitraege-archiv')).toBeNull()
    expect(moduleForPath('/')).toBeNull()
    expect(moduleForPath('/kalender')).toBeNull()
    expect(moduleForPath('/einstellungen/module')).toBeNull()
    expect(moduleForPath('/modul-inaktiv')).toBeNull()
  })

  it('assigns every route to at most one module', () => {
    const routes = appModuleOrder.flatMap((module) => {
      const definition = appModuleRegistry[module]
      return [...definition.navigation, ...definition.managementNavigation].map((item) => item.to).concat(definition.extraRoutes)
    })
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('every module route has a page', () => {
    const pagesDirectory = join(import.meta.dirname, '..', 'pages')
    for (const module of appModuleOrder) {
      for (const item of [...appModuleRegistry[module].navigation, ...appModuleRegistry[module].managementNavigation]) {
        // Eine Route ist entweder eine Datei (/kanaele -> kanaele.vue) oder ein Ordner mit index.vue
        // (/playerboard/trainings -> playerboard/trainings/index.vue).
        const candidates = [`${item.to.slice(1)}.vue`, `${item.to.slice(1)}/index.vue`]
        expect(candidates.some((candidate) => existsSync(join(pagesDirectory, candidate))), item.to).toBe(true)
      }
    }
  })
})

describe('active scope lookup', () => {
  const entries = [
    entry({ scope: 'organization', scopeId: ORG, departmentId: null }),
    entry({ modules: [{ module: 'social_media', enabled: false, blockedBy: 'department' }, { module: 'playerboard', enabled: true, blockedBy: null }] }),
  ]

  it('picks the department entry in a department and the organization entry otherwise', () => {
    expect(enabledModulesOf(scopeModulesFor(entries, { organizationId: ORG, departmentId: DEPT }))).toEqual(['playerboard'])
    expect(enabledModulesOf(scopeModulesFor(entries, { organizationId: ORG, departmentId: null }))).toEqual(['social_media', 'playerboard'])
  })

  it('treats a missing entry as no module', () => {
    expect(enabledModulesOf(scopeModulesFor(entries, { organizationId: ORG, departmentId: 'unknown' }))).toEqual([])
  })
})

describe('module toggles', () => {
  it('distinguishes inherited, selected, deselected and locked', () => {
    expect(moduleToggleState(entry({}), 'social_media')).toBe('inherited')
    expect(moduleToggleState(entry({ own: ['social_media'] }), 'social_media')).toBe('selected')
    expect(moduleToggleState(entry({ own: ['social_media'], modules: [
      { module: 'social_media', enabled: true, blockedBy: null },
      { module: 'playerboard', enabled: false, blockedBy: 'department' },
    ] }), 'playerboard')).toBe('deselected')
    expect(moduleToggleState(entry({ modules: [
      { module: 'social_media', enabled: true, blockedBy: null },
      { module: 'playerboard', enabled: false, blockedBy: 'plan' },
    ] }), 'playerboard')).toBe('locked')
    expect(moduleToggleState(entry({ scope: 'team', scopeId: TEAM, modules: [
      { module: 'social_media', enabled: false, blockedBy: 'department' },
      { module: 'playerboard', enabled: true, blockedBy: null },
    ] }), 'social_media')).toBe('locked')
  })

  it('turns "inherit" into an explicit list of the modules available above when deselecting', () => {
    expect(nextModuleSelection(entry({}), 'social_media', false)).toEqual(['playerboard'])
  })

  it('never re-adds a module that is locked above', () => {
    const lockedAbove = entry({ modules: [
      { module: 'social_media', enabled: true, blockedBy: null },
      { module: 'playerboard', enabled: false, blockedBy: 'organization' },
    ] })
    expect(nextModuleSelection(lockedAbove, 'social_media', false)).toEqual([])
  })

  it('re-enables a deselected module in registry order', () => {
    const deselected = entry({ own: ['playerboard'], modules: [
      { module: 'social_media', enabled: false, blockedBy: 'department' },
      { module: 'playerboard', enabled: true, blockedBy: null },
    ] })
    expect(nextModuleSelection(deselected, 'social_media', true)).toEqual(['social_media', 'playerboard'])
  })
})

describe('app shell wiring', () => {
  const appDirectory = join(import.meta.dirname, '..')

  it('builds the sidebar from the registry and hides post creation without social media', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')
    expect(layout).toContain('appModuleRegistry[module].navigation')
    expect(layout).toContain(`v-if="isModuleEnabled('social_media')" to="/erstellen"`)
    expect(layout).not.toContain("to: '/beitraege'")
  })

  it('routes inactive module pages to the explanation page', () => {
    const middleware = readFileSync(join(appDirectory, 'middleware/module.global.ts'), 'utf8')
    expect(middleware).toContain('moduleForPath(to.path)')
    expect(middleware).toContain("path: '/modul-inaktiv'")
  })
})
