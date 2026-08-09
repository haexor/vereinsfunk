// Paket 016: Auswertung: interne Kennzahlen. Reine Rechenfunktionen -- die API laedt die
// Rohzeilen (post_status_events, approval_decisions, publications, workflow_runs, post_versions,
// posts) fuer den angefragten Zeitraum einmal und reicht sie hier durch. Kein metrics_daily/
// metrics_by_preset_daily: siehe plans/016-auswertung-interne-kennzahlen.md, Abschnitt
// "Abweichungen vom Plan", Punkt 4.

export interface MetricsWindow {
  startUtc: string // inklusiv, ISO 8601
  endUtc: string // exklusiv, ISO 8601
}

// Zwei Durchlaeufe gegeneinander verrechnet, identisches Verfahren wie
// packages/integrations/src/icalTransport.ts (zonedWallTimeToUtcMs) -- hier lokal dupliziert statt
// importiert, weil packages/domain keine Abhaengigkeit zu packages/integrations hat und ein
// einzelner kleiner Zeitzonen-Helfer keine neue Paketabhaengigkeit rechtfertigt.
function offsetAtInstant(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(instantMs))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asIfUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asIfUtcMs - instantMs
}

function zonedWallTimeToUtcMs(year: number, month: number, day: number, timeZone: string): number {
  const utcGuessMs = Date.UTC(year, month - 1, day, 0, 0, 0)
  const firstPassMs = utcGuessMs - offsetAtInstant(utcGuessMs, timeZone)
  return utcGuessMs - offsetAtInstant(firstPassMs, timeZone)
}

// .slice() statt .split('-').map(Number): Destrukturieren aus einem Array-Rueckgabewert waere unter
// noUncheckedIndexedAccess "number | undefined", obwohl das Format durch den Aufrufer (ISO-Datum)
// feststeht.
function parseDayParts(day: string): { year: number; month: number; date: number } {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), date: Number(day.slice(8, 10)) }
}

// Tagesgrenzen liegen in der Vereinszeitzone (organizations.timezone), nicht in UTC -- sonst
// verschiebt sich bei einem Verein in Europe/Berlin jeder Abendbeitrag um bis zu zwei Stunden ueber
// die Tagesgrenze (Plan, Abschnitt "Datenmodell"). date+1 als Tagesargument ist bewusst kein Bug:
// Date.UTC normalisiert einen ueberlaufenden Tag automatisch in den Folgemonat.
export function dayWindow(day: string, timezone: string): MetricsWindow {
  const { year, month, date } = parseDayParts(day)
  return {
    startUtc: new Date(zonedWallTimeToUtcMs(year, month, date, timezone)).toISOString(),
    endUtc: new Date(zonedWallTimeToUtcMs(year, month, date + 1, timezone)).toISOString(),
  }
}

export function rangeWindow(fromDay: string, toDayExclusive: string, timezone: string): MetricsWindow {
  const from = parseDayParts(fromDay)
  const to = parseDayParts(toDayExclusive)
  return {
    startUtc: new Date(zonedWallTimeToUtcMs(from.year, from.month, from.date, timezone)).toISOString(),
    endUtc: new Date(zonedWallTimeToUtcMs(to.year, to.month, to.date, timezone)).toISOString(),
  }
}

export function isInWindow(occurredAtIso: string, window: MetricsWindow): boolean {
  return occurredAtIso >= window.startUtc && occurredAtIso < window.endUtc
}

// Kalenderarithmetik auf den Tages-Labels, keine Instanz-Arithmetik -- "ein Tag mehr" ist
// zeitzonenunabhaengig eindeutig, anders als "24 Stunden mehr" an einem Tag mit Zeitumstellung.
export function addDays(day: string, delta: number): string {
  const { year, month, date } = parseDayParts(day)
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10)
}

