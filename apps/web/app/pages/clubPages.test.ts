import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

function read(page: string): string {
  return readFileSync(join(PAGES_DIR, page), 'utf8')
}

function functionBody(source: string, name: string): string {
  return source.match(new RegExp(`async function ${name}\\([^)]*\\)[\\s\\S]*?\\n}`))?.[0] ?? ''
}

function before(source: string, first: string, second: string): boolean {
  const firstIndex = source.indexOf(first)
  return firstIndex > -1 && firstIndex < source.indexOf(second)
}

// Lade-, Reihenfolge- und Formularfragen der Vereinsseiten, die sich nur im Quelltext festhalten
// lassen -- dieselbe Bauart wie targetPlatformDefaults.test.ts.
describe('Vereinsseiten', () => {
  it('verwirft im Verzeichnis spaete Antworten frueherer Filter', () => {
    const load = functionBody(read('verzeichnis.vue'), 'loadPeople')

    expect(before(load, 'if (loadRun !== latestPeopleLoad) return', 'people.value = DirectoryPersonSchema.array().parse(response)')).toBe(true)
  })

  it('verwirft nach einem Vereinswechsel spaete Antworten auf /mitglieder und /struktur', () => {
    const members = functionBody(read('mitglieder.vue'), 'load')
    expect(before(members, 'if (loadRun !== latestLoadRun) return', 'members.value = membersResponse')).toBe(true)
    expect(members).toContain('/v1/organizations/${requestedOrganizationId}/policy-settings')
    expect(before(members.slice(members.indexOf('loadedPolicySettings')), 'if (loadRun !== latestLoadRun) return', 'policySettings.value = loadedPolicySettings')).toBe(true)

    const structure = functionBody(read('struktur.vue'), 'load')
    expect(before(structure, 'if (loadRun !== latestLoadRun) return', 'departments.value = parsedDepartments.data')).toBe(true)
  })
})
