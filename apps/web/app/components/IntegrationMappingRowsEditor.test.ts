import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8')

describe('IntegrationMappingRowsEditor', () => {
  it('keys removable rows by row identity instead of their index', () => {
    const editor = read('IntegrationMappingRowsEditor.vue')
    expect(editor).toContain(':key="keyOf(row)"')
    expect(editor).not.toContain(':key="index"')
  })

  it('is the only mapping row markup of the create and edit forms', () => {
    for (const form of ['IntegrationSourceCreateForm.vue', 'IntegrationSourceEditForm.vue']) {
      const source = read(form)
      expect(source).toContain('<IntegrationMappingRowsEditor v-model="mappingRows"')
      expect(source).not.toContain('setRowField')
    }
  })
})
