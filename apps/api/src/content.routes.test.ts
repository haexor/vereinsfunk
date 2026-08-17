import { ContentGenerationError } from '@vereinsfunk/content-engine'
import { createSecretBox } from '@vereinsfunk/secrets'
import { describe, expect, it } from 'vitest'
import { ciphertextToBytea } from './secretBox.js'
import { chain, DEPARTMENT_ID, denyingRoleProvider, emptyPolicyRuleColumns, grantingRoleProvider, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'
import type { PermissionScope, RoleProvider } from './auth.js'

// Ein aktiver, organisationsweiter Kanal je Plattform -- die Sitzungs-Anlage lehnt seit Plan 042,
// PR 3 Step 3 jede Plattform ohne einen solchen Kanal mit 422 ab. Von jedem Test wiederverwendet,
// der lediglich "ein Kanal existiert" braucht, nicht die Verfuegbarkeitspruefung selbst testet.
const AVAILABLE_CHANNEL_FIXTURES = {
  socialConnections: [
    { id: 'channel-instagram', platform: 'instagram', status: 'active', archived_at: null, responsible_profile_id: null },
    { id: 'channel-facebook', platform: 'facebook', status: 'active', archived_at: null, responsible_profile_id: null },
  ],
  channelScopes: [
    { social_connection_id: 'channel-instagram', scope: 'organization', department_id: null, team_id: null, can_schedule: true },
    { social_connection_id: 'channel-facebook', scope: 'organization', department_id: null, team_id: null, can_schedule: true },
  ],
}

// policy_settings wird auf zwei Arten gelesen: fetchPolicyRuleRows holt alle Regelzeilen einer
// Organisation (Array, direkt awaited), resolveTextGenerationPlatformAvailability nur das
// vereinsweite require_channel_responsible (Objekt, per maybeSingle). chain() liefert fuer beide
// Abschluesse dieselbe Nutzlast -- ohne diese Unterscheidung laeuft jeder Test mit
// require_channel_responsible = false, egal was seine Vorrichtung behauptet.
function policySettingsFake(options: { ruleRows?: unknown[]; requireChannelResponsible?: boolean } = {}) {
  return {
    select: (columns: string) => columns === 'require_channel_responsible'
      ? chain({ data: { require_channel_responsible: options.requireChannelResponsible ?? false }, error: null })
      : chain({ data: options.ruleRows ?? [], error: null }),
  }
}

const STYLE_RULES = { toneTags: ['direkt', 'anfeuernd'], catchphrases: [], examples: [], additionalInstructions: '' }
const PERSONA_ROW = { id: '3b000000-0000-4000-8000-000000000001', slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.', style_rules: STYLE_RULES, avoid_rules: ['Ironie'], do_rules: [] }
const PROFILE_ID = '3e000000-0000-4000-8000-000000000001'
const PROFILE_ROW = {
  id: PROFILE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null,
  slug: 'unser-ton', name: 'Unser Ton', description: 'Warm.', style_rules: STYLE_RULES, avoid_rules: [], do_rules: [],
  is_active: true, created_by: USER_ID, created_at: '2026-08-13T10:00:00+00:00', updated_at: '2026-08-13T10:00:00+00:00',
}

function customStyleProfileService(options: {
  existingRow?: Record<string, unknown> | null
  updatedRow?: Record<string, unknown> | null
  onDelete?: () => void
  // Der Fake gab die Update-Nutzlast frueher unbesehen weg -- eine vertauschte Zuordnung
  // (do_rules aus avoidRules) waere unbemerkt durchgelaufen. Deshalb wird sie festgehalten.
  onUpdate?: (payload: Record<string, unknown>) => void
  auditRows?: Record<string, unknown>[]
} = {}): SupabaseClient {
  const existingRow = 'existingRow' in options ? options.existingRow! : PROFILE_ROW
  return {
    from: (table: string) => {
      if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { options.auditRows?.push(row); return { error: null } } }
      if (table !== 'content_style_profiles') throw new Error(`unexpected table in test fake: ${table}`)
      return {
        select: () => chain({ data: existingRow, error: null }),
        update: (payload: Record<string, unknown>) => {
          options.onUpdate?.(payload)
          return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: options.updatedRow ?? null, error: null }) }) }) }
        },
        delete: () => ({ eq: async () => { options.onDelete?.(); return { error: null } } }),
      }
    },
  } as unknown as SupabaseClient
}

// resolveDirectoryScope prueft die departmentId/teamId der Anfrage ueber den Nutzer-Client gegen
// ihre echte organization_id, bevor irgendeine Berechtigung geprueft wird.
function scopeResolvingUserClient(department: { organization_id: string } | null = { organization_id: ORGANIZATION_ID }): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== 'departments') throw new Error(`unexpected table in test fake: ${table}`)
      return chain({ data: department, error: null })
    },
  } as unknown as SupabaseClient
}

