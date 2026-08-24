import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appDirectory = join(import.meta.dirname, '..')

describe('standard app page layout', () => {
  it('provides the shared content frame from the default Nuxt layout', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')

    expect(layout).toContain('<div class="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-10"><slot /></div>')
  })

  it('defers the authenticated app shell until client session data is available', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')

    expect(layout).toContain('<ClientOnly>')
    expect(layout).toContain('<template #fallback>')
    expect(layout).toContain('Anwendung wird geladen …')
  })

  it('offers the organization itself as a first-class working context and renders page save actions as a FAB', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')

    expect(layout).toContain('<SelectItem value="organization">')
    expect(layout).toContain('<PageSaveFab />')
  })

  it('derives independent sidebar text colors and reloads the active club branding after a save', () => {
    const layout = readFileSync(join(appDirectory, 'layouts/default.vue'), 'utf8')
    const brandPage = readFileSync(join(appDirectory, 'pages/marke.vue'), 'utf8')

    expect(layout).toContain('deriveSidebarPalette')
    expect(layout).toContain('resolveSidebarLogoAsset')
    expect(layout).toContain('brandRevision.value')
    expect(layout).toContain('@error="scopeLogoUrl = \'\'"')
    expect(brandPage).toContain('refreshBrandRevision()')
  })
})
