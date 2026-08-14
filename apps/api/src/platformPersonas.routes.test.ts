import { ContentGenerationError } from '@vereinsfunk/content-engine'
import { createSecretBox } from '@vereinsfunk/secrets'
import { describe, expect, it } from 'vitest'
import { ciphertextToBytea } from './secretBox.js'
import { adminProvider, nonAdminProvider, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const PERSONA_ID = '3a000000-0000-4000-8000-000000000001'
const PROVIDER_ID = '3a100000-0000-4000-8000-000000000001'
const STYLE_RULES = { toneTags: ['direkt', 'anfeuernd'], catchphrases: [], examples: [], additionalInstructions: '' }
const PREVIEW_PAYLOAD = { name: 'Kapitän Klar', description: 'Direkt.', styleRules: STYLE_RULES, avoidRules: [], doRules: [], sampleInput: '3:1 Sieg im Lokalderby' }
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

describe('platform style personas', () => {
  it('rejects a non-platform-admin on every route', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider })
    const token = await signAccessToken(USER_ID)
    const requests = [
      { method: 'GET' as const, url: '/v1/platform-style-personas' },
      { method: 'POST' as const, url: '/v1/platform-style-personas', payload: { slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt.', styleRules: STYLE_RULES, avoidRules: [], doRules: [] } },
      { method: 'PATCH' as const, url: `/v1/platform-style-personas/${PERSONA_ID}`, payload: { isActive: false } },
      { method: 'DELETE' as const, url: `/v1/platform-style-personas/${PERSONA_ID}` },
      { method: 'POST' as const, url: '/v1/platform-style-personas/preview', payload: PREVIEW_PAYLOAD },
      { method: 'POST' as const, url: '/v1/platform-style-personas/prompt-preview', payload: PREVIEW_PAYLOAD },
    ]
    for (const req of requests) {
      const response = await app.inject({ ...req, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    }
  })

  it('runs a create, patch, delete roundtrip for a platform admin', async () => {
    const personaRow = {
      id: PERSONA_ID, slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.',
      style_rules: STYLE_RULES, avoid_rules: [], do_rules: [], is_active: true, created_by: USER_ID,
      created_at: '2026-08-13T10:00:00+00:00', updated_at: '2026-08-13T10:00:00+00:00',
    }
    let deleted = false
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_style_personas') throw new Error(`unexpected table in test fake: ${table}`)
            return {
              insert: () => ({ select: () => ({ single: async () => ({ data: personaRow, error: null }) }) }),
              update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { ...personaRow, is_active: false }, error: null }) }) }) }),
              delete: () => ({ eq: async () => { deleted = true; return { error: null } } }),
            }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)

    const created = await app.inject({
      method: 'POST', url: '/v1/platform-style-personas', headers: { authorization: `Bearer ${token}` },
      payload: { slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt und anfeuernd.', styleRules: STYLE_RULES, avoidRules: [], doRules: [] },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ id: PERSONA_ID, slug: 'kapitaen-klar', isActive: true })

    const patched = await app.inject({
      method: 'PATCH', url: `/v1/platform-style-personas/${PERSONA_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { isActive: false },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({ isActive: false })

    const removed = await app.inject({ method: 'DELETE', url: `/v1/platform-style-personas/${PERSONA_ID}`, headers: { authorization: `Bearer ${token}` } })
    expect(removed.statusCode).toBe(204)
    expect(deleted).toBe(true)
  })

  it('rejects a request naming a system style profile slug', async () => {
    const app = await startApp({ platformAdminProvider: adminProvider })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'POST', url: '/v1/platform-style-personas', headers: { authorization: `Bearer ${token}` },
      payload: { slug: 'klar_erklaerend', name: 'Duplikat', description: 'Must fail', styleRules: STYLE_RULES, avoidRules: [], doRules: [] },
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 404 when patching an unknown persona', async () => {
    const clients: SupabaseClientFactory = {
      forUser: () => ({}) as unknown as SupabaseClient,
      forService: () =>
        ({
          from: (table: string) => {
            if (table !== 'platform_style_personas') throw new Error(`unexpected table in test fake: ${table}`)
            return { update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
          },
        }) as unknown as SupabaseClient,
    }
    const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
    const token = await signAccessToken(USER_ID)
    const response = await app.inject({
      method: 'PATCH', url: `/v1/platform-style-personas/${PERSONA_ID}`, headers: { authorization: `Bearer ${token}` },
      payload: { isActive: false },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'platform_style_persona_not_found' })
  })

  describe('POST /v1/platform-style-personas/preview', () => {
    it('calls the active text provider directly and returns its generated post, with no DB write', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => { throw new Error('forUser should not be called by this route') },
        forService: () => activeTextProviderService(),
      }
      const app = await startApp({
        platformAdminProvider: adminProvider, supabaseClients: clients,
        textGenerator: { generateText: async () => FAKE_GENERATED_POST },
      })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/platform-style-personas/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(FAKE_GENERATED_POST)
    })

    it('returns an honest error when no active text provider is configured', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => { throw new Error('forUser should not be called by this route') },
        forService: () => activeTextProviderService([]),
      }
      const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/platform-style-personas/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
      })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: 'text_provider_not_configured' })
    })

    // Ein Client-Retry (Timeout, Doppelklick) mit demselben Idempotency-Key darf den Provider
    // nicht ein zweites Mal kostenpflichtig aufrufen -- previewStyleProfile teilt sich den
    // laufenden Aufruf (shared.ts).
    it('shares one provider call between concurrent retries with the same Idempotency-Key', async () => {
      let calls = 0
      const clients: SupabaseClientFactory = {
        forUser: () => { throw new Error('forUser should not be called by this route') },
        forService: () => activeTextProviderService(),
      }
      const app = await startApp({
        platformAdminProvider: adminProvider, supabaseClients: clients,
        textGenerator: { generateText: async () => { calls += 1; return FAKE_GENERATED_POST } },
      })
      const token = await signAccessToken(USER_ID)
      const send = () => app.inject({
        method: 'POST', url: '/v1/platform-style-personas/preview',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'persona-preview-retry-1' },
        payload: PREVIEW_PAYLOAD,
      })
      const [first, second] = await Promise.all([send(), send()])
      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(200)
      expect(second.json()).toEqual(first.json())
      expect(calls).toBe(1)
    })

    it('maps a provider rate limit to 429', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => { throw new Error('forUser should not be called by this route') },
        forService: () => activeTextProviderService(),
      }
      const app = await startApp({
        platformAdminProvider: adminProvider, supabaseClients: clients,
        textGenerator: { generateText: async () => { throw new ContentGenerationError('provider_rate_limit', true) } },
      })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/platform-style-personas/preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
      })
      expect(response.statusCode).toBe(429)
      expect(response.json()).toMatchObject({ error: 'provider_rate_limit' })
    })
  })

  describe('POST /v1/platform-style-personas/prompt-preview', () => {
    it('assembles the prompt without touching the DB or a provider', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => { throw new Error('forUser should not be called by this route') },
        forService: () => { throw new Error('forService should not be called by this route') },
      }
      const app = await startApp({ platformAdminProvider: adminProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({
        method: 'POST', url: '/v1/platform-style-personas/prompt-preview', headers: { authorization: `Bearer ${token}` }, payload: PREVIEW_PAYLOAD,
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.system).toContain('Kapitän Klar')
      expect(body.user).toContain('3:1 Sieg im Lokalderby')
    })
  })
})