const PROVIDER_ID = '3e100000-0000-4000-8000-000000000001'
const PREVIEW_PAYLOAD = { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, name: 'Unser Ton', description: 'Warm.', styleRules: STYLE_RULES, avoidRules: [], doRules: [], sampleInput: '3:1 Sieg im Lokalderby' }
const FAKE_GENERATED_POST = {
  verifiedFacts: ['3:1 Sieg im Lokalderby'], missingFacts: [], headline: '3:1 gewonnen!', caption: '3:1 gewonnen!', shortCaption: '3:1 gewonnen!',
  callToAction: 'Jetzt lesen', hashtags: ['#verein'], altText: 'Vereinsmotiv', templateId: 'preview-v1', safetyFlags: [],
  generatedClaims: [{ sourceId: 'sample', text: '3:1 Sieg im Lokalderby' }], variants: [],
}

// Same DB row shape apps/worker/src/context.ts's loadActiveTextProvider reads, sealed with the
// SECRET_BOX_KEYS testSupport.ts sets for every test (beforeAll) -- previewStyleProfile decrypts
// this exactly like the worker decrypts a real provider's secret.
function activeTextProviderService(rows: Record<string, unknown>[] | null = null): SupabaseClient {
  const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('sk-test-key', PROVIDER_ID)
  const defaultRow = {
    id: PROVIDER_ID, protocol: 'openai', base_url: 'https://provider.example.test/v1', model: 'gpt-test',
    structured_output_required: true, priority: 1,
    llm_provider_secrets: { api_key_ciphertext: ciphertextToBytea(sealed.ciphertext), key_version: 'v1' },
  }
  return {
    from: (table: string) => {
      if (table !== 'llm_provider_configurations') throw new Error(`unexpected table in test fake: ${table}`)
      return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: rows ?? [defaultRow], error: null }) }) }) }) }) }
    },
  } as unknown as SupabaseClient
}

describe('GET /v1/content-style-profiles', () => {
  it('merges hardcoded system modes, platform personas, and custom club profiles with the correct kind', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'content_style_profiles') return chain({ data: [{ id: 'c0000000-0000-4000-8000-000000000001', slug: 'unser-ton', name: 'Unser Ton', description: 'Warm.', style_rules: STYLE_RULES, avoid_rules: [], do_rules: [], is_active: true }], error: null })
            if (table === 'platform_style_personas') return chain({ data: [PERSONA_ROW], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/content-style-profiles',
      headers: { authorization: `Bearer ${token}` },
      query: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID },
    })
    expect(response.statusCode).toBe(200)
    const { profiles } = response.json()
    expect(profiles.filter((p: { kind: string }) => p.kind === 'system')).toHaveLength(5)
    expect(profiles).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'persona', slug: 'kapitaen-klar', name: 'Kapitän Klar' })]))
    expect(profiles).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'custom', slug: 'unser-ton' })]))
  })
})

