import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'PhotoLayoutGallery.vue'), 'utf8')

describe('PhotoLayoutGallery', () => {
  it('keeps the compose error visible after an outdated review emptied the photo list', () => {
    const template = component.slice(component.indexOf('<template>'))
    const countGatedBlock = template.slice(template.indexOf('<div v-if="!loading && selectablePresets.length'), template.indexOf('<p v-else-if="!loading && loadError"'))

    expect(countGatedBlock).not.toContain('{{ error }}')
    expect(template).toContain('<p v-if="error" class="mt-2 text-[11px] text-amber-800">{{ error }}</p>')
  })
})
