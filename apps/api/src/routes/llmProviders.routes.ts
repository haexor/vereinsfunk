import {
  CreateLlmProviderConfigurationRequestSchema,
  ListLlmProviderModelsRequestSchema,
  ListLlmProviderModelsResponseSchema,
  LlmProviderConfigurationSchema,
  providerSendsTemperature,
  SocialPlatformSchema,
  TextGenerationCapabilitiesSchema,
  TextGenerationPlatformDefaultSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UpdateTextGenerationPlatformDefaultRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { fetchPublicUrl, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { IMPLEMENTED_LLM_PROTOCOLS, IMPLEMENTED_LLM_TASK_KINDS, joinUrlPath, mapLlmProviderConfigurationRow, parseModelListingIds } from '../llmProviders.js'
import { ciphertextToBytea, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'

export function registerLlmProviderRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients, environment } = context

  // CRUD hier erzeugt bewusst keinen audit_events-Eintrag: die Tabelle traegt eine pro-Verein
  // manipulationssichere Hash-Kette (organization_id NOT NULL, Advisory-Lock je Verein, Paket 020),
  // globale Plattform-Aktionen passen dort nicht ohne Eingriff in diese Kette. Ausserdem hat die
  // gesamte Plattform-Administration (platform_admins, platform_settings, Plan 022) bislang KEINEN
  // eigenen Audit-Trail -- ein auf LLM-Provider beschraenkter Sonderweg waere selbst unvollstaendig.
  // Zurueckgestellt als eigener, uebergreifender Punkt statt Einzelloesung fuer diese Route.
  app.get('/v1/llm-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const configs = await service
      .from('llm_provider_configurations')
      .select('id, label, protocol, base_url, model, purpose, task_kind, structured_output_required, priority, is_active')
      .order('priority')
    if (configs.error) throw configs.error
    const secrets = await service.from('llm_provider_secrets').select('llm_provider_configuration_id')
    if (secrets.error) throw secrets.error
    const hasSecretIds = new Set(secrets.data.map((row) => row.llm_provider_configuration_id as string))
    return reply.code(200).send(
      configs.data.map((row) => LlmProviderConfigurationSchema.parse(mapLlmProviderConfigurationRow(row, hasSecretIds.has(row.id as string)))),
    )
  })

  app.post('/v1/llm-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = CreateLlmProviderConfigurationRequestSchema.parse(request.body)
    // text_generation und vision_analysis haben inzwischen einen Adapter im Worker; nur die
    // uebrigen Aufgabenarten (Bild, Video) sind weiterhin unimplementiert.
    if (!IMPLEMENTED_LLM_TASK_KINDS.has(input.taskKind)) return reply.code(422).send({ error: 'task_kind_not_implemented', taskKind: input.taskKind })
    // Vor dem Insert erzeugt, damit eine fehlende oder ungueltige SECRET_BOX_KEYS-Konfiguration
    // wirft, bevor ueberhaupt eine Konfigurationszeile entsteht.
    const secretBox = createSecretBoxFromEnvironment(environment)
    const service = supabaseClients.forService()
    const insert = await service
      .from('llm_provider_configurations')
      .insert({
        label: input.label,
        protocol: input.protocol,
        base_url: input.baseUrl,
        model: input.model,
        purpose: input.purpose,
        task_kind: input.taskKind,
        structured_output_required: input.structuredOutputRequired,
        priority: input.priority,
        is_active: input.isActive,
      })
      .select('id, label, protocol, base_url, model, purpose, task_kind, structured_output_required, priority, is_active')
      .single()
    // Eine aktive Aufgabenart vergibt jede Prioritaet nur einmal (2026081305): zwei gleichrangige
    // aktive Provider liessen offen, welcher der aktive ist. Der Konflikt wird hier sichtbar --
    // in der Verwaltung, wo die Prioritaet im selben Formular steht -- statt spaeter im Lesepfad.
    if (insert.error) {
      if (insert.error.code === '23505') return reply.code(409).send({ error: 'priority_already_taken', correlationId: request.id })
      throw insert.error
    }
    // seal() kann ebenfalls werfen (siehe secretBox.ts) -- der try/catch faengt das ab, damit auch
    // dieser Fehlerpfad die Konfiguration zurueckrollt, nicht nur secretInsert.error.
    let secretInsert
    try {
      const sealed = secretBox.seal(input.apiKey, insert.data.id as string)
      secretInsert = await service.from('llm_provider_secrets').insert({
        llm_provider_configuration_id: insert.data.id,
        api_key_ciphertext: ciphertextToBytea(sealed.ciphertext),
        key_version: sealed.keyVersion,
      })
    } catch (error) {
      await service.from('llm_provider_configurations').delete().eq('id', insert.data.id)
      throw error
    }
    if (secretInsert.error) {
      // Ohne Rollback bliebe eine aktive Konfiguration ohne Schluessel zurueck.
      await service.from('llm_provider_configurations').delete().eq('id', insert.data.id)
      throw secretInsert.error
    }
    return reply.code(201).send(LlmProviderConfigurationSchema.parse(mapLlmProviderConfigurationRow(insert.data, true)))
  })

  app.patch('/v1/llm-providers/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const input = UpdateLlmProviderConfigurationRequestSchema.parse(request.body)
    if (input.taskKind && !IMPLEMENTED_LLM_TASK_KINDS.has(input.taskKind)) return reply.code(422).send({ error: 'task_kind_not_implemented', taskKind: input.taskKind })
    const service = supabaseClients.forService()
    const current = await service.from('llm_provider_configurations').select('protocol, task_kind, is_active').eq('id', params.id).maybeSingle()
    if (current.error) throw current.error
    if (!current.data) return reply.code(404).send({ error: 'llm_provider_not_found' })
    const effectiveProtocol = input.protocol ?? current.data.protocol
    const effectiveTaskKind = input.taskKind ?? current.data.task_kind
    const effectiveIsActive = input.isActive ?? current.data.is_active
    // Nicht nur bei explizitem isActive:true pruefen: ein Protokollwechsel auf einer bereits
    // aktiven Zeile darf die Konfiguration ebenso wenig unimplementiert zurueckliessen.
    if (effectiveIsActive && (!IMPLEMENTED_LLM_PROTOCOLS.has(effectiveProtocol as string) || !IMPLEMENTED_LLM_TASK_KINDS.has(effectiveTaskKind as string))) {
      return reply.code(422).send({ error: 'unsupported_provider_configuration' })
    }
    const payload: Record<string, unknown> = {}
    if (input.label !== undefined) payload.label = input.label
    if (input.protocol !== undefined) payload.protocol = input.protocol
    if (input.baseUrl !== undefined) payload.base_url = input.baseUrl
    if (input.model !== undefined) payload.model = input.model
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.taskKind !== undefined) payload.task_kind = input.taskKind
    if (input.structuredOutputRequired !== undefined) payload.structured_output_required = input.structuredOutputRequired
    if (input.priority !== undefined) payload.priority = input.priority
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await service
      .from('llm_provider_configurations')
      .update(payload)
      .eq('id', params.id)
      .select('id, label, protocol, base_url, model, purpose, task_kind, structured_output_required, priority, is_active')
      .single()
    // Trifft nicht nur eine geaenderte Prioritaet: auch das Aktivschalten einer vorbereiteten
    // Ersatzzeile laeuft in den Index, wenn ihre Prioritaet bereits vergeben ist.
    if (update.error) {
      if (update.error.code === '23505') return reply.code(409).send({ error: 'priority_already_taken', correlationId: request.id })
      throw update.error
    }
    if (input.apiKey !== undefined) {
      const sealed = createSecretBoxFromEnvironment(environment).seal(input.apiKey, params.id)
      const upsert = await service.from('llm_provider_secrets').upsert({
        llm_provider_configuration_id: params.id,
        api_key_ciphertext: ciphertextToBytea(sealed.ciphertext),
        key_version: sealed.keyVersion,
      })
      if (upsert.error) throw upsert.error
    }
    const hasSecret = await service
      .from('llm_provider_secrets')
      .select('llm_provider_configuration_id')
      .eq('llm_provider_configuration_id', params.id)
      .maybeSingle()
    if (hasSecret.error) throw hasSecret.error
    return reply.code(200).send(LlmProviderConfigurationSchema.parse(mapLlmProviderConfigurationRow(update.data, hasSecret.data !== null)))
  })

  // Modellauswahl im Anlege-Formular. Der Schluessel kommt aus dem Request, weil beim Anlegen noch
  // keine Konfiguration und damit kein hinterlegtes Geheimnis existiert; er wird nur fuer diesen
  // einen Abruf verwendet und nicht gespeichert. Der Abruf laeuft ueber fetchPublicUrl, weil die
  // Adresse aus dem Formular stammt -- ohne Zieladressenpruefung waere die API ein Proxy ins
  // interne Netz (siehe outboundFetch.ts), auch fuer eine Plattform-Administration.
  app.post('/v1/llm-providers/models', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const input = ListLlmProviderModelsRequestSchema.parse(request.body)
    // Dieselbe Authentifizierung wie der jeweilige Adapter im Worker: sonst meldet das Formular
    // "erreichbar", wo die spaetere Generierung an 401 scheitert.
    const headers = input.protocol === 'anthropic'
      ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${input.apiKey}` }
    let payload: unknown
    try {
      // fetchPublicUrl prueft die Zieladresse bereits selbst (auch je Weiterleitung); eine
      // vorgezogene Pruefung hier waere doppelte Arbeit fuer dasselbe Ergebnis.
      payload = JSON.parse(await fetchPublicUrl(joinUrlPath(input.baseUrl, 'models'), { headers, maxBytes: 1_000_000 }))
    } catch (error) {
      request.log.warn({ err: error, correlationId: request.id }, 'llm provider model listing failed')
      if (error instanceof OutboundFetchError && error.reason === 'blocked_url') {
        return reply.code(400).send({ error: 'base_url_not_allowed', correlationId: request.id })
      }
      return reply.code(502).send({ error: 'provider_unreachable', correlationId: request.id })
    }
    const models = parseModelListingIds(payload)
    if (models.length === 0) return reply.code(502).send({ error: 'provider_returned_no_models', correlationId: request.id })
    return reply.code(200).send(ListLlmProviderModelsResponseSchema.parse({ models }))
  })

  app.delete('/v1/llm-providers/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ id: UuidSchema }).parse(request.params)
    const service = supabaseClients.forService()
    const del = await service.from('llm_provider_configurations').delete().eq('id', params.id)
    if (del.error) throw del.error
    return reply.code(204).send()
  })

  // Nur requireAuth, kein requirePlatformAdmin: die Textwerkstatt muss den Standardwert zum
  // Vorbefuellen sehen koennen, ohne dass der Nutzer Plattform-Admin ist -- die Route bestaetigt
  // nur, was die text_generation_platform_defaults_select-Policy ohnehin jedem Mitglied erlaubt.
  app.get('/v1/text-generation-platform-defaults', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const client = supabaseClients.forUser(request.auth!.accessToken)
    const result = await client.from('text_generation_platform_defaults').select('platform, max_characters, updated_at').order('platform')
    if (result.error) throw result.error
    return reply.code(200).send(
      result.data.map((row) => TextGenerationPlatformDefaultSchema.parse({ platform: row.platform, maxCharacters: row.max_characters, updatedAt: row.updated_at })),
    )
  })

  app.put('/v1/text-generation-platform-defaults/:platform', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ platform: SocialPlatformSchema }).parse(request.params)
    const body = UpdateTextGenerationPlatformDefaultRequestSchema.parse(request.body)
    const service = supabaseClients.forService()
    // maybeSingle statt single: die Route aendert nur bestehende Zeilen (angelegt vom Seed in
    // 2026081308), sie legt keine an. Fehlt die Zeile -- etwa weil eine spaetere Migration die
    // Plattform-Menge erweitert, ohne sie zu befuellen -- ist das ein 404, kein 500 aus PGRST116.
    const update = await service
      .from('text_generation_platform_defaults')
      .update({ max_characters: body.maxCharacters, updated_by: request.auth!.userId })
      .eq('platform', params.platform)
      .select('platform, max_characters, updated_at')
      .maybeSingle()
    if (update.error) throw update.error
    if (!update.data) return reply.code(404).send({ error: 'text_generation_platform_default_not_found' })
    return reply.code(200).send(
      TextGenerationPlatformDefaultSchema.parse({ platform: update.data.platform, maxCharacters: update.data.max_characters, updatedAt: update.data.updated_at }),
    )
  })

  // Nur requireAuth, kein requirePlatformAdmin, wie die Plattform-Vorgaben oben: die Textwerkstatt
  // (ein normales Mitglied) braucht diese Antwort, um den Temperatur-Regler auszugrauen. Service-
  // Client, weil authenticated auf llm_provider_configurations kein Privileg hat (siehe pgTAP).
  app.get('/v1/text-generation-capabilities', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    const service = supabaseClients.forService()
    // Dieselbe Auswahl wie loadActiveTextProvider() im Worker (apps/worker/src/context.ts): eine
    // aktive Aufgabenart vergibt jede Prioritaet nur einmal (2026081305), die vorderste Zeile ist
    // also eindeutig der Provider, der eine echte Generierung tatsaechlich bedient. Der !inner-Join
    // gehoert dazu: eine aktive Konfiguration ohne hinterlegtes Geheimnis ist ein modellierter
    // Zustand (GET /v1/llm-providers gibt dafuer hasSecret: false zurueck), und der Worker
    // ueberspringt sie. Ohne den Join meldete diese Route das Protokoll einer Zeile, die nie
    // generiert (Review dieses PRs).
    const result = await service.from('llm_provider_configurations').select('protocol, llm_provider_secrets!inner(key_version)').eq('task_kind', 'text_generation').eq('is_active', true).order('priority').limit(1)
    if (result.error) throw result.error
    // Ist kein Provider aktiv, ist die Frage ohnehin hinfaellig -- dann laesst sich kein Beitrag
    // erzeugen.
    return reply.code(200).send(TextGenerationCapabilitiesSchema.parse({ temperatureSupported: providerSendsTemperature(result.data[0]?.protocol ?? '') }))
  })
}