describe('POST /v1/text-workshop/sessions', () => {
  // Plan 044, PR 1 Step 1: targetPlatforms hat keinen Schema-Vorgabewert mehr -- das Fixture setzt
  // beide Plattformen deshalb explizit, damit die uebrigen Faelle unten unveraendert bleiben.
  const basePayload = {
    organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
    requestedFormats: ['text_post'], sourceMaterial: { facts: { title: 'Training' }, observations: [], quotes: [], doNotMention: [] },
    targetPlatforms: ['instagram', 'facebook'],
  }

  it('resolves an active persona by slug into the style snapshot', async () => {
    let capturedRpcParams: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'platform_style_personas') return chain({ data: PERSONA_ROW, error: null })
            if (table === 'social_connections') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.socialConnections, error: null })
            if (table === 'channel_scopes') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.channelScopes, error: null })
            // basePayload setzt beide Plattformen explizit, die Route liest die Vorgaben also bei
            // jeder Sitzungsanlage ohne expliziten maxCharacters-Wert.
            if (table === 'text_generation_platform_defaults') return chain({ data: [{ platform: 'instagram', max_characters: 2200 }, { platform: 'facebook', max_characters: 2200 }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (_name: string, params: Record<string, unknown>) => {
            capturedRpcParams = params
            return { data: { sessionId: '3c000000-0000-4000-8000-000000000001', candidateId: '3c000000-0000-4000-8000-000000000002' }, error: null }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/text-workshop/sessions', headers: { authorization: `Bearer ${token}` },
      payload: { ...basePayload, personaSlug: 'kapitaen-klar' },
    })
    expect(response.statusCode).toBe(202)
    expect(capturedRpcParams?.p_style_profile_id).toBeNull()
    expect(capturedRpcParams?.p_style_profile_snapshot).toMatchObject({ name: 'Kapitän Klar', slug: 'kapitaen-klar' })
  })

  it('returns 404 for an unknown or inactive persona slug', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'platform_style_personas') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called once persona resolution fails') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/text-workshop/sessions', headers: { authorization: `Bearer ${token}` },
      payload: { ...basePayload, personaSlug: 'unknown-persona' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'persona_not_found' })
  })

  // Paket 042: max_characters wird bei Anlage EINMAL aufgeloest und danach eingefroren --
  // Sitzungs-Override > kleinste Vorgabe der gewaehlten Plattformen > generischer Fallback. Ein
  // vertauschter Vorrang oder ein max() statt min() waere ohne diese Faelle nirgends sichtbar.
  function sessionCreatingClients(options: { platformDefaults?: Record<string, number>; onRpc?: (params: Record<string, unknown>) => void }): SupabaseClientFactory {
    return {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'social_connections') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.socialConnections, error: null })
            if (table === 'channel_scopes') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.channelScopes, error: null })
            // Ein Platzhalter, dem eine Vorgabezeile fehlt, faellt auf TEXT_GENERATION_DEFAULT_MAX_CHARACTERS
            // zurueck (siehe resolveTextGenerationPlatformAvailability) -- fuer den min()-Nachweis reicht es,
            // wenn jeder Fall genau die Vorgaben mitbringt, die er pruefen will.
            if (table === 'text_generation_platform_defaults') return chain({ data: Object.entries(options.platformDefaults ?? {}).map(([platform, characters]) => ({ platform, max_characters: characters })), error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () =>
        ({
          rpc: async (_name: string, params: Record<string, unknown>) => {
            options.onRpc?.(params)
            return { data: { sessionId: '3c000000-0000-4000-8000-000000000001', candidateId: '3c000000-0000-4000-8000-000000000002' }, error: null }
          },
        }) as unknown as SupabaseClient,
    }
  }

  async function createSession(clients: SupabaseClientFactory, payload: Record<string, unknown>) {
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    return app.inject({ method: 'POST', url: '/v1/text-workshop/sessions', headers: { authorization: `Bearer ${token}` }, payload })
  }

  it('resolves max_characters from the request override, then the platform default, then the fallback', async () => {
    let override: Record<string, unknown> | undefined
    expect((await createSession(sessionCreatingClients({ platformDefaults: { instagram: 800 }, onRpc: (params) => { override = params } }), { ...basePayload, targetPlatforms: ['instagram'], maxCharacters: 300 })).statusCode).toBe(202)
    expect(override?.p_max_characters).toBe(300)

    let single: Record<string, unknown> | undefined
    expect((await createSession(sessionCreatingClients({ platformDefaults: { instagram: 800 }, onRpc: (params) => { single = params } }), { ...basePayload, targetPlatforms: ['instagram'] })).statusCode).toBe(202)
    expect(single?.p_max_characters).toBe(800)
    expect(single?.p_target_platforms).toEqual(['instagram'])

    // Fehlt fuer eine gewaehlte Plattform die Vorgabezeile, faellt die Route auf den generischen
    // Wert zurueck statt die Laenge unbemerkt hochzusetzen.
    let fallback: Record<string, unknown> | undefined
    expect((await createSession(sessionCreatingClients({ onRpc: (params) => { fallback = params } }), basePayload)).statusCode).toBe(202)
    expect(fallback?.p_max_characters).toBe(2200)
    expect(fallback?.p_temperature).toBe(0.6)
    // basePayload traegt beide Plattformen, sortiert an den RPC uebergeben.
    expect(fallback?.p_target_platforms).toEqual(['facebook', 'instagram'])

    // ... und umgekehrt darf eine fehlende Zeile die ausdrueckliche Vorgabe einer anderen Plattform
    // nicht auf den generischen Wert herunterziehen: sie zaehlt in der min()-Bildung gar nicht mit.
    let mixed: Record<string, unknown> | undefined
    expect((await createSession(sessionCreatingClients({ platformDefaults: { instagram: 3000 }, onRpc: (params) => { mixed = params } }), basePayload)).statusCode).toBe(202)
    expect(mixed?.p_max_characters).toBe(3000)
  })

  // Der Kern der Mehrfachauswahl: ein Text fuer mehrere Plattformen richtet sich nach der
  // knappsten Vorgabe. Ein max() oder "erste Wahl gewinnt" wuerde einen Text erzeugen, der auf der
  // engeren Plattform nicht passt.
  it('takes the most restrictive platform default when several platforms are selected', async () => {
    let captured: Record<string, unknown> | undefined
    expect((await createSession(
      sessionCreatingClients({ platformDefaults: { instagram: 900, facebook: 1600 }, onRpc: (params) => { captured = params } }),
      { ...basePayload, targetPlatforms: ['facebook', 'instagram'] },
    )).statusCode).toBe(202)
    expect(captured?.p_max_characters).toBe(900)
    expect(captured?.p_target_platforms).toEqual(['facebook', 'instagram'])
  })

  // Der RPC gibt fuer einen bereits bekannten input_hash die vorhandene Sitzung samt Kandidat
  // zurueck und ignoriert die uebergebenen Laufzeitwerte. Waeren die Regler-Stufe und die
  // Zielplattformen nicht im Hash, wuerde ein zweites Absenden mit anderer Stufe stillschweigend den
  // alten Kandidaten liefern -- die neue Stufe waere nirgends gespeichert.
  it('gives a session a distinct input hash per temperature step and platform selection', async () => {
    const hashes = new Set<string>()
    for (const extra of [{}, { temperature: 1.0 }, { temperature: 0.3 }, { targetPlatforms: ['instagram'] }, { targetPlatforms: ['facebook'] }, { targetPlatforms: ['facebook'], maxCharacters: 300 }]) {
      const response = await createSession(
        sessionCreatingClients({ platformDefaults: { instagram: 800, facebook: 800 }, onRpc: (params) => { hashes.add(params.p_input_hash as string) } }),
        { ...basePayload, ...extra },
      )
      expect(response.statusCode).toBe(202)
    }
    expect(hashes.size).toBe(6)
  })

  // Plan 042, PR 3 Step 3: die Anzeige in erstellen.vue ist Bequemlichkeit, diese Pruefung ist die
  // Regel -- ein Beitrag darf nicht fuer eine Plattform entstehen, auf die der Scope gar nicht
  // veroeffentlichen kann.
  it('rejects a target platform without an eingerichteten channel with 422', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return policySettingsFake()
            // Nur Instagram hat einen Kanal -- Facebook fehlt komplett.
            if (table === 'social_connections') return chain({ data: [AVAILABLE_CHANNEL_FIXTURES.socialConnections[0]], error: null })
            if (table === 'channel_scopes') return chain({ data: [AVAILABLE_CHANNEL_FIXTURES.channelScopes[0]], error: null })
            if (table === 'text_generation_platform_defaults') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called once a target platform is unavailable') },
    }
    const response = await createSession(clients, { ...basePayload, targetPlatforms: ['instagram', 'facebook'] })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'platform_not_available', platform: 'facebook' })
  })
})

