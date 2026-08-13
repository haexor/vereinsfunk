import { ContentGenerationError } from '@vereinsfunk/content-engine'
import { createSecretBox } from '@vereinsfunk/secrets'
import { describe, expect, it } from 'vitest'
import { ciphertextToBytea } from './secretBox.js'
import { chain, DEPARTMENT_ID, denyingRoleProvider, grantingRoleProvider, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const STYLE_RULES = { toneTags: ['direkt', 'anfeuernd'], catchphrases: [], exampleInput: '', exampleOutput: '', additionalInstructions: '' }
const PERSONA_ROW = { id: '3b000000-0000-4000-8000-000000000001', slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.', style_rules: STYLE_RULES, avoid_rules: ['Ironie'], do_rules: [] }
const PROFILE_ID = '3e000000-0000-4000-8000-000000000001'
const PROFILE_ROW = {
  id: PROFILE_ID, organization_id: ORGANIZATION_ID, department_id: DEPARTMENT_ID, team_id: null,
  slug: 'unser-ton', name: 'Unser Ton', description: 'Warm.', style_rules: STYLE_RULES, avoid_rules: [], do_rules: [],
  is_active: true, created_by: USER_ID, created_at: '2026-08-13T10:00:00+00:00', updated_at: '2026-08-13T10:00:00+00:00',
}

function customStyleProfileService(options: { existingRow?: Record<string, unknown> | null; updatedRow?: Record<string, unknown> | null; onDelete?: () => void } = {}): SupabaseClient {
  const existingRow = 'existingRow' in options ? options.existingRow! : PROFILE_ROW
  return {
    from: (table: string) => {
      if (table !== 'content_style_profiles') throw new Error(`unexpected table in test fake: ${table}`)
      return {
        select: () => chain({ data: existingRow, error: null }),
        update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: options.updatedRow ?? null, error: null }) }) }) }),
        delete: () => ({ eq: async () => { options.onDelete?.(); return { error: null } } }),
      }
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
    temperature: 0.4, max_output_tokens: 500, structured_output_required: true, priority: 1,
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
  const basePayload = {
    organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, presetSlug: 'training_insight', communicationGoal: 'inform',
    requestedFormats: ['text_post'], sourceMaterial: { facts: { title: 'Training' }, observations: [], quotes: [], doNotMention: [] },
  }

  it('resolves an active persona by slug into the style snapshot', async () => {
    let capturedRpcParams: Record<string, unknown> | undefined
    const clients: SupabaseClientFactory = {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'policy_settings') return chain({ data: [], error: null })
            if (table === 'platform_style_personas') return chain({ data: PERSONA_ROW, error: null })
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
            if (table === 'policy_settings') return chain({ data: [], error: null })
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
})

describe('PATCH/DELETE /v1/content-style-profiles/:id', () => {
  it('runs a patch, delete roundtrip for a member with post.create in the profile scope', async () => {
    const updatedRow = { ...PROFILE_ROW, name: 'Unser Ton (aktualisiert)', do_rules: ['Zusammenhalt erwähnen'] }
    let deleted = false
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('forUser should not be called by this route') },
      forService: () => customStyleProfileService({ updatedRow, onDelete: () => { deleted = true } }),
    }
    const app = await startApp({ roleProvider: grantingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)

    const patched = await app.inject({
      method: 'PATCH', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Unser Ton (aktualisiert)', doRules: ['Zusammenhalt erwähnen'] },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      id: PROFILE_ID, organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, teamId: null, kind: 'custom', name: 'Unser Ton (aktualisiert)', doRules: ['Zusammenhalt erwähnen'],
    })

    const removed = await app.inject({ method: 'DELETE', url: `/v1/content-style-profiles/${PROFILE_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(removed.statusCode).toBe(204)
    expect(deleted).toBe(true)
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
      forUser: () => { throw new Error('forUser should not be called by this route') },
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
      forUser: () => { throw new Error('forUser should not be called by this route') },
      forService: () => { throw new Error('forService should not be called once the permission check fails') },
    }
    const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/content-style-profiles/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
    })
    expect(response.statusCode).toBe(403)
  })

  it('returns an honest error when no active text provider is configured', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('forUser should not be called by this route') },
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

  it('maps an ungrounded generation to 502', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => { throw new Error('forUser should not be called by this route') },
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