export function daysBetween(fromDay: string, toDay: string): number {
  const from = parseDayParts(fromDay)
  const to = parseDayParts(toDay)
  return Math.round((Date.UTC(to.year, to.month - 1, to.date) - Date.UTC(from.year, from.month - 1, from.date)) / 86_400_000)
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

// null statt 0 %, wenn die Vorperiode leer oder nicht vorhanden ist -- der bisherige Code behauptet
// Trends ohne jede Grundlage, das darf nicht durch eine korrekt gerechnete, aber unbelastbare Zahl
// ersetzt werden (Plan, Abschnitt "Metrikdefinitionen"). Ob eine Vorperiode ueberhaupt VOLLSTAENDIG
// ist (nicht vor dem Messbeginn des Vereins beginnt), entscheidet die aufrufende Stelle.
export function computeTrend(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return (current - previous) / previous
}

export interface PostCreatedInput {
  id: string
  createdAt: string
}

// to_status='published'-Ereignisse: unbegrenzt in der Zeit uebergeben (nicht auf das Fenster
// vorgefiltert), weil "erster Uebergang nach published" (Plan, Abschnitt "Metrikdefinitionen") die
// gesamte Historie eines Beitrags braucht, nicht nur den angefragten Zeitraum.
export interface PublishedTransitionInput {
  postId: string
  occurredAt: string
}

export interface ApprovalDecisionInput {
  decision: 'approved' | 'changes_requested' | 'rejected'
  createdAt: string
}

export interface PublicationStatusInput {
  status: string
  updatedAt: string
}

export interface WorkflowRunInput {
  technicalStatus: string
  updatedAt: string
}

export interface PostVersionInput {
  postId: string
  versionNumber: number
}

export interface CountMetrics {
  postsCreated: number
  postsPublished: number
  publicationsPublished: number
  publicationsFailed: number
  approvalsGranted: number
  approvalsChangesRequested: number
  approvalsRejected: number
  revisionsSum: number
  revisionsCount: number
  workflowRuns: number
  workflowFailures: number
}

export interface ComputeCountMetricsInput {
  window: MetricsWindow
  postsCreated: readonly PostCreatedInput[]
  publishedTransitions: readonly PublishedTransitionInput[]
  approvalDecisions: readonly ApprovalDecisionInput[]
  publications: readonly PublicationStatusInput[]
  workflowRuns: readonly WorkflowRunInput[]
  postVersions: readonly PostVersionInput[]
}

function firstOccurrenceByPost(events: readonly PublishedTransitionInput[]): Map<string, string> {
  const first = new Map<string, string>()
  for (const event of events) {
    const existing = first.get(event.postId)
    if (existing === undefined || event.occurredAt < existing) first.set(event.postId, event.occurredAt)
  }
  return first
}

// Ein Beitrag auf zwei Kanaelen zaehlt einmal als Beitrag (postsPublished, ueber post_status_events)
// und zweimal als Publikation (publicationsPublished, ueber publications) -- Plan, Abschnitt
// "Metrikdefinitionen". "Freigabequote"/"Aenderungsquote" zaehlen auf Ebene der einzelnen
// Entscheidung (approval_decisions), nicht der mehrstufigen Anfrage -- Abweichung 8 im Plan.
export function computeCountMetrics(input: ComputeCountMetricsInput): CountMetrics {
  const inWindow = (iso: string) => isInWindow(iso, input.window)

  const postsCreated = input.postsCreated.filter((post) => inWindow(post.createdAt)).length

  const firstPublishedAt = firstOccurrenceByPost(input.publishedTransitions)
  const postsPublishedThisWindow = [...firstPublishedAt.entries()].filter(([, occurredAt]) => inWindow(occurredAt))

  const approvalsGranted = input.approvalDecisions.filter((decision) => decision.decision === 'approved' && inWindow(decision.createdAt)).length
  const approvalsChangesRequested = input.approvalDecisions.filter((decision) => decision.decision === 'changes_requested' && inWindow(decision.createdAt)).length
  const approvalsRejected = input.approvalDecisions.filter((decision) => decision.decision === 'rejected' && inWindow(decision.createdAt)).length

  const publicationsPublished = input.publications.filter((publication) => publication.status === 'published' && inWindow(publication.updatedAt)).length
  const publicationsFailed = input.publications.filter((publication) => publication.status === 'failed' && inWindow(publication.updatedAt)).length

  const workflowRunsInWindow = input.workflowRuns.filter((run) => inWindow(run.updatedAt))
  const workflowFailures = workflowRunsInWindow.filter((run) => run.technicalStatus === 'failed').length

  // Ueberarbeitungen: Mittelwert der hoechsten version_number je VEROEFFENTLICHTEM Beitrag (Plan) --
  // als Summe+Anzahl statt als vorberechnetem Mittelwert, damit ein Aufrufer mehrere Fenster korrekt
  // zu einem groesseren Mittelwert zusammenfassen kann, ohne einen Mittelwert von Mittelwerten zu
  // bilden.
  const maxVersionByPost = new Map<string, number>()
  for (const version of input.postVersions) {
    const current = maxVersionByPost.get(version.postId) ?? 0
    if (version.versionNumber > current) maxVersionByPost.set(version.postId, version.versionNumber)
  }
  let revisionsSum = 0
  let revisionsCount = 0
  for (const [postId] of postsPublishedThisWindow) {
    const maxVersion = maxVersionByPost.get(postId)
    if (maxVersion !== undefined) {
      revisionsSum += maxVersion
      revisionsCount += 1
    }
  }

  return {
    postsCreated,
    postsPublished: postsPublishedThisWindow.length,
    publicationsPublished,
    publicationsFailed,
    approvalsGranted,
    approvalsChangesRequested,
    approvalsRejected,
    revisionsSum,
    revisionsCount,
    workflowRuns: workflowRunsInWindow.length,
    workflowFailures,
  }
}

// Zeitreihen-Variante von computeCountMetrics: der API-Handler rief bislang computeCountMetrics()
// einmal je Bucket mit der VOLLEN Rohmenge auf (bis zu 733 Buckets bei 732 Tagen Granularitaet
// "day") -- jeder Aufruf filterte alle Arrays neu und baute firstOccurrenceByPost/maxVersionByPost
// erneut ueber die gesamte Historie auf, macht die Bucket-Schleife quadratisch (CodeRabbit-Fund zu
// PR #28). Sortiert hier jede Rohtabelle einmal und laesst einen gemeinsam vorrueckenden Zeiger je
// Fenster weiterlaufen -- O(Ereignisse * log Ereignisse + Buckets) statt O(Buckets * Ereignisse).
// Voraussetzung: windows ist aufsteigend sortiert und luckenlos (windows[i].endUtc ===
// windows[i+1].startUtc), wie es rangeWindow(bucketStarts[i], bucketStarts[i+1]) im Aufrufer liefert
// -- mit einer anderen Fensterliste ist das Ergebnis falsch.
export function computeCountMetricsSeries(windows: readonly MetricsWindow[], input: Omit<ComputeCountMetricsInput, 'window'>): CountMetrics[] {
  if (windows.length === 0) return []
  for (let i = 1; i < windows.length; i++) {
    if ((windows[i] as MetricsWindow).startUtc !== (windows[i - 1] as MetricsWindow).endUtc) {
      throw new Error('computeCountMetricsSeries: windows must be ascending and contiguous')
    }
  }
  const firstWindowStart = (windows[0] as MetricsWindow).startUtc

  function bucketCounts<T>(items: readonly T[], timestampOf: (item: T) => string, matches: (item: T) => boolean): number[] {
    const timestamps = items.filter(matches).map(timestampOf).sort()
    let idx = 0
    while (idx < timestamps.length && (timestamps[idx] as string) < firstWindowStart) idx++
    return windows.map((window) => {
      let count = 0
      while (idx < timestamps.length && (timestamps[idx] as string) < window.endUtc) {
        count++
        idx++
      }
      return count
    })
  }

  const postsCreatedCounts = bucketCounts(input.postsCreated, (post) => post.createdAt, () => true)
  const approvalsGrantedCounts = bucketCounts(input.approvalDecisions, (decision) => decision.createdAt, (decision) => decision.decision === 'approved')
  const approvalsChangesRequestedCounts = bucketCounts(input.approvalDecisions, (decision) => decision.createdAt, (decision) => decision.decision === 'changes_requested')
  const approvalsRejectedCounts = bucketCounts(input.approvalDecisions, (decision) => decision.createdAt, (decision) => decision.decision === 'rejected')
  const publicationsPublishedCounts = bucketCounts(input.publications, (publication) => publication.updatedAt, (publication) => publication.status === 'published')
  const publicationsFailedCounts = bucketCounts(input.publications, (publication) => publication.updatedAt, (publication) => publication.status === 'failed')
  const workflowRunsCounts = bucketCounts(input.workflowRuns, (run) => run.updatedAt, () => true)
  const workflowFailuresCounts = bucketCounts(input.workflowRuns, (run) => run.updatedAt, (run) => run.technicalStatus === 'failed')

  // postsPublished/revisions haengen an EINEM Zeitpunkt je Beitrag (erster published-Uebergang),
  // nicht an jedem Rohereignis -- Erstauftreten einmal bestimmen (wie computeCountMetrics), danach
  // denselben Zeiger-Trick auf der viel kleineren Liste "ein Eintrag je veroeffentlichtem Beitrag"
  // anwenden statt auf der vollen Transitions-Rohmenge.
  const firstPublishedAt = firstOccurrenceByPost(input.publishedTransitions)
  const maxVersionByPost = new Map<string, number>()
  for (const version of input.postVersions) {
    const current = maxVersionByPost.get(version.postId) ?? 0
    if (version.versionNumber > current) maxVersionByPost.set(version.postId, version.versionNumber)
  }
  const publishedEntries = [...firstPublishedAt.entries()].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))
  let publishedIdx = 0
  while (publishedIdx < publishedEntries.length && (publishedEntries[publishedIdx] as [string, string])[1] < firstWindowStart) publishedIdx++
  const postsPublishedCounts: number[] = []
  const revisionsSumCounts: number[] = []
  const revisionsCountCounts: number[] = []
  for (const window of windows) {
    let published = 0
    let revisionsSum = 0
    let revisionsCount = 0
    while (publishedIdx < publishedEntries.length && (publishedEntries[publishedIdx] as [string, string])[1] < window.endUtc) {
      const [postId] = publishedEntries[publishedIdx] as [string, string]
      published++
      const maxVersion = maxVersionByPost.get(postId)
      if (maxVersion !== undefined) {
        revisionsSum += maxVersion
        revisionsCount++
      }
      publishedIdx++
    }
    postsPublishedCounts.push(published)
    revisionsSumCounts.push(revisionsSum)
    revisionsCountCounts.push(revisionsCount)
  }

  return windows.map((_, index) => ({
    postsCreated: postsCreatedCounts[index] as number,
    postsPublished: postsPublishedCounts[index] as number,
    publicationsPublished: publicationsPublishedCounts[index] as number,
    publicationsFailed: publicationsFailedCounts[index] as number,
    approvalsGranted: approvalsGrantedCounts[index] as number,
    approvalsChangesRequested: approvalsChangesRequestedCounts[index] as number,
    approvalsRejected: approvalsRejectedCounts[index] as number,
    revisionsSum: revisionsSumCounts[index] as number,
    revisionsCount: revisionsCountCounts[index] as number,
    workflowRuns: workflowRunsCounts[index] as number,
    workflowFailures: workflowFailuresCounts[index] as number,
  }))
}

