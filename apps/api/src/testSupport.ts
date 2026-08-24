// Gemeinsame Testklammer fuer die fachnahen API-Testdateien: Fakes, IDs und startApp().
import type { SupabaseClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'
import { afterEach, beforeAll } from 'vitest'
import { buildApp, type BuildAppOptions } from './app.js'

export { buildApp }
import type { PlatformAdminProvider, RoleProvider } from './auth.js'

export const TEST_JWT_SECRET = 'test-only-secret-at-least-32-characters-long'
export const USER_ID = '10000000-0000-4000-8000-000000000001'
export const ORGANIZATION_ID = '10000000-1000-4000-8000-000000000001'
export const DEPARTMENT_ID = '10000000-1100-4000-8000-000000000001'
export const TEAM_ID = '10000000-1200-4000-8000-000000000001'
export const INVITATION_ID = '10000000-2000-4000-8000-000000000001'
export const MEMBERSHIP_ID = '10000000-3000-4000-8000-000000000001'

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET))
}

export const grantingRoleProvider: RoleProvider = {
  async rolesForScope() {
    return ['editor']
  },
}

export const denyingRoleProvider: RoleProvider = {
  async rolesForScope() {
    return ['viewer']
  },
}

export const organizationManagerRoleProvider: RoleProvider = {
  async rolesForScope() {
    return ['organization_admin']
  },
}

// audit_events ist append-only und hat fuer authenticated keinen Insert-Grant -- die API schreibt
// den Trail deshalb ausschliesslich ueber den Service-Client. Die Fakes erwarten den Insert
// entsprechend dort; ein Rueckfall auf den Nutzer-Client laesst den betroffenen Test an
// "unexpected table in test fake: audit_events" scheitern.
export function serviceClientCapturingAudit(captured: Record<string, unknown>[]): SupabaseClient {
  return {
    // Account-Einladungen werden durch Supabase Auth selbst ueber den dort konfigurierten
    // Mail-Provider versendet. Der Standard-Fake ist erfolgreich; spezialisierte
    // Einladungs-Tests ersetzen ihn und pruefen Zieladresse sowie Redirect separat.
    auth: {
      admin: { inviteUserByEmail: async () => ({ data: { user: {} }, error: null }) },
      signInWithOtp: async () => ({ data: {}, error: null }),
    },
    from: (table: string) => {
      if (table === 'audit_events') {
        return { insert: async (row: Record<string, unknown>) => { captured.push(row); return { error: null } } }
      }
      throw new Error(`unexpected table in service test fake: ${table}`)
    },
  } as unknown as SupabaseClient
}

// Paket 025: POST /v1/submissions legt bei vollstaendigem Quellmaterial jetzt echt einen
// post/post_version an (Service Role, keine Insert-Policy fuer authenticated) -- dieser Fake
// deckt genau die Schreibfolge ab, die der Handler dafuer auslöst.
export function draftCreationServiceClient(
  ids: { postId?: string; postVersionId?: string } = {},
  captured: { versionRow?: Record<string, unknown> } = {},
): SupabaseClient {
  const postId = ids.postId ?? '20000000-0000-4000-8000-000000000001'
  const postVersionId = ids.postVersionId ?? '20000000-1000-4000-8000-000000000001'
  return {
    from: (table: string) => {
      if (table === 'posts') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: postId }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'post_versions') {
        return {
          insert: (row: Record<string, unknown>) => {
            captured.versionRow = row
            return { select: () => ({ single: async () => ({ data: { id: postVersionId }, error: null }) }) }
          },
        }
      }
      if (table === 'post_variants') return { insert: async () => ({ error: null }) }
      if (table === 'audit_events') return { insert: async () => ({ error: null }) }
      throw new Error(`unexpected table in service test fake: ${table}`)
    },
  } as unknown as SupabaseClient
}

// isAnyMemberOfOrganization (GET /v1/organizations/:id/policy-settings) queries all three
// membership tables in parallel with the same select().eq().eq().or().limit() chain -- this stub
// fakes that chain so policy-settings test fakes don't have to model it by hand each time.
export function membershipRowsStub(rows: { id: string }[]) {
  return { select: () => ({ eq: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) }) }
}