// Wiedereinstieg aus der Beitraege-Liste (Textwerkstatt fuer einen draft_ready/changes_requested-
// Beitrag erneut oeffnen): anders als /v1/text-workshop/sessions/:id ist hier nur die posts-Zeile
// bekannt, nicht die composition_session-ID.
describe('GET /v1/text-workshop/sessions', () => {
  const POST_ID = '3d000000-0000-4000-8000-000000000001'
  const SESSION_ROW = {
    id: '3c000000-0000-4000-8000-000000000001', organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null,
    status: 'accepted', preset_slug: 'training_insight', communication_goal: 'inform',
    source_material: { facts: { title: 'Training' }, observations: [], quotes: [], doNotMention: [] },
    style_profile_id: null,
    style_profile_snapshot: { name: 'Klar erklärend', description: 'Sachlich.', styleRules: STYLE_RULES, avoidRules: [], doRules: [], slug: 'klar_erklaerend' },
    target_platforms: ['instagram'], max_characters: 2200, temperature: 0.6, created_at: '2026-08-09T10:00:00+00:00',
  }
  const CANDIDATE_ROW = {
    id: '3c000000-0000-4000-8000-000000000002', status: 'accepted', generated_content: FAKE_GENERATED_POST,
    quality_flags: [], failure_code: null, triggered_by: 'member', accepted_post_version_id: '3c000000-0000-4000-8000-000000000003',
    created_at: '2026-08-09T10:05:00+00:00',
  }

  it('resumes a draft by post id, returning its session and latest candidate', async () => {
    const olderCandidate = { ...CANDIDATE_ROW, id: '3c000000-0000-4000-8000-000000000004', status: 'ready', created_at: '2026-08-09T10:04:00+00:00' }
    let candidateLimit: number | undefined
    const candidateQuery = {
      select: () => candidateQuery,
      eq: () => candidateQuery,
      order: () => candidateQuery,
      limit: async (value: number) => {
        candidateLimit = value
        return { data: [CANDIDATE_ROW, olderCandidate].slice(0, value), error: null }
      },
    }
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'composition_sessions') return chain({ data: SESSION_ROW, error: null })
            if (table === 'generation_candidates') return candidateQuery
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-workshop/sessions', headers: { authorization: `Bearer ${token}` }, query: { postId: POST_ID } })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.session).toMatchObject({ id: SESSION_ROW.id, preset_slug: 'training_insight', target_platforms: ['instagram'] })
    expect(body.candidates).toHaveLength(1)
    expect(body.candidates[0]).toMatchObject({ id: CANDIDATE_ROW.id, status: 'accepted' })
    expect(candidateLimit).toBe(1)
  })

  it('returns 404 when no composition session is linked to the post', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'composition_sessions') return chain({ data: null, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-workshop/sessions', headers: { authorization: `Bearer ${token}` }, query: { postId: POST_ID } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'session_not_found' })
  })

  it('rejects a member without post.create in the session scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'composition_sessions') return chain({ data: SESSION_ROW, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-workshop/sessions', headers: { authorization: `Bearer ${token}` }, query: { postId: POST_ID } })
    expect(response.statusCode).toBe(403)
  })
})

