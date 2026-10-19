import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'LegalAuditChain.vue'), 'utf8')

describe('LegalAuditChain', () => {
  it('discards verification and signing results of a previously selected club', () => {
    expect(component).toContain('isCurrentOrganization = organizationRuns.begin()')
    expect(component).toContain('if (isCurrent()) auditVerification.value = verification')
    expect(component).toContain('auditSignResult.value = null')
  })
})