// Ein generischer Query-Builder-Stub fuer Paket 011: die Aufrufer verketten eq()/is()/in() in
// wechselnder Reihenfolge und schliessen entweder mit maybeSingle()/single() ab oder awaiten die
// Kette direkt (kein PostgREST-Query-Builder ist wirklich ein Promise, aber beide sind thenable).
// chain() bildet beides identisch nach, unabhaengig davon, welche Filter dazwischen aufgerufen wurden.
// Alle policy_settings-Regelfelder auf "geerbt" (null), damit ein Test nur das eine Feld ueberschreiben
// muss, das er tatsaechlich pruefen will (Paket 011). fetchPolicyRuleRows laedt alle Ebenen einer
// Organisation in EINER Abfrage -- eine Regelzeile im Fake traegt deshalb ihre Ebene selbst
// (scope/department_id/team_id), statt sich auf die weggelassenen Filter des Stubs zu verlassen.
export function emptyPolicyRuleColumns() {
  return {
    review_required: null, review_mode: null, review_stage_label: null, review_minimum_approvals: null, review_deadline_hours: null,
    minor_approval_required: null, self_approval_allowed: null, allow_same_reviewer_across_stages: null, allow_review_exemptions: null,
    media_requires_consent_check: null, allowed_presets: null, allowed_formats: null, allowed_channel_ids: null,
    forbidden_topics: [], required_hashtags: [], default_target_platforms: null,
  }
}

export function chain(result: { data: unknown; error: unknown; count?: number }): PromiseLike<{ data: unknown; error: unknown; count?: number }> & Record<string, unknown> {
  const builder: Record<string, unknown> = {
    eq: () => builder, is: () => builder, in: () => builder, or: () => builder, contains: () => builder, order: () => builder, limit: () => builder, range: () => builder, select: () => builder, filter: () => builder,
    // Paket 019 (GET .../content-suggestions) verkettet zusaetzlich neq()/gte()/lte()/not() --
    // dieselbe Ignorierhaltung wie bei eq()/is()/in() oben, das Ergebnis steht schon fest.
    neq: () => builder, gte: () => builder, lte: () => builder, not: () => builder, lt: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: { data: unknown; error: unknown; count?: number }) => unknown) => resolve(result),
  }
  return builder as PromiseLike<{ data: unknown; error: unknown; count?: number }> & Record<string, unknown>
}

// Eigene Funktionsgrenze, damit TS eine `let`-Variable, die innerhalb einer Fake-Closure
// zugewiesen wird, an der Leseseite nicht ueber alle Zuweisungen der ganzen Testfunktion hinweg
// auf `never` verengt.
export function readField(record: Record<string, unknown> | null, field: string): unknown {
  return record ? record[field] : undefined
}

// Die Grenzen, die eine hoehere Ebene setzt, liest die API bewusst ueber die Service Role: ob eine
// Sperre greift, darf nicht davon abhaengen, ob die Aufruferin das Vereinsprofil selbst lesen darf.
export function brandLimitsService(
  organization: { allow_department_overrides: boolean; locked_fields: string[] } | null,
  department: { allow_team_overrides: boolean; locked_fields: string[] } | null = null,
) {
  return () =>
    ({
      from: (table: string) => {
        if (table === 'organization_brand_profiles') return chain({ data: organization, error: null })
        if (table === 'department_brand_profiles') return chain({ data: department, error: null })
        throw new Error(`unexpected table in service fake: ${table}`)
      },
    }) as unknown as SupabaseClient
}

export const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET
  process.env.SECRET_BOX_KEYS = JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') })
  process.env.SECRET_BOX_CURRENT_KEY_VERSION = 'v1'
})

export const nonAdminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: false, isDefaultAdmin: false } } }
export const adminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: true, isDefaultAdmin: false } } }
export const defaultAdminProvider: PlatformAdminProvider = { async statusFor() { return { isPlatformAdmin: true, isDefaultAdmin: true } } }

export async function startApp(options: BuildAppOptions = {}) {
  const app = await buildApp({ logger: false, ...options })
  apps.push(app)
  return app
}