describe('GET /v1/text-generation-platforms', () => {
  const query = { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID }

  it('reports available: true with the platform default once a channel and no restriction exist', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'social_connections') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.socialConnections, error: null })
            if (table === 'channel_scopes') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.channelScopes, error: null })
            if (table === 'text_generation_platform_defaults') return chain({ data: [{ platform: 'instagram', max_characters: 2200 }, { platform: 'facebook', max_characters: 1500 }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'instagram', available: true, maxCharacters: 2200, isDefault: false },
      { platform: 'facebook', available: true, maxCharacters: 1500, isDefault: false },
    ]))
  })

  it('reports reason: no_channel when no social connection exists for a platform', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'social_connections') return chain({ data: [AVAILABLE_CHANNEL_FIXTURES.socialConnections[0]], error: null })
            if (table === 'channel_scopes') return chain({ data: [AVAILABLE_CHANNEL_FIXTURES.channelScopes[0]], error: null })
            if (table === 'text_generation_platform_defaults') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'instagram', available: true, maxCharacters: 2200, isDefault: false },
      { platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'no_channel' },
    ]))
  })

  // Unterscheidet "kein Kanal eingerichtet" von "ein Kanal existiert, ist aber per Richtlinie
  // ausgeschlossen" -- beides fuehrt sonst ununterscheidbar zu "nicht verfuegbar".
  it('reports reason: restricted_by_policy when a channel exists but allowedChannelIds excludes it', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') {
              return policySettingsFake({
                ruleRows: [{
                  id: 'policy-row-1', scope: 'organization', department_id: null, team_id: null,
                  submit_requires_permission: null, review_required: null, review_mode: null, review_stage_label: null, review_minimum_approvals: null, review_deadline_hours: null,
                  minor_approval_required: null, self_approval_allowed: null, allow_same_reviewer_across_stages: null, allow_review_exemptions: null, media_requires_consent_check: null,
                  allowed_presets: null, allowed_formats: null, allowed_channel_ids: ['channel-instagram'], forbidden_topics: [], required_hashtags: [],
                  consent_expires_on_leave: null, consent_validity_months: null,
                }],
              })
            }
            if (table === 'social_connections') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.socialConnections, error: null })
            if (table === 'channel_scopes') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.channelScopes, error: null })
            if (table === 'text_generation_platform_defaults') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'instagram', available: true, maxCharacters: 2200, isDefault: false },
      { platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'restricted_by_policy' },
    ]))
  })

  // require_channel_responsible ist ebenfalls eine Richtlinie: ein vorhandener Kanal ohne
  // eingetragene verantwortliche Person darf nicht als "kein Kanal eingerichtet" gemeldet werden,
  // sonst legt der Verein einen zweiten Kanal an, statt die Person einzutragen.
  it('reports reason: restricted_by_policy when a channel exists but has no responsible person', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') return policySettingsFake({ requireChannelResponsible: true })
            if (table === 'social_connections') return chain({ data: [{ ...AVAILABLE_CHANNEL_FIXTURES.socialConnections[0], responsible_profile_id: 'profile-1' }, AVAILABLE_CHANNEL_FIXTURES.socialConnections[1]], error: null })
            if (table === 'channel_scopes') return chain({ data: AVAILABLE_CHANNEL_FIXTURES.channelScopes, error: null })
            if (table === 'text_generation_platform_defaults') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'instagram', available: true, maxCharacters: 2200, isDefault: false },
      { platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'restricted_by_policy' },
    ]))
  })

  // Plan 044, PR 1 Step 3: die Vorgabe wird mit der Verfuegbarkeit geschnitten -- eine Plattform in
  // der Vorgabe ohne eingerichteten Kanal ist nicht isDefault, sonst liefe erstellen.vue
  // vorausgewaehlt in ein 422.
  it('reports isDefault only for a platform that is both in the default and actually available', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') {
              return policySettingsFake({
                ruleRows: [{
                  id: 'policy-row-1', scope: 'organization', department_id: null, team_id: null,
                  ...emptyPolicyRuleColumns(), default_target_platforms: ['instagram', 'facebook'],
                }],
              })
            }
            // Nur Instagram hat einen Kanal -- Facebook fehlt komplett.
            if (table === 'social_connections') return chain({ data: [AVAILABLE_CHANNEL_FIXTURES.socialConnections[0]], error: null })
            if (table === 'channel_scopes') return chain({ data: [AVAILABLE_CHANNEL_FIXTURES.channelScopes[0]], error: null })
            if (table === 'text_generation_platform_defaults') return chain({ data: [], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'instagram', available: true, maxCharacters: 2200, isDefault: true },
      { platform: 'facebook', available: false, maxCharacters: 2200, isDefault: false, reason: 'no_channel' },
    ]))
  })

  // Plan 039, PR 1 Step 3: die Laengengrenze je Kanal geht in dieselbe Minimumbildung ein wie die
  // globale Plattform-Vorgabe -- ein Text soll auf jedem verfuegbaren Kanal derselben Plattform
  // erscheinen koennen, also gibt der knappste Kanal den Rahmen vor.
  it('resolves maxCharacters as the minimum across two available channels of the same platform, each with its own limit', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'social_connections') return chain({
              data: [
                { id: 'channel-website-a', platform: 'website', status: 'active', archived_at: null, responsible_profile_id: null, max_characters: 3000 },
                { id: 'channel-website-b', platform: 'website', status: 'active', archived_at: null, responsible_profile_id: null, max_characters: 1500 },
              ], error: null,
            })
            if (table === 'channel_scopes') return chain({
              data: [
                { social_connection_id: 'channel-website-a', scope: 'organization', department_id: null, team_id: null, can_schedule: true },
                { social_connection_id: 'channel-website-b', scope: 'organization', department_id: null, team_id: null, can_schedule: true },
              ], error: null,
            })
            if (table === 'text_generation_platform_defaults') return chain({ data: [{ platform: 'website', max_characters: 5000 }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'website', available: true, maxCharacters: 1500, isDefault: false },
    ]))
  })

  // Ein Kanal ohne eigenen Wert faellt nicht aus der min() heraus, nur weil er selbst null traegt --
  // er geht mit der globalen Plattform-Vorgabe als seinem eigenen Kandidaten in dieselbe Bildung
  // ein. Sonst zoege eine hoeher gesetzte Vorgabe (hier 5000) faelschlich auf den Wert eines
  // GROSSZUEGIGEREN Kanals (6000) herauf.
  it('a channel without its own override contributes the platform default to the minimum, not the higher sibling limit', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'departments') return chain({ data: { organization_id: ORGANIZATION_ID }, error: null })
            if (table === 'policy_settings') return policySettingsFake()
            if (table === 'social_connections') return chain({
              data: [
                { id: 'channel-website-a', platform: 'website', status: 'active', archived_at: null, responsible_profile_id: null, max_characters: 6000 },
                { id: 'channel-website-b', platform: 'website', status: 'active', archived_at: null, responsible_profile_id: null, max_characters: null },
              ], error: null,
            })
            if (table === 'channel_scopes') return chain({
              data: [
                { social_connection_id: 'channel-website-a', scope: 'organization', department_id: null, team_id: null, can_schedule: true },
                { social_connection_id: 'channel-website-b', scope: 'organization', department_id: null, team_id: null, can_schedule: true },
              ], error: null,
            })
            if (table === 'text_generation_platform_defaults') return chain({ data: [{ platform: 'website', max_characters: 5000 }], error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expect.arrayContaining([
      { platform: 'website', available: true, maxCharacters: 5000, isDefault: false },
    ]))
  })

  it('rejects a member without post.create in the requested scope', async () => {
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: { forUser: () => scopeResolvingUserClient(), forService: () => { throw new Error('forService should not be called once the permission check fails') } } })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(403)
  })

  // Ohne diese Pruefung koennte eine fremde departmentId frei mit der eigenen organizationId
  // kombiniert werden -- rolesForScope vereinigt die Rollen beider Ebenen, die Kombination kann
  // die Rollenmenge also nur vergroessern (Review dieses PRs, wie /preview oben).
  it('rejects a departmentId that does not belong to the requested organization', async () => {
    const app = await startApp({
      roleProvider: grantingRoleProvider,
      supabaseClients: {
        forUser: () => scopeResolvingUserClient({ organization_id: '3f000000-0000-4000-8000-000000000001' }),
        forService: () => { throw new Error('forService should not be called once scope resolution fails') },
      },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({ method: 'GET', url: '/v1/text-generation-platforms', headers: { authorization: `Bearer ${token}` }, query })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })
})

