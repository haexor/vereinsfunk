import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appDirectory = join(import.meta.dirname, '..')

describe('standard app page layout', () => {
  it('provides the shared content frame from the default Nuxt layout', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')

    expect(layout).toContain(
      "route.path === '/bildstil' ? 'max-w-[1800px] lg:px-6' : 'max-w-[1280px]'",
    )
  })

  it('keeps the image-style workshop shrinkable', () => {
    const imageStylePage = readFileSync(join(appDirectory, 'pages/bildstil.vue'), 'utf8')

    expect(imageStylePage).toContain('<section v-else class="card overflow-hidden">')
    expect(imageStylePage).toContain('<PhotoImageWorkshop')
  })

  it('defers the authenticated app shell until client session data is available', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')
    const shell = readFileSync(join(appDirectory, 'components/AppShell.vue'), 'utf8')

    expect(layout).toContain('<AppShell')
    expect(shell).toContain('<ClientOnly>')
    expect(shell).toContain('<template #fallback>')
    expect(shell).toContain('Anwendung wird geladen …')
  })

  it('offers the organization itself as a first-class working context and renders page save actions as a FAB', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')
    const scopeSwitcher = readFileSync(join(appDirectory, 'components/SidebarScopeSwitcher.vue'), 'utf8')

    expect(scopeSwitcher).toContain('SelectItem')
    expect(scopeSwitcher).toContain('value="organization"')
    expect(layout).toContain('<PageSaveFab />')
  })

  it('derives independent sidebar text colors and reloads the active club branding after a save', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')
    const brandPageData = readFileSync(join(appDirectory, 'composables/useBrandPageData.ts'), 'utf8')
    const scopeBrand = readFileSync(join(appDirectory, 'composables/useScopeBrand.ts'), 'utf8')

    expect(layout).toContain('deriveSidebarPalette')
    expect(scopeBrand).toContain('resolveSidebarLogoAsset')
    expect(scopeBrand).toContain('revision.value')
    expect(layout).toContain('v-model:logo-url="scopeLogoUrl"')
    expect(readFileSync(join(appDirectory, 'components/SidebarScopeSwitcher.vue'), 'utf8')).toContain('@error="logoUrl = \'\'"')
    expect(brandPageData).toContain('refreshBrandRevision()')
  })
})
