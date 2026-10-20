import { z } from 'zod'
import { ContentPresetSlugSchema } from './content.js'
import { UuidSchema } from './primitives.js'

// Product decision (Plan 032, "Kuratierte und selbst angelegte Persona"): style profiles may
// name and imitate a real person (curated persona shipped by the platform, or custom persona an
// org creates itself). Safety is organisational -- who gets the poster/approver role, and the
// existing approval routes (Plan 011/024) -- not a keyword filter, which cannot reliably detect
// intent anyway. additionalInstructions stays bounded and low-priority in prompt assembly so it
// can never override grounding/safety/platform rules (see ADR-010), independent of this decision.
const StyleProfileInstructionSchema = z.string().trim().max(1_000)
// Plan 040: replaces the earlier dial-shaped rules (sentenceLength/energy/humour/formality/
// perspective/bannedPhrases) with a character model that is easier to fill in for a named
// persona ("im Stil von Zlatan Ibrahimović") than an abstract 1-5 energy scale. bannedPhrases is
// retired without replacement -- avoidRules (below) already covers the same "don't say this"
// concept, so the two no longer overlap.
export const StyleProfileExampleSchema = z.object({
  input: z.string().trim().max(300),
  output: z.string().trim().max(1_500),
})
// Shared by the Zod bound below and the "Beispiel hinzufügen" button's disabled state
// (StyleProfileEditorForm.vue) so the UI cap can't silently drift from what the API accepts.
export const STYLE_PROFILE_MAX_EXAMPLES = 5
export const StyleProfileRulesSchema = z.object({
  toneTags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  catchphrases: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  examples: z.array(StyleProfileExampleSchema).max(STYLE_PROFILE_MAX_EXAMPLES).default([]),
  additionalInstructions: StyleProfileInstructionSchema.default(''),
}).strict()
// Shared bound for avoidRules/doRules, both database-backed columns with the identical
// text_array_elements_within_length(value, 160)/cardinality <= 30 CHECK (see
// 2026081003_text_workshop_foundation.sql and 2026081304_style_profile_character_model.sql).
const StyleProfileRuleListSchema = z.array(z.string().trim().min(1).max(160)).max(30)
// The shape composition_sessions.style_profile_snapshot/post_generation_provenance.
// style_profile_snapshot are frozen into (apps/api/src/routes/content.ts) and read back out of
// (apps/worker/src/context.ts, apps/worker/src/textGeneration.ts) -- one shared schema instead of
// two independently maintained copies of the same shape.
export const StyleProfileSnapshotSchema = z.object({
  name: z.string(),
  description: z.string(),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
})
export const SystemStyleProfileSlugSchema = z.enum([
  'klar_erklaerend', 'warm_gemeinschaftlich', 'lebendig_sportlich', 'leicht_humorvoll', 'feierlich_wertschaetzend',
])
// Die fuenf Systemmodi werden per Slug referenziert; ein eigenes Profil oder eine Persona mit
// gleichem Slug waere bei der Auswahl nicht mehr unterscheidbar.
function rejectReservedSlug(slug: string | undefined, context: z.RefinementCtx): void {
  if (slug !== undefined && (SystemStyleProfileSlugSchema.options as readonly string[]).includes(slug)) {
    context.addIssue({ code: 'custom', path: ['slug'], message: 'System style profile slugs are reserved' })
  }
}
export const StyleProfileScopeSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable(),
  teamId: UuidSchema.nullable(),
}).superRefine((scope, context) => {
  if (scope.teamId && !scope.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
})
export const CustomStyleProfileSchema = StyleProfileScopeSchema.extend({
  id: UuidSchema,
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.literal('custom'),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const CreateCustomStyleProfileRequestSchema = z.object({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
}).superRefine((profile, context) => {
  if (profile.teamId && !profile.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
  rejectReservedSlug(profile.slug, context)
})
// Plan 037: a platform-admin-curated, global persona catalogue -- no organization_id, no
// composite foreign key (see platform_style_personas migration). Referenced by slug only, frozen
// into composition_sessions.style_profile_snapshot exactly like the five hardcoded system modes.
export const PlatformStylePersonaSchema = z.object({
  id: UuidSchema,
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
  isActive: z.boolean(),
  createdBy: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export const CreatePlatformStylePersonaRequestSchema = z.object({
  slug: ContentPresetSlugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
}).superRefine((persona, context) => rejectReservedSlug(persona.slug, context))
// Persona und Stilprofil aendern dieselben Felder. Der Scope (organizationId/departmentId/teamId)
// gehoert bewusst nicht dazu -- er ist unveraenderlich, PATCH /v1/content-style-profiles/:id leitet
// ihn aus der bestehenden Zeile her.
const UpdateStyleProfileRequestSchema = z.object({
  slug: ContentPresetSlugSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  styleRules: StyleProfileRulesSchema.optional(),
  avoidRules: StyleProfileRuleListSchema.optional(),
  doRules: StyleProfileRuleListSchema.optional(),
  isActive: z.boolean().optional(),
}).superRefine((profile, context) => {
  rejectReservedSlug(profile.slug, context)
  if (Object.values(profile).every((value) => value === undefined)) {
    context.addIssue({ code: 'custom', message: 'At least one field must be provided' })
  }
})
export const UpdatePlatformStylePersonaRequestSchema = UpdateStyleProfileRequestSchema
export const UpdateCustomStyleProfileRequestSchema = UpdateStyleProfileRequestSchema
// Plan 040: "Persona/Stilprofil testen" calls the active text provider directly and
// synchronously -- no session/candidate row, no preset. sampleInput plays the role a preset's
// sourceMaterial normally plays (a single allowedClaim); there is no communicationGoal/preset
// here, so previewStyleProfile (apps/api/src/routes/shared.ts) fills those in with fixed values.
const StyleProfilePreviewCoreSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  styleRules: StyleProfileRulesSchema,
  avoidRules: StyleProfileRuleListSchema,
  doRules: StyleProfileRuleListSchema,
  sampleInput: z.string().trim().min(1).max(300),
})
export const PreviewPlatformStylePersonaRequestSchema = StyleProfilePreviewCoreSchema
export const PreviewCustomStyleProfileRequestSchema = StyleProfilePreviewCoreSchema.extend({
  organizationId: UuidSchema,
  departmentId: UuidSchema.nullable().optional(),
  teamId: UuidSchema.nullable().optional(),
}).superRefine((profile, context) => {
  if (profile.teamId && !profile.departmentId) context.addIssue({ code: 'custom', message: 'teamId requires departmentId' })
})
// "System-Prompt anzeigen": same request shape as the preview above (it needs the exact same
// draft state to build the prompt), but the response is the assembled prompt text instead of a
// generated post -- no provider call, no cost, so this is a pure, side-effect-free readback.
export const StyleProfilePromptPreviewSchema = z.object({ system: z.string(), user: z.string() })

export type StyleProfileExample = z.infer<typeof StyleProfileExampleSchema>
export type StyleProfileRules = z.infer<typeof StyleProfileRulesSchema>
export type StyleProfilePromptPreview = z.infer<typeof StyleProfilePromptPreviewSchema>
export type StyleProfileSnapshot = z.infer<typeof StyleProfileSnapshotSchema>
export type CustomStyleProfile = z.infer<typeof CustomStyleProfileSchema>
export type CreateCustomStyleProfileRequest = z.infer<typeof CreateCustomStyleProfileRequestSchema>
export type PlatformStylePersona = z.infer<typeof PlatformStylePersonaSchema>
export type CreatePlatformStylePersonaRequest = z.infer<typeof CreatePlatformStylePersonaRequestSchema>
export type UpdatePlatformStylePersonaRequest = z.infer<typeof UpdatePlatformStylePersonaRequestSchema>
export type UpdateCustomStyleProfileRequest = z.infer<typeof UpdateCustomStyleProfileRequestSchema>
export type PreviewPlatformStylePersonaRequest = z.infer<typeof PreviewPlatformStylePersonaRequestSchema>
export type PreviewCustomStyleProfileRequest = z.infer<typeof PreviewCustomStyleProfileRequestSchema>
