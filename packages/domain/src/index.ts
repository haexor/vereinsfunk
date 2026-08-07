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
    // Paket 011: dieselbe Verschaerfungssemantik, um vier weitere Regelfelder erweitert.
    requiredHashtags: readonly string[]
    selfApprovalAllowed: boolean
    allowSameReviewerAcrossStages: boolean
    mediaRequiresConsentCheck: boolean
    // Paket 015: dieselbe OR-Verschaerfung wie mediaRequiresConsentCheck -- sobald irgendeine
    // Ebene "eine Einwilligung endet, wenn die Person den Verein verlaesst" verlangt, gilt das.
    consentExpiresOnLeave: boolean
    // null = keine Einschraenkung auf dieser Ebene, [] = nichts erlaubt. Die haeufigste
    // Fehlerquelle dieser Bauform (Plan 011, "Vererbung: eine Richtung").
    allowedPresets: readonly string[] | null
    allowedFormats: readonly string[] | null
    allowedChannelIds: readonly string[] | null
  }
}

export type ConfigOverride = Partial<Omit<EffectiveConfig, 'policies'>> & {
  policies?: Partial<EffectiveConfig['policies']>
}

function mergeAllowedList(
  current: readonly string[] | null,
  next: readonly string[] | null | undefined,
): readonly string[] | null {
  // undefined (Feld auf dieser Ebene gar nicht gesetzt) und null (Ebene schraenkt nicht ein)
  // verhalten sich hier identisch: beide sind ein No-op fuer den Merge. Keine Ebene kann eine
  // Einschraenkung einer aeusseren Ebene wieder aufheben -- das waere eine Lockerung.
  if (next == null) return current
  if (current == null) return next
  return current.filter((value) => next.includes(value))
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
        requiredHashtags: Array.from(
          new Set([...current.policies.requiredHashtags, ...(policies?.requiredHashtags ?? [])]),
        ),
        selfApprovalAllowed:
          current.policies.selfApprovalAllowed && policies?.selfApprovalAllowed !== false,
        allowSameReviewerAcrossStages:
          current.policies.allowSameReviewerAcrossStages &&
          policies?.allowSameReviewerAcrossStages !== false,
        mediaRequiresConsentCheck:
          current.policies.mediaRequiresConsentCheck ||
          policies?.mediaRequiresConsentCheck === true,
        consentExpiresOnLeave:
          current.policies.consentExpiresOnLeave ||
          policies?.consentExpiresOnLeave === true,
        allowedPresets: mergeAllowedList(current.policies.allowedPresets, policies?.allowedPresets),
        allowedFormats: mergeAllowedList(current.policies.allowedFormats, policies?.allowedFormats),
        allowedChannelIds: mergeAllowedList(
          current.policies.allowedChannelIds,
          policies?.allowedChannelIds,
        ),
      },
    }
  }, base)
}

// --- Paket 011: Freigaberouten, Vertrauen je Mitglied, Kontingente ------------------------------

// SaaS-Standard, bevor irgendeine Vereins-/Abteilungs-/Team-Ebene etwas festlegt (Plan 023/011,
// "Vererbung: SaaS Defaults -> Organization -> Department -> Team").
export const DEFAULT_EFFECTIVE_CONFIG: EffectiveConfig = {
  policies: {
    approvalRequired: false,
    minorApprovalRequired: false,
    minimumApprovals: 1,
    forbiddenTopics: [],
    requiredHashtags: [],
    selfApprovalAllowed: true,
    allowSameReviewerAcrossStages: true,
    mediaRequiresConsentCheck: false,
    consentExpiresOnLeave: false,
    allowedPresets: null,
    allowedFormats: null,
    allowedChannelIds: null,
  },
}

export function resolveEffectiveConfig(
  organization?: ConfigOverride | null,
  department?: ConfigOverride | null,
  team?: ConfigOverride | null,
): EffectiveConfig {
  const overrides = [organization, department, team].filter((override): override is ConfigOverride => override != null)
  return mergeEffectiveConfig(DEFAULT_EFFECTIVE_CONFIG, ...overrides)
}

