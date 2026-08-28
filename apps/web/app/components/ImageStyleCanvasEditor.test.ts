import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ImageStyleCanvasEditor layout', () => {
  it('allows the canvas preview to shrink within narrow page columns', () => {
    const component = readFileSync(join(import.meta.dirname, 'ImageStyleCanvasEditor.vue'), 'utf8')

    expect(component).toContain('w-full min-w-0')
    expect(component).toContain('min-h-[min(440px,calc(100vw-4rem))]')
  })
})
