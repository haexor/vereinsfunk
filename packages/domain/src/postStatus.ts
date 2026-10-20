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