export type ScopeLevelName = 'organization' | 'department' | 'team'
export type ReviewMode = 'any_with_permission' | 'named'
export type ReviewRequirement = 'inherit' | 'always' | 'waived'

export type ReviewerRef =
  | { kind: 'user'; userId: string }
  | { kind: 'organization_role'; role: string }
  | { kind: 'department_role'; departmentId: string; role: string }
  | { kind: 'team_role'; departmentId: string; teamId: string; role: string }

export interface MembershipRecord {
  userId: string
  scope: ScopeLevelName
  departmentId?: string
  teamId?: string
  role: string
}

// Loest benannte Prueferreferenzen (Rollen oder einzelne Personen) zu konkreten userIds auf.
// "any_with_permission"-Stufen brauchen das nicht: dort ist jede Person mit der Berechtigung im
// Scope gemeint, vom Aufrufer bereits als Liste ermittelt, bevor resolveReviewRoute laeuft.
export function resolveReviewers(
  refs: readonly ReviewerRef[],
  memberships: readonly MembershipRecord[],
): { userIds: string[]; unresolved: ReviewerRef[] } {
  const userIds = new Set<string>()
  const unresolved: ReviewerRef[] = []
  for (const ref of refs) {
    if (ref.kind === 'user') {
      userIds.add(ref.userId)
      continue
    }
    const matches = memberships.filter((membership) => {
      if (ref.kind === 'organization_role') return membership.scope === 'organization' && membership.role === ref.role
      if (ref.kind === 'department_role') return membership.scope === 'department' && membership.departmentId === ref.departmentId && membership.role === ref.role
      return membership.scope === 'team' && membership.teamId === ref.teamId && membership.role === ref.role
    })
    if (matches.length === 0) {
      unresolved.push(ref)
      continue
    }
    for (const match of matches) userIds.add(match.userId)
  }
  return { userIds: Array.from(userIds), unresolved }
}

// Eine Stufendefinition, wie sie der Aufrufer VOR resolveReviewRoute zusammenstellt: reviewerUserIds
// ist bereits aufgeloest (ueber resolveReviewers fuer "named", ueber eine Berechtigungsabfrage fuer
// "any_with_permission") -- resolveReviewRoute selbst loest keine Referenzen mehr auf, nur Routen.
export interface StageDefinition {
  scope: ScopeLevelName
  scopeDepartmentId?: string
  scopeTeamId?: string
  label: string
  mode: ReviewMode
  minimumApprovals: number
  deadlineHours?: number
  reviewerUserIds: readonly string[]
}

export interface TrustRecord {
  scope: ScopeLevelName
  scopeDepartmentId?: string
  scopeTeamId?: string
  submitAllowed: boolean
  reviewRequirement: ReviewRequirement
}

export interface ReviewStage {
  position: number
  scope: ScopeLevelName
  scopeDepartmentId?: string
  scopeTeamId?: string
  label: string
  mode: ReviewMode
  minimumApprovals: number
  isMinorStage: boolean
  reviewerUserIds: readonly string[]
  deadlineHours?: number
}

export type RouteBlocker =
  | { kind: 'empty_reviewer_pool'; stageLabel: string }
  | { kind: 'only_author_as_reviewer'; stageLabel: string }

const SCOPE_OUTER_ORDER: readonly ScopeLevelName[] = ['organization', 'department', 'team']

function isOuterOrEqual(candidate: ScopeLevelName, of: ScopeLevelName): boolean {
  return SCOPE_OUTER_ORDER.indexOf(candidate) <= SCOPE_OUTER_ORDER.indexOf(of)
}

