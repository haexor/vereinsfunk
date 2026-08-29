import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'PhotoImageWorkshop.vue'), 'utf8')

describe('PhotoImageWorkshop layout', () => {
  it('is embedded in its host instead of rendering as a modal', () => {
    expect(component).toContain('<section class="flex min-h-[680px]')
    expect(component).not.toContain('fixed inset-0')
    expect(component).not.toContain('aria-modal="true"')
  })

  it('keeps every tool reachable on narrow screens', () => {
    expect(component).toContain('overflow-x-auto')
    expect(component).toContain('min-w-[5.5rem] shrink-0')
  })

  it('uses the cropper result for export dimensions and allows a movable crop area', () => {
    expect(component).toContain('result?.coordinates.width')
    expect(component).toContain('image-restriction="fit-area"')
    expect(component).toContain('@change="onCropChange"')
  })

  it('loads selectable frame assets from the shared brand asset library', () => {
    expect(component).toContain('selectableFrameAssets')
    expect(component).toContain('props.frameAssets ?? selectableAssetsToCards')
    expect(component).toContain('const frames = computed')
  })
})
