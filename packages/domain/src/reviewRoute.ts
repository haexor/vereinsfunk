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
      // Der Snapshot ist nicht nur eine Diagnosehilfe, sondern der konkrete Prueferkreis der
      // angelegten Stufe. Wenn Selbstfreigabe verboten ist, darf der Autor deshalb auch nicht
      // darin erscheinen; die SQL-Pruefung bleibt dennoch Defence in Depth fuer direkte RPCs.
      reviewerUserIds: effectiveReviewers,
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

