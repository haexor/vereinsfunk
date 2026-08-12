// Gemeinsame Fixtures der fachnahen Tests dieses Pakets.
import {
} from './index.js'

export const baseFields = {
  requiredHashtags: [],
  selfApprovalAllowed: true,
  allowSameReviewerAcrossStages: true,
  mediaRequiresConsentCheck: false,
  consentExpiresOnLeave: false,
  allowedPresets: null,
  allowedFormats: null,
  allowedChannelIds: null,
} as const

