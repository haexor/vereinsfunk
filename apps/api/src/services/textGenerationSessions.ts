import {
  TEXT_GENERATION_DEFAULT_MAX_CHARACTERS,
  StyleProfileRulesSchema,
  UuidSchema,
  type CreateCompositionSession,
  type StyleProfileRules,
} from '@vereinsfunk/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveScopedEffectiveConfig, resolveTextGenerationPlatformAvailability, resolveTextGenerationProviderConfigurationIds } from '../routes/shared.js'

export const SYSTEM_STYLE_PROFILES: Record<string, { name: string; description: string; styleRules: StyleProfileRules; avoidRules: string[]; doRules: string[] }> = {
  klar_erklaerend: { name: 'Klar erklärend', description: 'Sachlich, verständlich und direkt.', styleRules: { toneTags: ['klar', 'sachlich'], catchphrases: [], examples: [{ input: '3:1 Sieg im Lokalderby, Tore: Müller, Meier, 500 Zuschauer', output: '3:1 gegen den Lokalrivalen. Müller und Meier trafen vor 500 Zuschauern – ein klarer Auftritt unserer Mannschaft.' }], additionalInstructions: '' }, avoidRules: ['Superlative ohne Beleg'], doRules: [] },
  warm_gemeinschaftlich: { name: 'Warm gemeinschaftlich', description: 'Einladend und verbunden.', styleRules: { toneTags: ['warm', 'gemeinschaftlich', 'einladend'], catchphrases: ['unsere Gemeinschaft'], examples: [{ input: 'Vereinsfest am Samstag, alle Abteilungen dabei', output: 'Am Samstag feiern wir gemeinsam – alle Abteilungen unter einem Dach. Schön, dass wir das als Gemeinschaft erleben dürfen.' }], additionalInstructions: '' }, avoidRules: [], doRules: ['Zusammenhalt/Gemeinschaft erwähnen'] },
  lebendig_sportlich: { name: 'Lebendig sportlich', description: 'Aktiv und motivierend.', styleRules: { toneTags: ['lebendig', 'sportlich', 'motivierend'], catchphrases: ['Vollgas'], examples: [{ input: 'Sieg im Auswärtsspiel, 2:0, starke zweite Halbzeit', output: '2:0 auswärts! Nach der Pause volle Power – so geht Einsatz.' }], additionalInstructions: '' }, avoidRules: [], doRules: ['Energie/Tempo im Text spürbar machen'] },
  leicht_humorvoll: { name: 'Leicht humorvoll', description: 'Freundlich mit zurückhaltendem Humor.', styleRules: { toneTags: ['humorvoll', 'freundlich', 'locker'], catchphrases: [], examples: [{ input: 'Trainingsauftakt nach der Sommerpause, alle etwas außer Form', output: 'Nach der Sommerpause ächzten die Beine beim ersten Sprint – aber der Spaß war sofort wieder da.' }], additionalInstructions: '' }, avoidRules: ['Ironie auf Kosten Einzelner'], doRules: [] },
  feierlich_wertschaetzend: { name: 'Feierlich wertschätzend', description: 'Dankbar und respektvoll.', styleRules: { toneTags: ['feierlich', 'dankbar', 'respektvoll'], catchphrases: [], examples: [{ input: '25 Jahre Vereinsmitgliedschaft von Herrn Schmidt', output: 'Seit 25 Jahren trägt Herr Schmidt unseren Verein mit – dafür sagen wir von Herzen Danke.' }], additionalInstructions: '' }, avoidRules: [], doRules: ['Dank/Anerkennung aussprechen'] },
}

type TextGenerationSessionResult =
  | { ok: true; sessionId: string; candidateIds: string[] }
  | { ok: false; statusCode: 404 | 422; error: string; platform?: string }

const SessionMediaAssetSchema = z.object({
  organization_id: UuidSchema,
  department_id: UuidSchema.nullable(),
  // Every production row has a MIME type. The default keeps older narrow test doubles and
  // restored pre-audio records compatible while retaining the conservative visual-media gate.
  mime_type: z.string().min(1).default('image/jpeg'),
  upload_status: z.string(),
  people_reviewed_at: z.string().nullable(),
})

