import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

// Oeffentliche, anmeldungsfreie Seiten: was aus Route oder Antwort in Pfade und Links gelangt.
describe('oeffentliche Seiten', () => {
  it('verlinkt die Widerrufsadresse erst nach Pruefung als http(s)-URL', () => {
    const page = readFileSync(join(PAGES_DIR, 'einwilligung/[token].vue'), 'utf8')

    // Vorher nur per Typ-Cast uebernommen und direkt in <a :href> gebunden.
    expect(page).not.toContain('$fetch<{ status: string; revocationUrl?: string }>')
    expect(page).toContain("revocationUrl: z.url({ protocol: /^https?$/ }).optional().catch(undefined)")
    expect(page).toContain('const response = RespondResponseSchema.parse(await $fetch<unknown>(')
  })

  it('setzt nur eine UUID als Verein in den serverseitigen Impressums-Abruf ein', () => {
    const page = readFileSync(join(PAGES_DIR, 'impressum/[organizationId].vue'), 'utf8')

    // Der rohe Routenparameter landete waehrend SSR im API-Pfad (Pfad-Traversal per ../ und ?).
    expect(page).not.toContain("typeof route.params.organizationId === 'string' ? route.params.organizationId : ''")
    expect(page).toContain('const parsedOrganizationId = UuidSchema.safeParse(route.params.organizationId)')
    expect(page).toContain("const organizationId = parsedOrganizationId.success ? parsedOrganizationId.data : ''")
    expect(page).toContain("if (!organizationId) return 'not-found'")
  })
})