describe('PATCH/DELETE /v1/content-style-profiles/:id', () => {
  it('runs a patch, delete roundtrip for a member with post.create in the profile scope', async () => {
    const updatedRow = { ...PROFILE_ROW, name: 'Unser Ton (aktualisiert)', do_rules: ['Zusammenhalt erwähnen'] }
    let deleted = false
    let updatePayload: Record<string, unknown> | undefined
    const auditRows: Record<string, unknown>[] = []
    const scopes: PermissionScope[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('forUser should not be called by this route') },
      forService: () => customStyleProfileService({ updatedRow, auditRows, onDelete: () => { deleted = true }, onUpdate: (payload) => { updatePayload = payload } }),
    }
    const roleProvider: RoleProvider = { async rolesForScope(_auth, scope) { scopes.push(scope); return ['editor'] } }
    const app = await startApp({ roleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)

    const patched = await app.inject({
      method: 'PATCH', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Unser Ton (aktualisiert)', doRules: ['Zusammenhalt erwähnen'] },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      id: PROFILE_ID, organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: null, kind: 'custom', name: 'Unser Ton (aktualisiert)', doRules: ['Zusammenhalt erwähnen'],
    })
    // Der Anfragekoerper traegt gar keinen Scope: geprueft wird die Abteilung der bestehenden
    // Zeile, und nur die im Koerper genannten Felder werden geschrieben.
    expect(scopes[0]).toEqual({ organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID })
    expect(updatePayload).toEqual({ name: 'Unser Ton (aktualisiert)', do_rules: ['Zusammenhalt erwähnen'] })

    const removed = await app.inject({ method: 'DELETE', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(removed.statusCode).toBe(204)
    expect(deleted).toBe(true)
    expect(auditRows.map((row) => row.action)).toEqual(['content_style_profile.updated', 'content_style_profile.deleted'])
    expect(auditRows[0]).toMatchObject({ organization_id: ORGANIZATION_ID, entity_id: PROFILE_ID, metadata: { fields: ['name', 'doRules'] } })
  })

  it('returns 404 for an unknown profile on both patch and delete', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('forUser should not be called by this route') },
      forService: () => customStyleProfileService({ existingRow: null }),
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)

    const patched = await app.inject({ method: 'PATCH', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` }, payload: { isActive: false } })
    expect(patched.statusCode).toBe(404)
    expect(patched.json()).toMatchObject({ error: 'content_style_profile_not_found' })

    const removed = await app.inject({ method: 'DELETE', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(removed.statusCode).toBe(404)
    expect(removed.json()).toMatchObject({ error: 'content_style_profile_not_found' })
  })

  it('rejects a member without post.create in the profile scope, on an existing profile', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('forUser should not be called by this route') },
      forService: () => customStyleProfileService(),
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)

    const patched = await app.inject({ method: 'PATCH', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` }, payload: { isActive: false } })
    expect(patched.statusCode).toBe(403)

    const removed = await app.inject({ method: 'DELETE', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(removed.statusCode).toBe(403)
  })
})

