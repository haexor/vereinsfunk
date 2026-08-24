import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentDirectory = import.meta.dirname
const preview = readFileSync(join(componentDirectory, 'ImageStyleFramePreview.vue'), 'utf8')

describe('ImageStyleFramePreview', () => {
  it('uses the supplied team photo for every frame and filter preview', () => {
    expect(existsSync(join(componentDirectory, '../../public/images/alejandro-stuardo-team-photo.jpg'))).toBe(true)
    expect(preview).toContain('src="/images/alejandro-stuardo-team-photo.jpg"')
    expect(preview).toContain(':style="photoFilterCss ? { filter: photoFilterCss } : undefined"')
  })
})
