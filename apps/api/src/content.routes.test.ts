import { describe, expect, it } from 'vitest'
import { chain, DEPARTMENT_ID, grantingRoleProvider, ORGANIZATION_ID, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const STYLE_RULES = { toneTags: ['direkt', 'anfeuernd'], catchphrases: [], exampleInput: '', exampleOutput: '', additionalInstructions: '' }
const PERSONA_ROW = { id: '3b000000-0000-4000-8000-000000000001', slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.', style_rules: STYLE_RULES, avoid_rules: ['Ironie'], do_rules: [] }

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
