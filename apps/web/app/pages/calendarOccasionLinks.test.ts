import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(import.meta.dirname, 'kalender.vue'), 'utf8')

describe('Kalender', () => {
  it('zaehlt Beitraege aus der Textwerkstatt und verlinkt auch Veranstaltungen zur Erstellung', () => {
    // Vorher sah der Kalender nur Beitraege aus /v1/submissions und bot Veranstaltungen gar nicht an.
    expect(page).toContain(".from('composition_sessions').select(column).eq('organization_id', organizationId).not('post_id', 'is', null).in(column, ids)")
    expect(page).toContain(':to="`/erstellen?clubEventId=${event.id}`"')
    expect(page).toContain('v-if="canCreatePost && !event.hasSubmission"')
  })
})
