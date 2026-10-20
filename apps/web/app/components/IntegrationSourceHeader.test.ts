import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'IntegrationSourceHeader.vue'), 'utf8')

describe('IntegrationSourceHeader', () => {
  it('puts the checkbox back to the saved state until the toggle has been saved', () => {
    expect(component).toContain('@change="onToggle"')
    expect(component).toContain('(event.target as HTMLInputElement).checked = props.source.enabled')
  })
})
