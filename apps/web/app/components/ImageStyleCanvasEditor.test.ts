import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ImageStyleCanvasEditor layout', () => {
  it('allows the canvas preview to shrink within narrow page columns', () => {
    const component = readFileSync(join(import.meta.dirname, 'ImageStyleCanvasEditor.vue'), 'utf8')
    const canvasHost = component.match(/<div\s+ref="canvasHost"\s+class="([^"]+)"/s)

    expect(canvasHost?.[1]).toContain('w-full')
    expect(canvasHost?.[1]).toContain('min-w-0')
    expect(canvasHost?.[1]).toContain('min-h-[min(440px,calc(100vw-4rem))]')
  })
})
