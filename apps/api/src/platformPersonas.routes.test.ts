import { describe, expect, it } from 'vitest'
import { adminProvider, nonAdminProvider, signAccessToken, startApp, USER_ID } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClientFactory } from './app.js'

const PERSONA_ID = '3a000000-0000-4000-8000-000000000001'
const STYLE_RULES = { toneTags: ['direkt', 'anfeuernd'], catchphrases: [], exampleInput: '', exampleOutput: '', additionalInstructions: '' }

describe('platform style personas', () => {
  it('rejects a non-platform-admin on every route', async () => {
    const app = await startApp({ platformAdminProvider: nonAdminProvider })
    const token = await signAccessToken(USER_ID)
    const requests = [
      { method: 'GET' as const, url: '/v1/platform-style-personas' },
      { method: 'POST' as const, url: '/v1/platform-style-personas', payload: { slug: 'kapitaen-klar', name: 'Kapitän Klar', description: 'Direkt.', styleRules: STYLE_RULES, avoidRules: [], doRules: [] } },
      { method: 'PATCH' as const, url: `/v1/platform-style-personas/${PERSONA_ID}`, payload: { isActive: false } },
      { method: 'DELETE' as const, url: `/v1/platform-style-personas/${PERSONA_ID}` },
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
})
