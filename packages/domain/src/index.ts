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