// Die Freigaberoute eines Beitrags: Stufen von innen (Team) nach aussen (Verein), Befreiungen nur
// nach unten wirkend, Minderjaehrigenstufe unbefreibar. Eine Route mit einer unerfuellbaren Stufe
// wird nicht erzeugt -- sie wuerde einen Beitrag lautlos fuer immer liegen lassen (Plan 011,
// "resolveReviewRoute ist das Herz").
export function resolveReviewRoute(input: {
  stages: readonly StageDefinition[] // innen nach aussen
  trust: readonly TrustRecord[] // alle Vertrauenseinstellungen des Autors, eine je Ebene
  author: { userId: string }
  // reviewerUserIds ist eine eigene Zustaendigkeit (z. B. eine vereinsweite
  // Kinderschutzbeauftragte), nicht von einer bestehenden Stufe geliehen -- sonst wuerde die
  // Minderjaehrigenstufe bei einer vollstaendig befreiten Route (keine andere Stufe uebrig)
  // faelschlich einen leeren Pruefkreis erben und selbst blockiert.
  media: { containsMinors: boolean; reviewerUserIds: readonly string[] }
  selfApprovalAllowed: boolean
  allowReviewExemptions: boolean // nur auf Vereinsebene wirksam (Plan 011)
}): { stages: ReviewStage[]; blockers: RouteBlocker[] } {
  const trustByScope = new Map(input.trust.map((record) => [record.scope, record]))

  const kept = input.stages.filter((stage) => {
    const trustAtOwnLevel = trustByScope.get(stage.scope)
    if (trustAtOwnLevel?.reviewRequirement === 'always') return true

    if (!input.allowReviewExemptions) return true

    const waivedByAnyOuterOrEqualLevel = SCOPE_OUTER_ORDER.some(
      (scope) => isOuterOrEqual(scope, stage.scope) && trustByScope.get(scope)?.reviewRequirement === 'waived',
    )
    return !waivedByAnyOuterOrEqualLevel
  })

  const withMinorStage: StageDefinition[] = [...kept]
  if (input.media.containsMinors) {
    // Als aeusserste der inneren Stufen einsortiert: nach allen Abteilungs-/Team-Stufen, vor einer
    // etwaigen Vereinsstufe, damit sie nie uebersprungen werden kann.
    const firstOrganizationIndex = withMinorStage.findIndex((stage) => stage.scope === 'organization')
    const minorStage: StageDefinition & { __minor: true } = {
      scope: 'organization',
      label: 'Minderjährigenschutz',
      mode: 'any_with_permission',
      minimumApprovals: 1,
      reviewerUserIds: input.media.reviewerUserIds,
      __minor: true,
    }
    if (firstOrganizationIndex === -1) withMinorStage.push(minorStage)
    else withMinorStage.splice(firstOrganizationIndex, 0, minorStage)
  }

  const blockers: RouteBlocker[] = []
  const resolvedStages: ReviewStage[] = withMinorStage.map((stage, index) => {
    const isMinorStage = '__minor' in stage
    const effectiveReviewers = input.selfApprovalAllowed
      ? stage.reviewerUserIds
      : stage.reviewerUserIds.filter((userId) => userId !== input.author.userId)
    if (stage.reviewerUserIds.length === 0) {
      blockers.push({ kind: 'empty_reviewer_pool', stageLabel: stage.label })
    } else if (effectiveReviewers.length === 0) {
      blockers.push({ kind: 'only_author_as_reviewer', stageLabel: stage.label })
    }
    return {
      position: index + 1,
      scope: stage.scope,
      ...(stage.scopeDepartmentId !== undefined ? { scopeDepartmentId: stage.scopeDepartmentId } : {}),
      ...(stage.scopeTeamId !== undefined ? { scopeTeamId: stage.scopeTeamId } : {}),
      label: stage.label,
      mode: stage.mode,
      minimumApprovals: stage.minimumApprovals,
      isMinorStage,
      reviewerUserIds: stage.reviewerUserIds,
      ...(stage.deadlineHours !== undefined ? { deadlineHours: stage.deadlineHours } : {}),
    }
  })

  return { stages: blockers.length > 0 ? [] : resolvedStages, blockers }
}