// Ein eigenes Stilprofil ist in einem Scope verwendbar, wenn seine eigene Abteilung bzw. sein
// eigenes Team entweder null (= vereinsweit) ist oder exakt zum angefragten Scope passt.
// createTextGenerationSession unten lehnt alles andere mit style_profile_not_found ab; GET
// /v1/content-style-profiles filtert mit derselben Funktion, damit die Auswahlliste kein Profil
// anbietet, mit dem sich anschliessend keine Sitzung anlegen laesst -- auf Vereinsebene
// (departmentId null) waere das sonst jedes einzelne Abteilungsprofil.
export function isStyleProfileUsableInScope(
  profile: { department_id: string | null; team_id: string | null },
  departmentId: string | null,
  teamId: string | null,
): boolean {
  return (profile.department_id === null || profile.department_id === departmentId)
    && (profile.team_id === null || profile.team_id === teamId)
}

function parseSupabaseData<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const error = new Error('Unexpected Supabase response')
  error.name = 'SupabaseResponseError'
  throw error
}

export async function createTextGenerationSession(
  userClient: SupabaseClient,
  getServiceClient: () => SupabaseClient,
  input: CreateCompositionSession,
  actorUserId: string,
  correlationId: string,
): Promise<TextGenerationSessionResult> {
  if (input.requestedFormats.some((format) => format !== 'text_post')) return { ok: false, statusCode: 422, error: 'text_only_pilot' }
  const mediaAssetIds = input.mediaAssetIds
  const config = await resolveScopedEffectiveConfig(userClient, input.organizationId, input.departmentId, input.teamId ?? null)
  let styleSnapshot: Record<string, unknown>
  const styleProfileId: string | null = input.styleProfileId ?? null
  if (styleProfileId) {
    const row = await userClient.from('content_style_profiles').select('id, name, description, style_rules, avoid_rules, do_rules, department_id, team_id').eq('id', styleProfileId).eq('organization_id', input.organizationId).eq('is_active', true).maybeSingle()
    if (row.error) throw row.error
    if (!row.data || !isStyleProfileUsableInScope(row.data, input.departmentId, input.teamId ?? null)) return { ok: false, statusCode: 404, error: 'style_profile_not_found' }
    styleSnapshot = { name: row.data.name, description: row.data.description, styleRules: StyleProfileRulesSchema.parse(row.data.style_rules), avoidRules: row.data.avoid_rules, doRules: row.data.do_rules }
  } else if (input.personaSlug) {
    const persona = await userClient.from('platform_style_personas').select('name, description, style_rules, avoid_rules, do_rules').eq('slug', input.personaSlug).eq('is_active', true).maybeSingle()
    if (persona.error) throw persona.error
    if (!persona.data) return { ok: false, statusCode: 404, error: 'persona_not_found' }
    styleSnapshot = { name: persona.data.name, description: persona.data.description, styleRules: StyleProfileRulesSchema.parse(persona.data.style_rules), avoidRules: persona.data.avoid_rules, doRules: persona.data.do_rules, slug: input.personaSlug }
  } else {
    const slug = input.systemStyleProfileSlug ?? 'klar_erklaerend'
    const profile = SYSTEM_STYLE_PROFILES[slug]
    if (!profile) return { ok: false, statusCode: 422, error: 'style_profile_not_found' }
    styleSnapshot = { name: profile.name, description: profile.description, styleRules: profile.styleRules, avoidRules: profile.avoidRules, doRules: profile.doRules, slug }
  }
  const sourceMaterial = { ...input.sourceMaterial, doNotMention: Array.from(new Set([...input.sourceMaterial.doNotMention, ...config.policies.forbiddenTopics])) }
  const targetPlatforms = [...input.targetPlatforms].sort()
  // 'plaintext' ist exklusiv (primitives.ts) -- sonst zieht die serverseitige Minimumbildung weiter
  // unten seine grosszuegige Grenze sinnlos auf die knappste andere gewaehlte Plattform herunter.
  if (targetPlatforms.includes('plaintext') && targetPlatforms.length > 1) return { ok: false, statusCode: 422, error: 'platform_combination_not_allowed' }
  const platformAvailability = await resolveTextGenerationPlatformAvailability(userClient, input.organizationId, input.departmentId, input.teamId ?? null, config.policies.allowedChannelIds)
  const unavailablePlatform = targetPlatforms.find((platform) => !platformAvailability.get(platform)?.available)
  if (unavailablePlatform) return { ok: false, statusCode: 422, error: 'platform_not_available', platform: unavailablePlatform }
  const sessionHash = createHash('sha256').update(JSON.stringify({ goal: input.communicationGoal, sourceMaterial, styleSnapshot, sourceRevision: input.sourceRevision, targetPlatforms, maxCharacters: input.maxCharacters ?? null, temperature: input.temperature, mediaAssetIds })).digest('hex')
  const candidateHash = createHash('sha256').update(`${sessionHash}:initial`).digest('hex')
  const serviceClient = getServiceClient()
  for (const mediaAssetId of mediaAssetIds) {
    const asset = await serviceClient.from('media_assets').select('organization_id, department_id, mime_type, upload_status, people_reviewed_at').eq('id', mediaAssetId).maybeSingle()
    if (asset.error) throw asset.error
    const parsedAsset = asset.data === null ? null : parseSupabaseData(SessionMediaAssetSchema, asset.data)
    if (!parsedAsset || parsedAsset.organization_id !== input.organizationId || parsedAsset.department_id !== input.departmentId) return { ok: false, statusCode: 404, error: 'media_asset_not_found' }
    if (parsedAsset.upload_status !== 'ready') return { ok: false, statusCode: 422, error: 'media_asset_not_ready' }
    if ((parsedAsset.mime_type.startsWith('image/') || parsedAsset.mime_type.startsWith('video/')) && parsedAsset.people_reviewed_at === null) return { ok: false, statusCode: 422, error: 'media_asset_not_reviewed' }
  }
  const platformLimits = targetPlatforms.map((platform) => platformAvailability.get(platform)!.maxCharacters).filter((limit): limit is number => limit !== null)
  const resolvedPlatformLimit = platformLimits.length > 0 ? Math.min(...platformLimits) : TEXT_GENERATION_DEFAULT_MAX_CHARACTERS
  const maxCharacters = input.maxCharacters !== undefined ? Math.min(input.maxCharacters, resolvedPlatformLimit) : resolvedPlatformLimit
  const providerConfigurationIds = await resolveTextGenerationProviderConfigurationIds(serviceClient)
  if (providerConfigurationIds.length === 0) return { ok: false, statusCode: 422, error: 'no_active_text_provider' }
  const result = await serviceClient.rpc('create_text_generation_session', {
    p_organization_id: input.organizationId, p_department_id: input.departmentId, p_team_id: input.teamId ?? null,
    p_communication_goal: input.communicationGoal, p_requested_formats: input.requestedFormats, p_source_material: sourceMaterial,
    p_style_profile_id: styleProfileId, p_style_profile_snapshot: styleSnapshot, p_effective_config_snapshot: { config: { goals: config.goals, hashtags: config.hashtags, ...config.policies } },
    p_target_platforms: targetPlatforms, p_max_characters: maxCharacters, p_temperature: input.temperature,
    p_source_revision: input.sourceRevision, p_input_hash: sessionHash, p_candidate_input_hash: candidateHash, p_generation_intent: 'initial', p_revision_instruction: null,
    p_created_by: actorUserId, p_correlation_id: correlationId, p_idempotency_key: `generate-text:${sessionHash}:${input.sourceRevision}`,
    p_provider_configuration_ids: providerConfigurationIds,
  })
  if (result.error) throw result.error
  const created = z.object({ sessionId: UuidSchema, candidateIds: z.array(UuidSchema).min(1) }).parse(result.data)
  if (mediaAssetIds.length > 0) {
    const attach = await serviceClient.from('composition_session_post_media').upsert(
      mediaAssetIds.map((mediaAssetId, position) => ({ organization_id: input.organizationId, composition_session_id: created.sessionId, media_asset_id: mediaAssetId, position, role: position === 0 ? 'primary' : 'slide', created_by: actorUserId })),
      { onConflict: 'composition_session_id,position' },
    )
    if (attach.error) throw attach.error
  }
  return { ok: true, ...created }
}
