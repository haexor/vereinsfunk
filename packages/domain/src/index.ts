export const postStatuses = [
  'draft',
  'facts_required',
  'generating',
  'draft_ready',
  'render_queued',
  'rendering',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'cancelled',
] as const

export type PostStatus = (typeof postStatuses)[number]

export const allowedTransitions: Readonly<Record<PostStatus, readonly PostStatus[]>> = {
  draft: ['facts_required', 'generating', 'cancelled'],
  facts_required: ['generating', 'cancelled'],
  generating: ['draft_ready', 'failed'],
  draft_ready: ['render_queued', 'awaiting_approval', 'cancelled'],
  render_queued: ['rendering', 'failed', 'cancelled'],
  rendering: ['awaiting_approval', 'failed'],
  awaiting_approval: ['changes_requested', 'approved', 'cancelled'],
  changes_requested: ['generating', 'draft_ready', 'cancelled'],
  approved: ['scheduled', 'publishing', 'cancelled'],
  scheduled: ['publishing', 'cancelled'],
  publishing: ['published', 'partially_published', 'failed'],
  published: [],
  partially_published: ['publishing', 'failed'],
  failed: ['generating', 'render_queued', 'publishing', 'cancelled'],
  cancelled: [],
}

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return allowedTransitions[from].includes(to)
}

export function assertTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransition(from, to)) throw new Error(`Invalid post transition: ${from} -> ${to}`)
}

export interface EffectiveConfig {
  tone?: string
  goals?: readonly string[]
  hashtags?: readonly string[]
  policies: {
    approvalRequired: boolean
    minorApprovalRequired: boolean
    minimumApprovals: number
    forbiddenTopics: readonly string[]
  }
}

export type ConfigOverride = Partial<Omit<EffectiveConfig, 'policies'>> & {
  policies?: Partial<EffectiveConfig['policies']>
}

export function mergeEffectiveConfig(
  base: EffectiveConfig,
  ...overrides: readonly ConfigOverride[]
): EffectiveConfig {
  return overrides.reduce<EffectiveConfig>((current, override) => {
    const policies = override.policies
    return {
      ...current,
      ...override,
      policies: {
        approvalRequired:
          current.policies.approvalRequired || policies?.approvalRequired === true,
        minorApprovalRequired:
          current.policies.minorApprovalRequired || policies?.minorApprovalRequired === true,
        minimumApprovals: Math.max(
          current.policies.minimumApprovals,
          policies?.minimumApprovals ?? current.policies.minimumApprovals,
        ),
        forbiddenTopics: Array.from(
          new Set([...current.policies.forbiddenTopics, ...(policies?.forbiddenTopics ?? [])]),
        ),
      },
    }
  }, base)
}

export function createIdempotencyKey(
  kind: 'submission' | 'draft' | 'render' | 'approval' | 'publish',
  ...parts: readonly (string | number)[]
): string {
  if (parts.some((part) => String(part).includes(':'))) {
    throw new Error('Idempotency key parts must not contain colons')
  }
  return [kind, ...parts].join(':')
}

export type MediaGateInput = {
  scanStatus: 'pending' | 'clean' | 'failed'
  facesConfirmedComplete: boolean
  hasOriginalSelected: boolean
  derivativeCurrent: boolean
  faces: readonly { subjectKind: 'adult' | 'minor' | 'unknown'; decision: 'pending' | 'consented' | 'obscure' | 'exclude'; consentValid?: boolean | undefined }[]
  minorReviewConfirmed: boolean
}

export function evaluateMediaGate(input: MediaGateInput): { publishable: boolean; blockers: Array<'scan_pending' | 'face_pending' | 'consent_invalid' | 'derivative_stale' | 'minor_review_required' | 'original_selected'> } {
  const blockers: Array<'scan_pending' | 'face_pending' | 'consent_invalid' | 'derivative_stale' | 'minor_review_required' | 'original_selected'> = []
  if (input.scanStatus !== 'clean') blockers.push('scan_pending')
  if (!input.facesConfirmedComplete || input.faces.some((face) => face.decision === 'pending')) blockers.push('face_pending')
  if (input.faces.some((face) => face.decision === 'consented' && !face.consentValid)) blockers.push('consent_invalid')
  if (!input.derivativeCurrent) blockers.push('derivative_stale')
  if (input.hasOriginalSelected) blockers.push('original_selected')
  if (input.faces.some((face) => face.subjectKind === 'minor') && !input.minorReviewConfirmed) blockers.push('minor_review_required')
  return { publishable: blockers.length === 0, blockers }
}

export interface CuratedFontPairing {
  key: string
  displayFontKey: string
  bodyFontKey: string
  label: string
}

// Mirrors the fonts nuxt.config.ts actually loads today. Offering a pairing the app cannot
// yet render would be a fabricated choice; Paket 013 adds self-hosted uploads and more pairs.
export const curatedFontPairings: readonly CuratedFontPairing[] = [
  { key: 'manrope_dm_sans', displayFontKey: 'manrope', bodyFontKey: 'dm_sans', label: 'Manrope / DM Sans' },
]

export function assertApprovalSnapshot(input: MediaGateInput, derivativeHashes: readonly string[]): void {
  const gate = evaluateMediaGate(input)
  if (!gate.publishable) throw new Error(`Media approval is blocked: ${gate.blockers.join(',')}`)
  if (derivativeHashes.length === 0 || derivativeHashes.some((hash) => !/^[a-f0-9]{64}$/i.test(hash))) throw new Error('Approval requires immutable derivative hashes')
}

export interface LlmProviderConfiguration {
  id: string
  protocol: 'anthropic' | 'openai'
  purpose: string
  priority: number
  isActive: boolean
}

// Kein echter LLM-Aufruf existiert im Repository (siehe Plan 021), deshalb bewusst ohne
// Retry-bei-Fehlschlag-Logik -- dafuer gibt es noch keinen Aufrufer, den man testen koennte.
export function selectProviderConfiguration(
  purpose: string,
  configs: readonly LlmProviderConfiguration[],
): LlmProviderConfiguration | null {
  const active = configs.filter((config) => config.isActive)
  const exactMatch = active.filter((config) => config.purpose === purpose)
  const candidates = exactMatch.length > 0 ? exactMatch : active.filter((config) => config.purpose === 'default')
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => a.priority - b.priority)[0]!
}