export function evaluateSubmitPermission(input: {
  hasCreatePermission: boolean
  submitAllowed: boolean
  presetSlug: string
  requestedFormats: readonly string[]
  allowedPresets: readonly string[] | null
  allowedFormats: readonly string[] | null
}): { allowed: boolean; reason?: 'missing_permission' | 'submit_not_allowed' | 'preset_not_allowed' | 'format_not_allowed' } {
  if (!input.hasCreatePermission) return { allowed: false, reason: 'missing_permission' }
  if (!input.submitAllowed) return { allowed: false, reason: 'submit_not_allowed' }
  if (input.allowedPresets !== null && !input.allowedPresets.includes(input.presetSlug)) {
    return { allowed: false, reason: 'preset_not_allowed' }
  }
  if (
    input.allowedFormats !== null &&
    input.requestedFormats.some((format) => !input.allowedFormats!.includes(format))
  ) {
    return { allowed: false, reason: 'format_not_allowed' }
  }
  return { allowed: true }
}

// Hier stand evaluateQuota (Plan 011). Entfernt, statt unbenutzt liegen zu bleiben: die Durchsetzung
// gehoert aus Atomaritaetsgruenden in public.schedule_publication (Advisory Lock um Zaehlung und
// Einplanung), und die Signatur paarte Limit und Zaehlung nur ueber (scope, period) -- damit liessen
// sich zwei Kontingente derselben Ebene und Periode fuer VERSCHIEDENE Kanaele nicht unterscheiden,
// obwohl channel_quotas genau das erlaubt (unique ueber scope/department/team/social_connection_id/
// period). Wer die Auslastung anzeigen will ("2 von 3 diese Woche"), baut sie mit der
// Kanaldimension neu -- sinnvoll zusammen mit der Kanal-Oberflaeche in Paket 012 und einem
// Endpunkt, der count_publications_in_period service-seitig aufruft (an authenticated bewusst
// nicht vergeben). Als Anzeige, nie als Gate.

// --- Paket 012: Kanaele und Social-Accounts ----------------------------------------------------

// Ein channel_scopes-Eintrag deckt einen Scope S, wenn er auf S selbst oder eine uebergeordnete
// Ebene von S zeigt: organization deckt immer, department deckt department UND jedes seiner Teams,
// team deckt nur genau dieses Team. Gespiegelt in SQL innerhalb von schedule_publication (Plan 011/012:
// die RPC ist die tatsaechliche Durchsetzungsgrenze, diese Funktion dient Oberflaeche/Vorabpruefung).
function grantCoversScope(
  grant: { scope: ScopeLevelName; departmentId?: string; teamId?: string },
  targetScope: ScopeLevelName,
  targetDepartmentId?: string,
  targetTeamId?: string,
): boolean {
  if (grant.scope === 'organization') return true
  if (grant.scope === 'department') return grant.departmentId === targetDepartmentId
  return targetScope === 'team' && grant.teamId === targetTeamId
}

export interface ChannelCandidate {
  socialConnectionId: string
  status: 'active' | 'action_required' | 'disconnected'
  archivedAt: string | null
  responsibleProfileId: string | null
  scopeGrants: readonly { scope: ScopeLevelName; departmentId?: string; teamId?: string; canSchedule: boolean }[]
}

