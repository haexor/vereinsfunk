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