describe('POST /v1/content-style-profiles/preview', () => {
  it('calls the active text provider directly and returns its generated post, with no DB write', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => activeTextProviderService(),
    }
    const app = await startApp({
      roleProvider: grantingRoleProvider, supabaseClients: clients,
      textGenerator: { generateText: async () => FAKE_GENERATED_POST },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(FAKE_GENERATED_POST)
  })

  it('rejects a member without post.create in the requested scope before touching the provider', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => { throw new Error('forService should not be called once the permission check fails') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(403)
  })

  // Ohne diese Pruefung koennte eine fremde departmentId frei mit der eigenen organizationId
  // kombiniert werden -- rolesForScope vereinigt die Rollen beider Ebenen, die Kombination kann
  // die Rollenmenge also nur vergroessern.
  it('rejects a departmentId that does not belong to the requested organization', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient({ organization_id: '3f000000-0000-4000-8000-000000000001' }),
      forService: () => { throw new Error('forService should not be called once scope resolution fails') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'not_found' })
  })

  // Ein Aufruf kostet einen echten Provider-Abruf; ohne Limit waere der "Testen"-Knopf ein
  // Kostenhebel. Eigene Nutzerkennung, damit der Zaehler die uebrigen Tests nicht mitzieht.
  it('rate-limits repeated previews from the same member', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => activeTextProviderService(),
    }
    const app = await startApp({
      roleProvider: grantingRoleProvider, supabaseClients: clients,
      textGenerator: { generateText: async () => FAKE_GENERATED_POST },
    })
    const token = await signAccessToken('3f000000-0000-4000-8000-0000000000ff')
    const request = () => app.inject({ method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD })
    for (let attempt = 0; attempt < 10; attempt += 1) expect((await request()).statusCode).toBe(200)
    const blocked = await request()
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toMatchObject({ error: 'rate_limited' })
  })

  it('returns an honest error when no active text provider is configured', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => activeTextProviderService([]),
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'text_provider_not_configured' })
  })

  // Ein Client-Retry (Timeout, Doppelklick) mit demselben Idempotency-Key darf den Provider nicht
  // ein zweites Mal kostenpflichtig aufrufen -- previewStyleProfile teilt sich den laufenden Aufruf
  // (shared.ts).
  it('shares one provider call between concurrent retries with the same Idempotency-Key', async () => {
    let calls = 0
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => activeTextProviderService(),
    }
    const app = await startApp({
      roleProvider: grantingRoleProvider, supabaseClients: clients,
      textGenerator: { generateText: async () => { calls += 1; return FAKE_GENERATED_POST } },
    })
    const token = await signAccessToken(USER_ID)
    const send = () => app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'preview-retry-1' },
      payload: PREVIEW_PAYLOAD,
    })
    const [first, second] = await Promise.all([send(), send()])
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(calls).toBe(1)
  })

  it('maps an ungrounded generation to 502', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => activeTextProviderService(),
    }
    const app = await startApp({
      roleProvider: grantingRoleProvider, supabaseClients: clients,
      textGenerator: { generateText: async () => { throw new ContentGenerationError('ungrounded', false) } },
    })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ error: 'ungrounded' })
  })
})