// Auflösungsregel fuer erlaubte Kanaele eines Beitrags in Scope S (Plan 012): channel_scopes-Treffer
// fuer S oder eine uebergeordnete Ebene, geschnitten mit allowedChannelIds aus der effektiven
// Konfiguration (Paket 011; null = keine Einschraenkung), ohne inaktive/archivierte Kanaele, ohne
// Kanaele ohne verantwortliche Person, falls die Richtlinie das verlangt.
export function resolveAvailableChannels(input: {
  scope: ScopeLevelName
  departmentId?: string
  teamId?: string
  channels: readonly ChannelCandidate[]
  allowedChannelIds: readonly string[] | null
  requireChannelResponsible: boolean
}): string[] {
  return input.channels
    .filter((channel) => channel.status === 'active' && channel.archivedAt === null)
    .filter((channel) => input.allowedChannelIds === null || input.allowedChannelIds.includes(channel.socialConnectionId))
    .filter((channel) => !input.requireChannelResponsible || channel.responsibleProfileId !== null)
    .filter((channel) =>
      channel.scopeGrants.some(
        (grant) => grant.canSchedule && grantCoversScope(grant, input.scope, input.departmentId, input.teamId),
      ),
    )
    .map((channel) => channel.socialConnectionId)
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
  faces: readonly {
    subjectKind: 'adult' | 'minor' | 'unknown'
    decision: 'pending' | 'consented' | 'obscure' | 'exclude'
    consentValid?: boolean | undefined
    // Paket 015: die Zeile selbst ist gueltig, deckt aber nicht den angefragten Umfang
    // (Plattform/Medienart/Kontext/Abteilung) ab -- siehe isConsentScopeMismatch in consent.ts.
    consentScopeMismatch?: boolean | undefined
  }[]
  minorReviewConfirmed: boolean
  // Paket 015: Textpruefung (scanTextForSensitiveData in consent.ts) laeuft unabhaengig von
  // Gesichtern -- ein Beitrag ohne jedes Foto kann trotzdem blockiert sein (Plan, "Sensible
  // Angaben im Text, nicht nur im Bild").
  namingNotAllowed?: boolean | undefined
  sensitiveTextData?: boolean | undefined
}

export type MediaGateBlocker =
  | 'scan_pending'
  | 'face_pending'
  | 'consent_invalid'
  | 'derivative_stale'
  | 'minor_review_required'
  | 'original_selected'
  | 'consent_scope_mismatch'
  | 'naming_not_allowed'
  | 'sensitive_text_data'

export function evaluateMediaGate(input: MediaGateInput): { publishable: boolean; blockers: MediaGateBlocker[] } {
  const blockers: MediaGateBlocker[] = []
  if (input.scanStatus !== 'clean') blockers.push('scan_pending')
  if (!input.facesConfirmedComplete || input.faces.some((face) => face.decision === 'pending')) blockers.push('face_pending')
  if (input.faces.some((face) => face.decision === 'consented' && !face.consentValid)) blockers.push('consent_invalid')
  if (input.faces.some((face) => face.decision === 'consented' && face.consentScopeMismatch === true)) blockers.push('consent_scope_mismatch')
  if (!input.derivativeCurrent) blockers.push('derivative_stale')
  if (input.hasOriginalSelected) blockers.push('original_selected')
  if (input.faces.some((face) => face.subjectKind === 'minor') && !input.minorReviewConfirmed) blockers.push('minor_review_required')
  if (input.namingNotAllowed) blockers.push('naming_not_allowed')
  if (input.sensitiveTextData) blockers.push('sensitive_text_data')
  return { publishable: blockers.length === 0, blockers }
}

export { curatedFonts, curatedFontPairings, findCuratedFont, type CuratedFont, type CuratedFontPairing } from './fonts.js'
export { contrastRatio, meetsMinimumContrast, type ContrastCheck } from './contrast.js'
export {
  BRAND_LOCKABLE_FIELDS,
  resolveBrand,
  isBrandAssetSelectable,
  type BrandAssetRef,
  type BrandLevelProfile,
  type BrandLockableField,
  type BrandOverrideProfile,
  type ResolvedBrand,
} from './brand.js'
export {
  consentPurposes,
  consentPlatforms,
  consentMediaKinds,
  consentContexts,
  consentBlockers,
  evaluateConsent,
  isConsentRecordInvalid,
  isConsentScopeMismatch,
  scanTextForSensitiveData,
  textScanFindingKinds,
  type ConsentPurpose,
  type ConsentPlatform,
  type ConsentMediaKind,
  type ConsentContext,
  type ConsentScope,
  type ConsentBlocker,
  type ConsentRecordForEvaluation,
  type RequiredConsent,
  type LinkedPersonForTextScan,
  type TextScanFindingKind,
  type TextScanFinding,
  type TextScanResult,
} from './consent.js'

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
