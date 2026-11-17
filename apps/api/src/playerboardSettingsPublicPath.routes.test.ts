import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@vereinsfunk/authorization'
import { describe, expect, it } from 'vitest'
import type { SupabaseClientFactory } from './app.js'
import { DEPARTMENT_ID, ORGANIZATION_ID, TEAM_ID, USER_ID, chain, signAccessToken, startApp } from './testSupport.js'

// GET /v1/organizations/:id/playerboard/settings liefert je Mannschaft die dreiteilige oeffentliche
// Adresse /mannschaft/{verein}/{abteilung}/{mannschaft} (ADR-014); Verein und Abteilung kommen aus
// der Struktur, das Mannschaftssegment aus der erzeugten, nicht editierbaren public_slug-Spalte.

const emptyLevel = {
  season_start: null, stats_visibility: null, overridable_fields: [], team_categories_allowed: null, public_sharing_allowed: null,
  public_trainings_enabled: null, public_points_enabled: null, public_veo_stats_enabled: null, public_photos_enabled: null,
  public_player_name_format: 'initials', public_slug: null,
}

function clients(options: { orgSlug?: string; departmentSlug?: string; teamSlug?: string | null; orgRowSlug?: string | null }): SupabaseClientFactory {
  const service = {
    from: (table: string) => {
      const rows: Record<string, unknown> = {
        organizations: { name: 'SV Beispiel', slug: options.orgSlug ?? 'sv-beispiel' },
        departments: [{ id: DEPARTMENT_ID, name: 'Fussball', slug: options.departmentSlug ?? 'fussball' }],
        teams: [{ id: TEAM_ID, name: 'U13', department_id: DEPARTMENT_ID }],
        playerboard_settings: [
          { scope: 'organization', department_id: null, team_id: null, ...emptyLevel, public_slug: options.orgRowSlug ?? null },
          { scope: 'team', department_id: DEPARTMENT_ID, team_id: TEAM_ID, ...emptyLevel, public_slug: options.teamSlug === undefined ? 'u13' : options.teamSlug },
        ],
      }
      if (!(table in rows)) throw new Error(`unexpected service table in test fake: ${table}`)
      return chain({ data: rows[table], error: null })
    },
  } as unknown as SupabaseClient
  const user = { from: () => chain({ data: [{ id: 'membership' }], error: null }) } as unknown as SupabaseClient
  return { forUser: () => user, forService: () => service }
}

async function publicPaths(options: Parameters<typeof clients>[0]) {
  const roles: Role[] = ['team_manager']
  const app = await startApp({ roleProvider: { async rolesForScope() { return roles } }, supabaseClients: clients(options) })
  const token = await signAccessToken(USER_ID)
  const response = await app.inject({ method: 'GET', url: `/v1/organizations/${ORGANIZATION_ID}/playerboard/settings`, headers: { authorization: `Bearer ${token}` } })
  expect(response.statusCode).toBe(200)
  return (response.json() as { scope: string; publicPath: string | null; own: { publicSlug: string | null } }[])
}

describe('PlayerBoard settings public path', () => {
  it('builds the three-segment path from club, department and team segment', async () => {
    const entries = await publicPaths({})
    const team = entries.find((entry) => entry.scope === 'team')!
    expect(team.publicPath).toBe('/mannschaft/sv-beispiel/fussball/u13')
    expect(team.own.publicSlug).toBe('u13')
  })

  it('has no path without a team slug', async () => {
    const entries = await publicPaths({ teamSlug: null })
    expect(entries.find((entry) => entry.scope === 'team')!.publicPath).toBeNull()
  })

  it('has no path for club and department entries, even when a slug is stored', async () => {
    const entries = await publicPaths({ orgRowSlug: 'u13' })
    expect(entries.filter((entry) => entry.scope !== 'team').map((entry) => entry.publicPath)).toEqual([null, null])
  })

  it.each([
    ['club slug that the page would reject', { orgSlug: 'SV Beispiel' }],
    ['department slug that the page would reject', { departmentSlug: 'Fuss ball' }],
    ['club slug of 201 characters', { orgSlug: 'a'.repeat(201) }],
    ['department slug of 201 characters', { departmentSlug: 'a'.repeat(201) }],
  ])('has no path for a %s', async (_name, options) => {
    const entries = await publicPaths(options)
    expect(entries.find((entry) => entry.scope === 'team')!.publicPath).toBeNull()
  })

  it('does not let the settings request set the generated team segment', async () => {
    const roles: Role[] = ['team_manager']
    const app = await startApp({ roleProvider: { async rolesForScope() { return roles } }, supabaseClients: clients({}) })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PUT', url: '/v1/playerboard/settings', headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'team', scopeId: TEAM_ID, patch: { publicSlug: 'frei-gewaehlt' } },
    })
    expect(response.statusCode).toBe(400)
  })
})
