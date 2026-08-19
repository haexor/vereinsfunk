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

// Die Status, aus denen heraus ein Beitrag noch veraendert werden darf: die drei Quellstatus von
// request_approval() plus die generierenden Zustaende davor. Ab awaiting_approval ist Schluss --
// eine eingereichte, freigegebene oder veroeffentlichte Fassung darf keine Bearbeitung mehr sehen.
// Bewusst hier statt je Aufrufer neu aufgezaehlt: dieselbe Grenze wird an mehreren Stellen
// gebraucht (POST /v1/post-media/:id/style-render) und muss beim Ergaenzen eines Status an einer
// einzigen Stelle nachgezogen werden. Die SQL-Seite (request_approval, apply_image_style_render)
// fuehrt notgedrungen eine eigene Kopie -- deren Kommentare verweisen hierher.
export const editablePostStatuses: readonly PostStatus[] = [
  'draft',
  'facts_required',
  'generating',
  'draft_ready',
  'render_queued',
  'rendering',
  'changes_requested',
]

export function isPostEditable(status: PostStatus): boolean {
  return editablePostStatuses.includes(status)
}
