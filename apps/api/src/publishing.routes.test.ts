import { describe, expect, it } from 'vitest'
import { DEPARTMENT_ID, ORGANIZATION_ID, USER_ID, chain, denyingRoleProvider, organizationManagerRoleProvider, signAccessToken, startApp } from './testSupport.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialPublisher } from '@vereinsfunk/publishing'
import type { SupabaseClientFactory } from './app.js'
import { ciphertextToBytea } from './secretBox.js'
import { createSecretBox } from '@vereinsfunk/secrets'

describe('Paket 025: Inhalts-Pipeline schliessen (Entwurfserzeugung und Veroeffentlichung)', () => {
  const PUBLICATION_ID = '25000000-1000-4000-8000-000000000001'
  const PUB_POST_VERSION_ID = '25000000-2000-4000-8000-000000000001'
  const PUB_POST_ID = '25000000-3000-4000-8000-000000000001'
  const PUB_SOCIAL_CONNECTION_ID = '25000000-4000-4000-8000-000000000001'

  function publicationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: PUBLICATION_ID, organization_id: ORGANIZATION_ID, post_version_id: PUB_POST_VERSION_ID,
      social_connection_id: PUB_SOCIAL_CONNECTION_ID, platform: 'facebook', status: 'queued',
      scheduled_for: null, idempotency_key: 'publish:test:facebook:conn',
      ...overrides,
    }
  }

  // Paket 002: computeMediaGateBlockersForPostVersion() laeuft vor jedem externen I/O erneut, und
  // zwar ueber den SERVICE-Client -- directory_people haengt per RLS an 'directory.read', und die
  // Organisationsrolle social_manager (der typische Veroeffentlichende) hat dieses Recht nicht.
  // Jeder forService-Fake in diesem Block muss diese Lesungen also mitbedienen. Ohne mediaOverrides
  // bleibt es beim Ausgangszustand aus Plan 025 -- keine post_media-Zeile (Text-only, keine
  // Upload-Pipeline aus 002/003), kein policy_settings-Override -- und das Gate meldet keinen Blocker.
  function mediaGateTables(table: string, mediaOverrides: Record<string, unknown> = {}) {
    if (table === 'policy_settings') return chain({ data: [], error: null })
    if (table === 'post_versions') return chain({ data: { id: PUB_POST_VERSION_ID, post_id: PUB_POST_ID, title: '', caption: 'Hallo Welt' }, error: null })
    if (table === 'post_media') return chain({ data: (mediaOverrides.postMedia as unknown[] | undefined) ?? [], error: null })
    if (table === 'media_derivatives') return chain({ data: (mediaOverrides.derivatives as unknown[] | undefined) ?? [], error: null })
    if (table === 'media_assets') return chain({ data: (mediaOverrides.assets as unknown[] | undefined) ?? [], error: null })
    if (table === 'face_regions') return chain({ data: (mediaOverrides.faces as unknown[] | undefined) ?? [], error: null })
    if (table === 'consent_records') return chain({ data: (mediaOverrides.consents as unknown[] | undefined) ?? [], error: null })
    if (table === 'directory_people') return chain({ data: (mediaOverrides.people as unknown[] | undefined) ?? [], error: null })
    return null
  }

  function readOnlyClients(overrides: Record<string, unknown> = {}, mediaOverrides: Record<string, unknown> = {}): SupabaseClientFactory {
    return {
      forUser: () =>
        ({
          from: (table: string) => {
            if (table === 'publications') return chain({ data: publicationRow(overrides), error: null })
            if (table === 'post_versions') return chain({ data: { id: PUB_POST_VERSION_ID, post_id: PUB_POST_ID, caption: 'Hallo Welt' }, error: null })
            if (table === 'posts') return chain({ data: { id: PUB_POST_ID, department_id: DEPARTMENT_ID }, error: null })
            throw new Error(`unexpected table in test fake: ${table}`)
          },
        }) as unknown as SupabaseClient,
      // Die Gate-Lesungen sind der einzige Service-Client-Zugriff, der vor dem Compare-and-Set
      // stattfinden darf -- jede andere Tabelle (Kanal, Secret, publications-Update) wirft, damit ein
      // vorgezogener Veroeffentlichungsschritt im Test auffliegt.
      forService: () =>
        ({
          from: (table: string) => {
            const gate = mediaGateTables(table, mediaOverrides)
            if (gate) return gate
            throw new Error(`forService should not be used for ${table} before the media gate`)
          },
        }) as unknown as SupabaseClient,
    }
  }

  describe('POST /v1/publications/:id/execute', () => {
    it('reports a non-existent publication as not_found', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({ from: (table: string) => { if (table === 'publications') return chain({ data: null, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
        forService: () => ({ from: () => { throw new Error('forService should not be used') } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(404)
    })

    it('rejects a caller without post.publish in the department', async () => {
      const app = await startApp({ roleProvider: denyingRoleProvider, supabaseClients: readOnlyClients() })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(403)
    })

    it('rejects a publication scheduled for the future with 409 not_due_yet, no Hatchet cron auto-executes it', async () => {
      const app = await startApp({
        roleProvider: organizationManagerRoleProvider,
        supabaseClients: readOnlyClients({ scheduled_for: new Date(Date.now() + 60_000).toISOString() }),
      })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'not_due_yet' })
    })

    it('rejects with 409 media_gate_blocked when a linked media asset is not scan-clean, before any publish step', async () => {
      // Paket 002: schedule_publication (2026081107) hat den konservativen Kern beim Einplanen
      // bereits durchgesetzt, aber der Zustand kann sich danach aendern (Pflichtszenario 5:
      // Widerruf nach Freigabe). Kein Veroeffentlichungsschritt darf vor diesem Check passieren --
      // die readOnlyClients()-forService bedient ausschliesslich die Gate-Tabellen und wirft sonst.
      const app = await startApp({
        roleProvider: organizationManagerRoleProvider,
        supabaseClients: readOnlyClients({}, {
          postMedia: [{ media_derivative_id: '25000000-5000-4000-8000-000000000009' }],
          derivatives: [{ id: '25000000-5000-4000-8000-000000000009', media_asset_id: '25000000-5000-4000-8000-000000000010', status: 'ready' }],
          assets: [{ id: '25000000-5000-4000-8000-000000000010', mime_type: 'image/png', scan_status: 'pending' }],
        }),
      })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'media_gate_blocked', blockers: ['scan_pending'] })
    })

    it('blocks a minor consent without a guardian signature even though directory_people is unreadable for the publisher', async () => {
      // Regression (gefunden im Code-Review): der Gate-Check lief zuerst ueber den Nutzer-Client.
      // directory_people haengt per RLS an 'directory.read' (2026080703), das der veroeffentlichenden
      // Organisationsrolle social_manager fehlt -- die Verzeichnisperson kam leer zurueck,
      // subjectIsMinor fiel auf false und evaluateConsent hielt die Einwilligung fuer gueltig. Der
      // forUser-Fake unten stellt genau das nach: er wirft fuer directory_people, was auffliegt,
      // sobald der Check dort wieder ueber den Nutzer-Client liest.
      const app = await startApp({
        roleProvider: organizationManagerRoleProvider,
        supabaseClients: readOnlyClients({}, {
          postMedia: [{ media_derivative_id: '25000000-5000-4000-8000-000000000011' }],
          derivatives: [{ id: '25000000-5000-4000-8000-000000000011', media_asset_id: '25000000-5000-4000-8000-000000000012', status: 'ready' }],
          assets: [{ id: '25000000-5000-4000-8000-000000000012', mime_type: 'image/png', scan_status: 'clean' }],
          faces: [{ media_asset_id: '25000000-5000-4000-8000-000000000012', subject_kind: 'minor', decision: 'consented', consent_record_id: '25000000-5000-4000-8000-000000000013' }],
          consents: [{
            id: '25000000-5000-4000-8000-000000000013', guardian_confirmed: false, signer_role: 'self', superseded_by: null,
            revoked_at: null, valid_from: null, valid_until: null, directory_person_id: '25000000-5000-4000-8000-000000000014',
            scope_structured: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
          }],
          people: [{ id: '25000000-5000-4000-8000-000000000014', first_name: 'Mia', last_name: 'Minderjaehrig', status: 'active', is_minor: true }],
        }),
      })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'media_gate_blocked', blockers: ['consent_invalid'] })
    })

    it('rejects with 409 invalid_status when the compare-and-set loses the race', async () => {
      // status ist bereits nicht mehr 'queued' (paralleler Aufruf/frueherer Versuch) -- die
      // Update-Eq-Kette (status='queued') trifft dann keine Zeile.
      const clients: SupabaseClientFactory = {
        ...readOnlyClients(),
        forService: () => ({ from: (table: string) => { const gate = mediaGateTables(table); if (gate) return gate; if (table === 'publications') return { update: () => chain({ data: null, error: null }) }; throw new Error(`unexpected table in service fake: ${table}`) } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'invalid_status' })
    })

    it('rejects with 422 when the post version has no approved media derivative yet (Instagram)', async () => {
      // Ausgangslage (plans/025): ohne die Upload-/Freigabepipeline (002/003) hat jede aus Paket
      // 025 entstehende post_version keine post_media-Zeilen. Instagram verlangt weiterhin
      // zwingend ein Bild (technische Grenze der Plattform); FakePublisher/MetaPublisher lehnen das
      // fuer Instagram unconditional ab -- erwartetes Verhalten, kein Bug. Facebook/Twitter/LinkedIn
      // erlauben seit Paket 045 auch ohne Medium (eigener Test unten), deshalb hier ausdruecklich
      // Instagram statt der Datei-Default-Plattform 'facebook'.
      const clients: SupabaseClientFactory = {
        ...readOnlyClients({ platform: 'instagram' }),
        forService: () =>
          ({
            from: (table: string) => {
              // post_media kommt hier leer zurueck -- dieselbe Antwort bedient den Gate-Check davor
              // und die Medienauflistung fuer den Publisher danach.
              const gate = mediaGateTables(table)
              if (gate) return gate
              if (table === 'publications') return { update: () => chain({ data: { id: PUBLICATION_ID }, error: null }) }
              if (table === 'social_connections') return chain({ data: { external_account_id: 'ig-123' }, error: null })
              if (table === 'social_connection_secrets') {
                const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
              }
              // chain() liefert zusaetzlich zum insert() die select().eq().order().limit().maybeSingle()-Kette
              // fuer die naechste attempt_number (Code-Review zu PR #25: attempt_number darf nicht mehr
              // hartkodiert 1 sein, unique(publication_id,attempt_number) wuerde sonst einen Retry sprengen).
              if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async () => ({ error: null }) }
              if (table === 'publication_media_grants') return { update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
              throw new Error(`unexpected table in service fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: 'validation_failed' })
    })

    it('publishes a Facebook post without media (Paket 045: media is optional for Facebook/Twitter/LinkedIn)', async () => {
      const auditCaptured: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        ...readOnlyClients(),
        forService: () =>
          ({
            from: (table: string) => {
              const gate = mediaGateTables(table)
              if (gate) return gate
              if (table === 'publications') return { update: () => chain({ data: { id: PUBLICATION_ID }, error: null }) }
              if (table === 'social_connections') return chain({ data: { external_account_id: 'page-123' }, error: null })
              if (table === 'social_connection_secrets') {
                const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
              }
              if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async () => ({ error: null }) }
              if (table === 'publication_media_grants') return { update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
              if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditCaptured.push(row); return { error: null } } }
              throw new Error(`unexpected table in service fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: PUBLICATION_ID, status: 'published' })
      expect(auditCaptured).toMatchObject([{ action: 'post.published', entity_id: PUBLICATION_ID }])
    })

    it('publishes successfully once an approved media derivative exists, records the attempt and audits it', async () => {
      process.env.API_PUBLIC_BASE_URL = 'https://api.example.test'
      try {
        const auditCaptured: Record<string, unknown>[] = []
        const grantsRevoked: Record<string, unknown>[] = []
        const clients: SupabaseClientFactory = {
          ...readOnlyClients(),
          forService: () =>
            ({
              from: (table: string) => {
                // Ein Medium, das beide Leser bedient: den Gate-Check davor (media_asset_id ->
                // scan_status='clean', kein face_regions-Eintrag, Derivat 'ready') und die
                // Medienauflistung fuer den Publisher danach (position, sha256).
                const gate = mediaGateTables(table, {
                  postMedia: [{ position: 0, media_derivative_id: '25000000-5000-4000-8000-000000000001' }],
                  derivatives: [{ id: '25000000-5000-4000-8000-000000000001', media_asset_id: '25000000-5000-4000-8000-000000000002', sha256: 'a'.repeat(64), mime_type: 'image/png', status: 'ready' }],
                  assets: [{ id: '25000000-5000-4000-8000-000000000002', mime_type: 'image/png', scan_status: 'clean' }],
                })
                if (gate) return gate
                if (table === 'publications') return { update: () => chain({ data: { id: PUBLICATION_ID }, error: null }) }
                if (table === 'social_connections') return chain({ data: { external_account_id: 'page-123' }, error: null })
                if (table === 'social_connection_secrets') {
                  const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                  return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
                }
                if (table === 'publication_media_grants') {
                  return {
                    insert: async () => ({ error: null }),
                    update: (payload: Record<string, unknown>) => ({ eq: () => ({ is: async () => { grantsRevoked.push(payload); return { error: null } } }) }),
                  }
                }
                if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async () => ({ error: null }) }
                if (table === 'audit_events') return { insert: async (row: Record<string, unknown>) => { auditCaptured.push(row); return { error: null } } }
                throw new Error(`unexpected table in service fake: ${table}`)
              },
            }) as unknown as SupabaseClient,
        }
        const publisher: SocialPublisher = {
          async validate() { return { valid: true, errors: [] } },
          async publish() { return { externalId: 'fb_post_1', status: 'published', permalink: 'https://facebook.com/fb_post_1' } },
          async reconcile() { return { externalId: 'fb_post_1', status: 'published' } },
        }
        const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients, publisher })
        const token = await signAccessToken(USER_ID)
        const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ id: PUBLICATION_ID, status: 'published', externalId: 'fb_post_1', permalink: 'https://facebook.com/fb_post_1' })
        expect(auditCaptured).toMatchObject([{ action: 'post.published', entity_id: PUBLICATION_ID }])
        // Code-Review zu PR #25: Grants muessen nach einem abgeschlossenen Versuch widerrufen werden,
        // sonst bleibt das Medium die volle TTL unauthentifiziert abrufbar.
        expect(grantsRevoked).toHaveLength(1)
        expect(grantsRevoked[0]).toHaveProperty('revoked_at')
      } finally {
        delete process.env.API_PUBLIC_BASE_URL
      }
    })

    it('classifies an unrecognizable publish() failure as unknown/action_required and returns 502', async () => {
      // Code-Review zu PR #25: der catch-Zweig blieb bisher ungetestet. Ohne Status-Code im
      // Fehlertext (anders als MetaPublishers "... (404)") kann keine 4xx/5xx-Unterscheidung
      // getroffen werden -- das ist der dokumentierte 'unknown'-Fall aus der Klassifikation.
      const publicationUpdates: Record<string, unknown>[] = []
      const attemptsCaptured: Record<string, unknown>[] = []
      const clients: SupabaseClientFactory = {
        ...readOnlyClients(),
        forService: () =>
          ({
            from: (table: string) => {
              const gate = mediaGateTables(table)
              if (gate) return gate
              if (table === 'publications') return { update: (payload: Record<string, unknown>) => { publicationUpdates.push(payload); return chain({ data: { id: PUBLICATION_ID }, error: null }) } }
              if (table === 'social_connections') return chain({ data: { external_account_id: 'page-123' }, error: null })
              if (table === 'social_connection_secrets') {
                const sealed = createSecretBox({ v1: Buffer.alloc(32, 7).toString('base64') }, 'v1').seal('fake-access-token', PUB_SOCIAL_CONNECTION_ID)
                return chain({ data: { token_ciphertext: ciphertextToBytea(sealed.ciphertext), token_key_version: 'v1' }, error: null })
              }
              if (table === 'publication_attempts') return { ...chain({ data: null, error: null }), insert: async (row: Record<string, unknown>) => { attemptsCaptured.push(row); return { error: null } } }
              if (table === 'publication_media_grants') return { update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }
              throw new Error(`unexpected table in service fake: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const publisher: SocialPublisher = {
        async validate() { return { valid: true, errors: [] } },
        async publish() { throw new Error('graph api unreachable') },
        async reconcile() { return { externalId: 'x', status: 'unknown' } },
      }
      const app = await startApp({ roleProvider: organizationManagerRoleProvider, supabaseClients: clients, publisher })
      const token = await signAccessToken(USER_ID)
      const response = await app.inject({ method: 'POST', url: `/v1/publications/${PUBLICATION_ID}/execute`, headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(502)
      expect(response.json()).toMatchObject({ error: 'publish_failed' })
      expect(publicationUpdates.at(-1)).toMatchObject({ status: 'action_required' })
      expect(attemptsCaptured.at(-1)).toMatchObject({ status: 'failed', error_class: 'unknown' })
    })
  })

  describe('GET /v1/media-grants/:token', () => {
    it('rejects an unknown token with 404, without requiring authentication', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () => ({ from: (table: string) => { if (table === 'publication_media_grants') return chain({ data: null, error: null }); throw new Error(`unexpected table: ${table}`) } }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/does-not-exist' })
      expect(response.statusCode).toBe(404)
    })

    it('rejects an expired grant with 404, same as an unknown token', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publication_media_grants') return chain({ data: { media_derivative_id: 'deriv-1', expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/expired-token' })
      expect(response.statusCode).toBe(404)
    })

    it('rejects a revoked grant with 404, same as an unknown token', async () => {
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publication_media_grants') return chain({ data: { media_derivative_id: 'deriv-1', expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: new Date().toISOString() }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/revoked-token' })
      expect(response.statusCode).toBe(404)
    })

    it('serves the referenced derivative bytes with the correct content-type and marks the grant accessed', async () => {
      let accessedAtSet = false
      const clients: SupabaseClientFactory = {
        forUser: () => ({}) as unknown as SupabaseClient,
        forService: () =>
          ({
            from: (table: string) => {
              if (table === 'publication_media_grants') {
                return {
                  ...chain({ data: { media_derivative_id: 'deriv-1', expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null }, error: null }),
                  update: () => ({ eq: async () => { accessedAtSet = true; return { error: null } } }),
                }
              }
              if (table === 'media_derivatives') return chain({ data: { bucket_id: 'rendered-media', object_path: 'org/dep/asset/deriv-1.png', mime_type: 'image/png', status: 'ready' }, error: null })
              throw new Error(`unexpected table: ${table}`)
            },
            storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from('fake-image-bytes')]), error: null }) }) },
          }) as unknown as SupabaseClient,
      }
      const app = await startApp({ supabaseClients: clients })
      const response = await app.inject({ method: 'GET', url: '/v1/media-grants/valid-token' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.rawPayload.toString()).toBe('fake-image-bytes')
      expect(accessedAtSet).toBe(true)
    })
  })
})