describe('POST /v1/content-style-profiles/prompt-preview', () => {
  it('assembles the prompt without touching a provider', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/prompt-preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.system).toContain('Unser Ton')
    expect(body.user).toContain('3:1 Sieg im Lokalderby')
  })

  it('rejects a member without post.create in the requested scope', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => scopeResolvingUserClient(),
      forService: () => { throw new Error('forService should not be called by this route') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/prompt-preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('text workshop drafts', () => {
  const DRAFT_ID = '3f000000-0000-4000-8000-000000000001'
  const POST_ID = '3f000000-0000-4000-8000-000000000002'
  const SESSION_ID = '3f000000-0000-4000-8000-000000000003'
  const CANDIDATE_ID = '3f000000-0000-4000-8000-000000000004'
  const draftPayload = { presetSlug: 'training_insight', communicationGoal: 'inform', factsText: 'Übung: Passen', observation: '', quote: '', doNotMention: '', selectedProfile: 'klar_erklaerend', temperature: 0.6, selectedPlatforms: [], maxCharactersOverride: '' }

  it('audits a successfully saved draft without its raw input', async () => {
    const auditRows: Record<string, unknown>[] = []
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => {
        if (table === 'text_workshop_drafts') return chain({ data: null, error: null })
        throw new Error(`unexpected user table: ${table}`)
      } }) as unknown as SupabaseClient,
      forService: () => ({ from: (table: string) => {
        if (table === 'text_workshop_drafts') return {
          select: () => chain({ data: null, error: null }),
          upsert: () => ({ select: () => ({ single: async () => ({
            data: { id: DRAFT_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null, post_id: null, payload: draftPayload, created_at: '2026-08-17T10:00:00+00:00', updated_at: '2026-08-17T10:00:00+00:00' }, error: null,
          }) }) }),
        }
        if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } } }
        throw new Error(`unexpected service table: ${table}`)
      } }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'PUT', url: `/v1/text-workshop/drafts/${DRAFT_ID}`, headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` },
      payload: { organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, payload: draftPayload },
    })
    expect(response.statusCode).toBe(200)
    expect(auditRows).toEqual([expect.objectContaining({
      organization_id: ORGANIZATION_ID, action: 'text_workshop_draft.saved', entity_type: 'text_workshop_drafts', entity_id: DRAFT_ID,
      metadata: { departmentId: DEPARTMENT_ID, teamId: null },
    })])
    const auditEvent = auditRows[0]!
    expect(auditEvent).not.toHaveProperty('payload')
    expect((auditEvent.metadata as Record<string, unknown>)).not.toHaveProperty('payload')
  })

  it('links a draft only when it has the accepted candidate’s complete scope', async () => {
    const filters: Array<[string, string, string | null]> = []
    const update = {
      eq: (field: string, value: string) => { filters.push(['eq', field, value]); return update },
      is: (field: string, value: null) => { filters.push(['is', field, value]); return update },
      then: (resolve: (result: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
    }
    const clients: SupabaseClientFactory = {
      forUser: () => ({ from: (table: string) => {
        if (table === 'generation_candidates') return chain({ data: { organization_id: ORGANIZATION_ID, composition_session_id: SESSION_ID }, error: null })
        if (table === 'composition_sessions') return chain({ data: { department_id: DEPARTMENT_ID, team_id: null, post_id: null }, error: null })
        throw new Error(`unexpected user table: ${table}`)
      } }) as unknown as SupabaseClient,
      forService: () => ({
        rpc: async () => ({ data: { postId: POST_ID, postVersionId: '3f000000-0000-4000-8000-000000000005' }, error: null }),
        from: (table: string) => {
          if (table === 'text_workshop_drafts') return { update: () => update }
          throw new Error(`unexpected service table: ${table}`)
        },
      }) as unknown as SupabaseClient,
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const response = await app.inject({
      method: 'POST', url: `/v1/text-workshop/candidates/${CANDIDATE_ID}/accept`, headers: { authorization: `Bearer ${await signAccessToken(USER_ID)}` }, payload: { draftId: DRAFT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', 'id', DRAFT_ID], ['eq', 'organization_id', ORGANIZATION_ID], ['eq', 'department_id', DEPARTMENT_ID], ['is', 'team_id', null], ['eq', 'created_by', USER_ID],
    ]))
  })
})
