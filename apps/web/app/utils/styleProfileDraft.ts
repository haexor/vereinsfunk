import { z } from 'zod'
import type { StyleProfileRules } from '@vereinsfunk/contracts'

export interface StyleProfileExampleDraft { input: string; output: string }

// Shared form shape for StyleProfileEditorForm.vue -- list-typed fields (toneTags/catchphrases/
// avoidRules/doRules) are edited as one-per-line text, matching the codebase's existing
// avoidRules/bannedPhrases textarea convention (see the former plattform-admin/personas.vue).
// examples stays a real array (not one-per-line text) since each pair needs two independent,
// differently-bounded fields (input <=300 chars, output <=1500).
export interface StyleProfileDraft {
  name: string
  description: string
  toneTagsText: string
  catchphrasesText: string
  examples: StyleProfileExampleDraft[]
  additionalInstructions: string
  avoidRulesText: string
  doRulesText: string
  sampleInput: string
}

export function emptyStyleProfileDraft(): StyleProfileDraft {
  return {
    name: '',
    description: '',
    toneTagsText: '',
    catchphrasesText: '',
    examples: [],
    additionalInstructions: '',
    avoidRulesText: '',
    doRulesText: '',
    sampleInput: '',
  }
}

function linesToList(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

export function styleRulesFromDraft(draft: StyleProfileDraft): StyleProfileRules {
  return {
    toneTags: linesToList(draft.toneTagsText),
    catchphrases: linesToList(draft.catchphrasesText),
    examples: draft.examples
      .map((example) => ({ input: example.input.trim(), output: example.output.trim() }))
      .filter((example) => example.input || example.output),
    additionalInstructions: draft.additionalInstructions.trim(),
  }
}

export function avoidRulesFromDraft(draft: StyleProfileDraft): string[] {
  return linesToList(draft.avoidRulesText)
}

export function doRulesFromDraft(draft: StyleProfileDraft): string[] {
  return linesToList(draft.doRulesText)
}

export function styleProfileDraftFrom(profile: {
  name: string
  description: string
  styleRules: StyleProfileRules
  avoidRules: readonly string[]
  doRules: readonly string[]
}): StyleProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    toneTagsText: profile.styleRules.toneTags.join('\n'),
    catchphrasesText: profile.styleRules.catchphrases.join('\n'),
    examples: profile.styleRules.examples.map((example) => ({ ...example })),
    additionalInstructions: profile.styleRules.additionalInstructions,
    avoidRulesText: profile.avoidRules.join('\n'),
    doRulesText: profile.doRules.join('\n'),
    sampleInput: '',
  }
}

const PreviewErrorPayloadSchema = z.object({ data: z.object({ error: z.string() }) })

// Maps request-layer error codes (routes/shared.ts, previewStyleProfile) to an honest,
// non-technical message -- "kein lokaler Provider" must read differently from a transient
// provider failure, per the Plan 040 smoke test.
export function previewErrorMessage(error: unknown): string {
  const parsed = PreviewErrorPayloadSchema.safeParse(error)
  const code = parsed.success ? parsed.data.data.error : undefined
  if (code === 'text_provider_not_configured' || code === 'unsupported_provider_configuration') {
    return 'Kein Text-Provider eingerichtet -- ohne Provider-Konfiguration ist kein Testergebnis möglich.'
  }
  if (code === 'rate_limited' || code === 'provider_rate_limit') {
    return 'Zu viele Testanfragen. Bitte kurz warten und erneut versuchen.'
  }
  return 'Der Test ist fehlgeschlagen. Bitte erneut versuchen.'
}
