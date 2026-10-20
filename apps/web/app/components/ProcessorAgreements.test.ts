import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'ProcessorAgreements.vue'), 'utf8')

describe('ProcessorAgreements', () => {
  it('reloads per club and drops late answers of the previous club', () => {
    expect(component).toContain('useScopedLoad(() => props.organizationId')
    expect(component).toContain('if (isLatest()) agreements.value = loaded')
    expect(component).toContain('if (props.organizationId !== organizationId) return')
  })

  it('clears the file input together with the form state', () => {
    expect(component).toContain('ref="fileInput"')
    expect(component).toContain("if (fileInput.value) fileInput.value.value = ''")
  })
})
