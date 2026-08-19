// Kompatibilitaetsgrenze: der oeffentliche Import bleibt `@vereinsfunk/domain`. Neue
// Domaenenlogik gehoert in das fachlich passende Modul, nicht hierher (plans/029).
export * from './postStatus.js'
export * from './effectiveConfig.js'
export * from './reviewRoute.js'
export * from './channels.js'
export * from './mediaGate.js'
export * from './llmProviders.js'

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
  type DepartmentBrandLevel,
  type OrganizationBrandLevel,
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

export {
  dayWindow,
  rangeWindow,
  addDays,
  daysBetween,
  isInWindow,
  median,
  computeTrend,
  computeCountMetrics,
  computeCountMetricsSeries,
  leadTimeSecondsSamples,
  approvalDurationSecondsSamples,
  computeFunnel,
  funnelStages,
  type MetricsWindow,
  type PostCreatedInput,
  type PublishedTransitionInput,
  type ApprovalDecisionInput,
  type PublicationStatusInput,
  type WorkflowRunInput,
  type PostVersionInput,
  type CountMetrics,
  type ComputeCountMetricsInput,
  type StatusTransitionInput,
  type FunnelStage,
  type FunnelStageCount,
} from './metrics.js'
