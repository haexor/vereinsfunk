import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppModuleSchema, type ScopeModules } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { anchorScopes, appModuleOrder, appModuleRegistry, canUsePermission, enabledModulesOf, moduleAvailability, moduleForPath, moduleToggleState, nextModuleSelection, scopeModulesFor, type MembershipScopeLike } from './registry'

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
    expect(layout).toContain(`v-if="isModuleEnabled('social_media') && canUse('post.create')" to="/erstellen"`)
    expect(layout).not.toContain("to: '/beitraege'")
  })

  it('routes inactive module pages to the explanation page', () => {
    const middleware = readFileSync(join(appDirectory, 'middleware/module.global.ts'), 'utf8')
    expect(middleware).toContain('moduleForPath(to.path)')
    expect(middleware).toContain("path: '/modul-inaktiv'")
  })
})

// Paket 055: Sichtbarkeit je Person nach Mitgliedschaft und Rechten.
describe('module availability per person', () => {
  const OTHER_DEPT = '10000000-1100-4000-8000-000000000002'
  const both = [{ module: 'social_media' as const, enabled: true, blockedBy: null }, { module: 'playerboard' as const, enabled: true, blockedBy: null }]
  const entries = [
    entry({ scope: 'organization', scopeId: ORG, name: 'SV', departmentId: null, modules: both }),
    entry({ scope: 'department', scopeId: DEPT, name: 'Fussball', departmentId: DEPT, modules: both }),
    entry({ scope: 'department', scopeId: OTHER_DEPT, name: 'Handball', departmentId: OTHER_DEPT, modules: [
      { module: 'social_media', enabled: false, blockedBy: 'department' }, { module: 'playerboard', enabled: true, blockedBy: null },
    ] }),
    // Die Abteilung hat Social Media fuer die U13 abgewaehlt.
    entry({ scope: 'team', scopeId: TEAM, name: 'U13', departmentId: DEPT, modules: [
      { module: 'social_media', enabled: false, blockedBy: 'team' }, { module: 'playerboard', enabled: true, blockedBy: null },
    ] }),
  ]
  /** Sitzungs-Scope mit Rollen auf Verein, Fussball (DEPT), Handball und der U13. */
  function membership(roles: { organization?: MembershipScopeLike['organizationRoles']; department?: MembershipScopeLike['organizationRoles']; otherDepartment?: MembershipScopeLike['organizationRoles']; team?: MembershipScopeLike['organizationRoles'] }): MembershipScopeLike {
    return {
      organizationId: ORG,
      organizationRoles: roles.organization ?? [],
      departments: [
        { id: DEPT, roles: roles.department ?? [], teams: [{ id: TEAM, roles: roles.team ?? [] }] },
        { id: OTHER_DEPT, roles: roles.otherDepartment ?? [], teams: [] },
      ],
    }
  }
  const atOrganization = { organizationId: ORG, departmentId: null }

  it('leaves an organization role unchanged', () => {
    const anchors = anchorScopes(membership({ organization: ['organization_admin'] }), atOrganization)
    expect(moduleAvailability(entries, anchors, 'social_media').state).toBe('visible')
    expect(moduleAvailability(entries, anchors, 'playerboard').state).toBe('visible')
  })

  it('hides social media from a player even where it is active', () => {
    const anchors = anchorScopes(membership({ team: ['player'] }), atOrganization)
    expect(anchors.map((anchor) => anchor.scope)).toEqual(['team'])
    expect(moduleAvailability(entries, anchors, 'social_media').state).toBe('no_access')
    expect(moduleAvailability(entries, anchors, 'playerboard').state).toBe('visible')
    expect(canUsePermission(entries, anchors, 'post.create')).toBe(false)
  })

  it('applies a team-level deselection to a team-only member in the organization working area', () => {
    const anchors = anchorScopes(membership({ team: ['team_manager'] }), atOrganization)
    const result = moduleAvailability(entries, anchors, 'social_media')
    expect(result.state).toBe('disabled')
    expect(result.explanation?.scopeId).toBe(TEAM)
    expect(canUsePermission(entries, anchors, 'post.create')).toBe(false)
    expect(canUsePermission(entries, anchors, 'training.manage')).toBe(true)
  })

  it('takes the department where a department admin holds the role, not the organization', () => {
    const anchors = anchorScopes(membership({ otherDepartment: ['department_admin'] }), atOrganization)
    expect(moduleAvailability(entries, anchors, 'social_media').state).toBe('disabled')
    expect(moduleAvailability(entries, anchors, 'playerboard').state).toBe('visible')
  })

  it('treats an organization member working in a department as a member of that department', () => {
    const anchors = anchorScopes(membership({ organization: ['social_manager'] }), { organizationId: ORG, departmentId: OTHER_DEPT })
    expect(anchors).toEqual([{ scope: 'department', scopeId: OTHER_DEPT, roles: ['social_manager'] }])
    expect(moduleAvailability(entries, anchors, 'social_media').state).toBe('disabled')
  })

  it('keeps permissions in force while the module list is unknown', () => {
    const player = anchorScopes(membership({ team: ['player'] }), atOrganization)
    expect(moduleAvailability(null, player, 'social_media').state).toBe('no_access')
    expect(moduleAvailability(null, player, 'playerboard').state).toBe('visible')
    const coach = anchorScopes(membership({ team: ['team_manager'] }), atOrganization)
    expect(canUsePermission(null, coach, 'post.create')).toBe(true)
  })

  it('shows PlayerBoard management only with playerboard.manage', () => {
    const management = appModuleRegistry.playerboard.managementNavigation
    expect(management.every((item) => item.permissions?.includes('playerboard.manage'))).toBe(true)
  })
})