// Durchlaufzeit: Median der Dauer vom ersten draft (posts.created_at) bis zum ersten published, nur
// fuer Beitraege, deren erster published-Uebergang ins Fenster faellt (Plan, Abschnitt
// "Metrikdefinitionen"). Ergebnis in Sekunden, unsortiert -- median() sortiert selbst.
export function leadTimeSecondsSamples(
  window: MetricsWindow,
  posts: readonly PostCreatedInput[],
  publishedTransitions: readonly PublishedTransitionInput[],
): number[] {
  const firstPublishedAt = firstOccurrenceByPost(publishedTransitions)
  const createdAtByPost = new Map(posts.map((post) => [post.id, post.createdAt] as const))
  const samples: number[] = []
  for (const [postId, publishedAt] of firstPublishedAt) {
    if (!isInWindow(publishedAt, window)) continue
    const createdAt = createdAtByPost.get(postId)
    if (createdAt === undefined) continue
    const seconds = (new Date(publishedAt).getTime() - new Date(createdAt).getTime()) / 1000
    if (seconds >= 0) samples.push(seconds)
  }
  return samples
}

export interface StatusTransitionInput {
  postId: string
  toStatus: string
  occurredAt: string
}

// Freigabedauer: Median von "awaiting_approval erreicht" bis zur naechsten Aufloesung
// (approved/changes_requested) desselben Beitrags -- aus der Statushistorie, nicht aus
// approval_stages: eine mehrstufige Route (Paket 011) kann mehrere Stufen mit je eigener Frist
// haben, aber genau einen Uebergang aus awaiting_approval heraus, sobald die ganze Route
// abgeschlossen ist. Nur die naechste Aufloesung NACH einem awaiting_approval-Uebergang zaehlt --
// ein erneutes awaiting_approval (z. B. nach Aenderungswunsch und neuer Version) oeffnet ein neues
// Paar.
export function approvalDurationSecondsSamples(window: MetricsWindow, transitions: readonly StatusTransitionInput[]): number[] {
  const relevant = transitions.filter(
    (transition) => transition.toStatus === 'awaiting_approval' || transition.toStatus === 'approved' || transition.toStatus === 'changes_requested',
  )
  const byPost = new Map<string, StatusTransitionInput[]>()
  for (const transition of relevant) {
    const list = byPost.get(transition.postId) ?? []
    list.push(transition)
    byPost.set(transition.postId, list)
  }

  const samples: number[] = []
  for (const list of byPost.values()) {
    const sorted = [...list].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0))
    let openedAt: string | null = null
    for (const transition of sorted) {
      if (transition.toStatus === 'awaiting_approval') {
        openedAt = transition.occurredAt
      } else if (openedAt !== null) {
        if (isInWindow(transition.occurredAt, window)) {
          const seconds = (new Date(transition.occurredAt).getTime() - new Date(openedAt).getTime()) / 1000
          if (seconds >= 0) samples.push(seconds)
        }
        openedAt = null
      }
    }
  }
  return samples
}

