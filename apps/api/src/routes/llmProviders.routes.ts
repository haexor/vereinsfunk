import {
  CreateLlmProviderConfigurationRequestSchema,
  ListLlmProviderModelsRequestSchema,
  ListLlmProviderModelsResponseSchema,
  LlmProviderConfigurationSchema,
  UpdateLlmProviderConfigurationRequestSchema,
  UuidSchema,
} from '@vereinsfunk/contracts'
import { fetchPublicUrl, OutboundFetchError } from '@vereinsfunk/outbound-fetch'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { IMPLEMENTED_LLM_PROTOCOLS, joinUrlPath, mapLlmProviderConfigurationRow, parseModelListingIds } from '../llmProviders.js'
import { ciphertextToBytea, createSecretBoxFromEnvironment } from '../secretBox.js'
import type { ApiRouteContext } from './context.js'

export function registerLlmProviderRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients, environment } = context

  app.get('/v1/llm-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const configs = await service
      .from('llm_provider_configurations')
      .select('id, label, protocol, base_url, model, purpose, task_kind, temperature, max_output_tokens, structured_output_required, priority, is_active')
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
    // Beide Protokolle haben inzwischen einen Adapter im Worker; nur die uebrigen Aufgabenarten
    // (Bild, Video) sind weiterhin unimplementiert.
    if (input.taskKind !== 'text_generation') return reply.code(422).send({ error: 'task_kind_not_implemented', taskKind: input.taskKind })
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
        temperature: input.runtimeParameters.temperature,
        max_output_tokens: input.runtimeParameters.maxOutputTokens,
        structured_output_required: input.runtimeParameters.structuredOutputRequired,
        priority: input.priority,
        is_active: input.isActive,
      })
      .select('id, label, protocol, base_url, model, purpose, task_kind, temperature, max_output_tokens, structured_output_required, priority, is_active')
      .single()
    if (insert.error) throw insert.error
    const sealed = createSecretBoxFromEnvironment(environment).seal(input.apiKey, insert.data.id as string)
    const secretInsert = await service.from('llm_provider_secrets').insert({
      llm_provider_configuration_id: insert.data.id,
      api_key_ciphertext: ciphertextToBytea(sealed.ciphertext),
      key_version: sealed.keyVersion,
    })
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
    if (input.taskKind && input.taskKind !== 'text_generation') return reply.code(422).send({ error: 'task_kind_not_implemented', taskKind: input.taskKind ?? 'text_generation' })
    const service = supabaseClients.forService()
    const current = await service.from('llm_provider_configurations').select('protocol, task_kind, is_active').eq('id', params.id).maybeSingle()
    if (current.error) throw current.error
    if (!current.data) return reply.code(404).send({ error: 'llm_provider_not_found' })
    const effectiveProtocol = input.protocol ?? current.data.protocol
    const effectiveTaskKind = input.taskKind ?? current.data.task_kind
    const effectiveIsActive = input.isActive ?? current.data.is_active
    // Nicht nur bei explizitem isActive:true pruefen: ein Protokollwechsel auf einer bereits
    // aktiven Zeile darf die Konfiguration ebenso wenig unimplementiert zurueckliessen.
    if (effectiveIsActive && (!IMPLEMENTED_LLM_PROTOCOLS.has(effectiveProtocol as string) || effectiveTaskKind !== 'text_generation')) {
      return reply.code(422).send({ error: 'unsupported_provider_configuration' })
    }
    const payload: Record<string, unknown> = {}
    if (input.label !== undefined) payload.label = input.label
    if (input.protocol !== undefined) payload.protocol = input.protocol
    if (input.baseUrl !== undefined) payload.base_url = input.baseUrl
    if (input.model !== undefined) payload.model = input.model
    if (input.purpose !== undefined) payload.purpose = input.purpose
    if (input.taskKind !== undefined) payload.task_kind = input.taskKind
    if (input.runtimeParameters !== undefined) {
      payload.temperature = input.runtimeParameters.temperature
      payload.max_output_tokens = input.runtimeParameters.maxOutputTokens
      payload.structured_output_required = input.runtimeParameters.structuredOutputRequired
    }
    if (input.priority !== undefined) payload.priority = input.priority
    if (input.isActive !== undefined) payload.is_active = input.isActive
    const update = await service
      .from('llm_provider_configurations')
      .update(payload)
      .eq('id', params.id)
      .select('id, label, protocol, base_url, model, purpose, task_kind, temperature, max_output_tokens, structured_output_required, priority, is_active')
      .single()
    if (update.error) throw update.error
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
}
