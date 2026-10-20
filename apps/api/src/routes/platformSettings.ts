import {
  JsonValueSchema,
  PlatformSettingKeySchema,
  PlatformSettingSchema,
  PlatformSettingValueSchemas,
  PublishingProviderConfigurationSchema,
  PublishingProviderSchema,
  UpdatePlatformSettingRequestSchema,
  UpdatePublishingProviderConfigurationRequestSchema,
} from '@vereinsfunk/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ApiRouteContext } from './context.js'
import { ciphertextToBytea } from '@vereinsfunk/secrets'
import { createSecretBoxFromEnvironment } from '../secretBox.js'

export function registerPlatformSettingsRoutes(app: FastifyInstance, context: ApiRouteContext): void {
  const { requireAuth, requirePlatformAdmin, supabaseClients, environment } = context

  app.get('/v1/platform-settings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const result = await service.from('platform_settings').select('key, value, updated_at').order('key')
    if (result.error) throw result.error
    return reply.code(200).send(
      result.data.map((row) => PlatformSettingSchema.parse({ key: row.key, value: row.value, updatedAt: row.updated_at })),
    )
  })

  app.put('/v1/platform-settings/:key', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ key: PlatformSettingKeySchema }).parse(request.params)
    const body = UpdatePlatformSettingRequestSchema.parse(request.body)
    const value = PlatformSettingValueSchemas[params.key].parse(body.value)
    // Der Datenbank-Schalter ist absichtlich nur der Laufzeit-Not-Aus. Aktivieren darf er
    // niemanden, solange der API-Container selbst keine echte Provider-Konfiguration besitzt;
    // das waere sonst eine UI, die "aktiv" meldet, obwohl jeder Publish sicher scheitert.
    const service = supabaseClients.forService()
    if (params.key === 'publishing_enabled' && value === true) {
      if (environment.PUBLISHING_MODE !== 'live') return reply.code(409).send({ error: 'publishing_not_configured', correlationId: request.id })
      // Der Deployment-Modus allein sagt nur, dass dieser API-Container einen echten Adapter
      // verwenden darf. Fuer jeden aktivierten Provider muessen Metadaten UND das separat
      // gespeicherte Secret vorhanden sein, sonst scheitert jeder Publish erst zur Laufzeit.
      const activeProviders = environment.PUBLISHING_PROVIDER
      if (activeProviders.length === 0) return reply.code(409).send({ error: 'publishing_not_configured', correlationId: request.id })
      const [configurations, secrets] = await Promise.all([
        service.from('publishing_provider_configurations').select('provider').in('provider', activeProviders),
        service.from('publishing_provider_secrets').select('provider').in('provider', activeProviders),
      ])
      if (configurations.error) throw configurations.error
      if (secrets.error) throw secrets.error
      const configuredProviders = new Set(configurations.data.map((row) => row.provider as string))
      const secretProviders = new Set(secrets.data.map((row) => row.provider as string))
      if (activeProviders.some((provider) => !configuredProviders.has(provider) || !secretProviders.has(provider))) {
        return reply.code(409).send({ error: 'publishing_not_configured', correlationId: request.id })
      }
    }
    if (params.key === 'agent_llm_provider_configuration_id' && value !== null) {
      // Der Responses-Adapter spricht nur OpenAI-kompatible Textprovider. Die Prüfung erfolgt
      // schon beim Speichern, damit eine URL- oder Modelländerung nicht erst beim nächsten Chat
      // als Laufzeitfehler auffällt; das Secret wird hierbei nicht gelesen oder ausgegeben.
      const configuredProvider = await service
        .from('llm_provider_configurations')
        .select('id, llm_provider_secrets!inner(llm_provider_configuration_id)')
        .eq('id', value)
        .eq('protocol', 'openai')
        .eq('task_kind', 'text_generation')
        .eq('is_active', true)
        .maybeSingle()
      if (configuredProvider.error) throw configuredProvider.error
      if (!configuredProvider.data) {
        return reply.code(422).send({ error: 'agent_llm_provider_not_configured', correlationId: request.id })
      }
    }
    // Ueber die RPC statt .update(): PostgREST bildet ein JSON-null im Update-Body immer auf
    // SQL-NULL ab (value ist aber `not null`), unabhaengig davon, dass die Spalte jsonb ist --
    // ein zurueckgesetztes agent_llm_provider_configuration_id (null = kein Override) waere sonst
    // nie speicherbar. Siehe update_platform_setting_value in den Migrationen.
    const update = await service.rpc('update_platform_setting_value', {
      target_key: params.key,
      target_value_json: JSON.stringify(value),
      actor_user_id: request.auth!.userId,
    }).single()
    if (update.error) throw update.error
    const updatedRow = z.object({ key: PlatformSettingKeySchema, value: JsonValueSchema, updated_at: z.string() }).parse(update.data)
    return reply.code(200).send(
      PlatformSettingSchema.parse({ key: updatedRow.key, value: updatedRow.value, updatedAt: updatedRow.updated_at }),
    )
  })

  app.get('/v1/publishing-providers', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const service = supabaseClients.forService()
    const [configurations, secrets] = await Promise.all([
      service.from('publishing_provider_configurations').select('provider, client_id, graph_version, updated_at').order('provider'),
      service.from('publishing_provider_secrets').select('provider'),
    ])
    if (configurations.error) throw configurations.error
    if (secrets.error) throw secrets.error
    const secretProviders = new Set(secrets.data.map((row) => row.provider as string))
    return reply.code(200).send(configurations.data.map((row) => PublishingProviderConfigurationSchema.parse({
      provider: row.provider, clientId: row.client_id, graphVersion: row.graph_version,
      hasSecret: secretProviders.has(row.provider as string), updatedAt: row.updated_at,
    })))
  })

  app.put('/v1/publishing-providers/:provider', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return
    if (!(await requirePlatformAdmin(request, reply))) return
    const params = z.object({ provider: PublishingProviderSchema }).parse(request.params)
    const input = UpdatePublishingProviderConfigurationRequestSchema.parse(request.body)
    const secretBox = createSecretBoxFromEnvironment(environment)
    const sealed = secretBox.seal(input.clientSecret, `publishing-provider:${params.provider}`)
    const service = supabaseClients.forService()
    // Die beiden Tabellen muessen gemeinsam wechseln. Zwei PostgREST-Aufrufe könnten bei einem
    // Fehler Client-ID und Secret aus unterschiedlichen Versionen hinterlassen.
    const configuration = await service.rpc('upsert_publishing_provider_configuration', {
      target_provider: params.provider,
      target_client_id: input.clientId,
      target_graph_version: input.graphVersion ?? null,
      target_client_secret_ciphertext: ciphertextToBytea(sealed.ciphertext),
      target_key_version: sealed.keyVersion,
      actor_user_id: request.auth!.userId,
    }).single()
    if (configuration.error) throw configuration.error
    const configurationRow = z.object({ provider: PublishingProviderSchema, client_id: z.string(), graph_version: z.string().nullable(), updated_at: z.string() }).parse(configuration.data)
    return reply.code(200).send(PublishingProviderConfigurationSchema.parse({
      provider: configurationRow.provider, clientId: configurationRow.client_id, graphVersion: configurationRow.graph_version,
      hasSecret: true, updatedAt: configurationRow.updated_at,
    }))
  })
}
