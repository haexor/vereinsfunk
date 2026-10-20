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

    expect(before(load, 'if (!isLatest()) return', 'people.value = loaded')).toBe(true)
  })

  it('leert beim Abteilungswechsel im Bearbeiten-Formular das Team', () => {
    const page = read('verzeichnis.vue')
    const setter = page.match(/const editFormDepartmentIdModel = computed\(\{[\s\S]*?\n\}\)/)?.[0] ?? ''

    // Das alte Team passt nicht zur neuen Abteilung; der Fremdschluessel lehnte das Speichern ab.
    expect(setter).toContain("if (departmentId !== editForm.departmentId) editForm.teamId = ''")
  })

  it('verwirft nach einem Vereinswechsel spaete Antworten auf /mitglieder und /struktur', () => {
    const membersPage = read('mitglieder.vue')
    const members = membersPage.slice(membersPage.indexOf('useScopedLoad(() => organizationId.value'))
    expect(before(members, 'if (!isLatest()) return', 'members.value = membersResponse')).toBe(true)
    expect(members).toContain('/v1/organizations/${requestedOrganizationId}/policy-settings')
    expect(before(members.slice(members.indexOf('loadedPolicySettings')), 'if (!isLatest()) return', 'policySettings.value = loadedPolicySettings')).toBe(true)

    const structure = functionBody(read('struktur.vue'), 'load')
    expect(before(structure, 'if (!isLatest()) return', 'departments.value = parsedDepartments.data')).toBe(true)
  })

  it('prueft die Antwort einer Einladung mit dem Vertragsschema', () => {
    const page = read('mitglieder.vue')

    expect(page).not.toContain('api.request<{ emailDelivered')
    expect(page.match(/PlayerboardInviteResponseSchema\)/g)).toHaveLength(2)
  })

  it('sperrt auf /marke die Schriftwahl wie Logo und Farben', () => {
    const page = read('marke.vue')
    const fontSection = readFileSync(join(PAGES_DIR, '../components/BrandFontSection.vue'), 'utf8')

    // saveDepartment() laesst gesperrte Felder aus -- die Auswahl war nach dem Speichern still weg.
    expect(page).toContain(':locked="lockedForActiveLevel"')
    expect(fontSection).toContain(":disabled=\"locked.has('displayFontAssetId')\"")
    expect(fontSection).toContain(":disabled=\"locked.has('bodyFontAssetId')\"")
  })

  it('fuehrt auf /marke keine Mannschaftsebene, solange useActiveScope() sie nicht liefert', () => {
    const page = read('marke.vue')
    const activeScope = readFileSync(join(PAGES_DIR, '../composables/useActiveScope.ts'), 'utf8')

    expect(activeScope).toContain("departmentId.value ? 'department' : 'organization'")
    expect(page).not.toContain("activeLevel.value === 'team'")
    expect(page).not.toContain("activeLevel === 'team'")
    expect(readFileSync(join(PAGES_DIR, '../composables/useBrandPageData.ts'), 'utf8')).not.toContain('async function saveTeam')
  })

  it('frischt nach dem Speichern des Anzeigenamens die Sitzung auf', () => {
    const save = functionBody(read('profil.vue'), 'save')

    // Seitenleiste und Kopfzeile lesen den Namen aus useSession().
    expect(save).toContain('if (saveSuccess.value) await refreshSession()')
  })
})
