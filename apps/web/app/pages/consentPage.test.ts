import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Formular- und Ladezustand der Einwilligungsseite -- ohne Seiten-Mount nur im Quelltext
// festzuhalten, dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Einwilligungen', () => {
  it('leert das Datei-Feld nach dem Hinterlegen einer Papiererklaerung', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligungen.vue'), 'utf8')

    expect(page).toContain('registerForm.file = null; registerFileInputKey.value += 1')
    expect(page).toContain('<input :key="registerFileInputKey" type="file" required')
  })
})
