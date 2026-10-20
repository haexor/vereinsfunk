import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

describe('Assistent-Unterhaltungen', () => {
  it('nimmt beim Seitenaufruf eine noch unbenutzte Unterhaltung wieder auf, statt eine neue anzulegen', () => {
    const page = readFileSync(join(PAGES_DIR, 'assistent.vue'), 'utf8')

    // Der useState-Cache ueberlebt keinen vollen Seitenaufruf -- jeder Aufruf legte bisher eine
    // weitere leere Unterhaltung an, die als leerer Eintrag im Verlauf stehen blieb.
    expect(page).toContain('const unusedConversation = loadedConversations.find((entry) => entry.lastActivityAt === entry.createdAt)')
    expect(page).toContain("const createdConversation = unusedConversation ?? await api.request('/v1/agent/conversations', { method: 'POST', body: input }, AgentConversationSchema)")
    expect(page).toContain('if (!unusedConversation) conversations.value = [createdConversation, ...conversations.value]')
  })
})