export const funnelStages = ['draft', 'approval_requested', 'approved', 'scheduled', 'published'] as const
export type FunnelStage = (typeof funnelStages)[number]

export interface FunnelStageCount {
  stage: FunnelStage
  count: number
}

const FUNNEL_STATUS_BY_STAGE: Record<Exclude<FunnelStage, 'draft'>, string> = {
  approval_requested: 'awaiting_approval',
  approved: 'approved',
  scheduled: 'scheduled',
  published: 'published',
}

// "Entwurf" zaehlt posts.created_at, jede weitere Stufe den ERSTEN Uebergang des Beitrags auf den
// jeweiligen Status im Fenster -- ein spaeter erneut geplanter oder erneut veroeffentlichter
// Beitrag (Verlegung, Retry) zaehlt in dieser Stufe kein zweites Mal. Konsequenz derselben Regel
// (adversariale Pruefung, informativ statt Fehler): ein Beitrag, der VOR dem Fenster zum ersten
// Mal in awaiting_approval eintrat, per Aenderungswunsch zurueckging und ERST innerhalb des
// Fensters erneut in awaiting_approval eintrat, zaehlt in der Stufe "Freigabe angefragt" fuer
// dieses Fenster nicht ein zweites Mal -- konsistent mit dem "erstes Auftreten"-Prinzip, das auch
// postsPublished trägt, aber je nach Erwartung ueberraschend.
export function computeFunnel(window: MetricsWindow, posts: readonly PostCreatedInput[], transitions: readonly StatusTransitionInput[]): readonly FunnelStageCount[] {
  const draftCount = posts.filter((post) => isInWindow(post.createdAt, window)).length
  const countFirstOccurrencesOfStatus = (status: string): number => {
    const first = new Map<string, string>()
    for (const transition of transitions) {
      if (transition.toStatus !== status) continue
      const existing = first.get(transition.postId)
      if (existing === undefined || transition.occurredAt < existing) first.set(transition.postId, transition.occurredAt)
    }
    return [...first.values()].filter((occurredAt) => isInWindow(occurredAt, window)).length
  }
  return [
    { stage: 'draft', count: draftCount },
    ...(Object.entries(FUNNEL_STATUS_BY_STAGE) as [Exclude<FunnelStage, 'draft'>, string][]).map(([stage, status]) => ({
      stage,
      count: countFirstOccurrencesOfStatus(status),
    })),
  ]
}
