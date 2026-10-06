import { permissionModule, type PermissionModule } from '@vereinsfunk/authorization'
import { AppModuleSchema } from '@vereinsfunk/contracts'
import { appModules, type AppModule } from '@vereinsfunk/domain'
import { describe, expect, it } from 'vitest'

// Paket 051: die Modulliste steht in vier Paketen (plus SQL-Enum public.app_module), weil
// authorization/domain/contracts bewusst nicht voneinander abhaengen. apps/api kennt alle drei und
// haelt sie hier deckungsgleich.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const permissionModulesMatchDomain: Equal<Exclude<PermissionModule, 'core'>, AppModule> = true

describe('module lists', () => {
  it('match between contracts and domain', () => {
    expect([...AppModuleSchema.options]).toEqual([...appModules])
  })

  it('only assign permissions to known modules', () => {
    expect(permissionModulesMatchDomain).toBe(true)
    for (const module of Object.values(permissionModule)) {
      if (module !== 'core') expect(appModules).toContain(module)
    }
  })
})
