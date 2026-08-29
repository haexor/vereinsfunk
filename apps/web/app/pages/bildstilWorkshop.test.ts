import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Bildstil photo workshop', () => {
  it('uses the photo workshop instead of the legacy canvas editor', () => {
    const page = readFileSync(join(import.meta.dirname, 'bildstil.vue'), 'utf8')

    expect(page).toContain('<PhotoImageWorkshop')
    expect(page).toContain('@save="acceptWorkshopFile"')
    expect(page).not.toContain('<ImageStyleCanvasEditor')
  })
})
