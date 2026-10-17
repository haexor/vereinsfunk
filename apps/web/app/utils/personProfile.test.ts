import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { personProfilePath } from './personProfile'

const PERSON_ID = '58000000-1000-4000-8000-000000000001'

describe('personProfilePath', () => {
  it('points at the club-level profile page of the person', () => {
    expect(personProfilePath(PERSON_ID)).toBe(`/personen/${PERSON_ID}`)
  })

  it('returns no path without a person, so the name stays plain text', () => {
    expect(personProfilePath(null)).toBeNull()
    expect(personProfilePath(undefined)).toBeNull()
    expect(personProfilePath('')).toBeNull()
  })

  it('encodes the id so it can never form another path', () => {
    expect(personProfilePath('../einstellungen?x=1')).toBe('/personen/..%2Feinstellungen%3Fx%3D1')
  })
})

// Das Web-Paket mountet keine Komponenten (kein DOM-Werkzeug); wie in appPageLayout.test.ts prueft
// ein Quelltext-Test, dass PersonLink die Entscheidung der Funktion umsetzt statt eines eigenen Pfads.
describe('PersonLink', () => {
  const source = readFileSync(join(import.meta.dirname, '../components/PersonLink.vue'), 'utf8')

  it('renders a link only when a path exists and plain text otherwise', () => {
    expect(source).toContain('personProfilePath(props.personId)')
    expect(source).toContain('<NuxtLink v-if="path"')
    expect(source).toContain('<span v-else>')
  })

  it('opens the profile in the same tab', () => {
    expect(source).not.toContain('target=')
  })
})
