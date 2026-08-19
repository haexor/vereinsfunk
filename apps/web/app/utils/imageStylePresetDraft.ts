import type { ImageStyleFilter, ImageStyleFrameType, ImageStyleLogoPosition } from '@vereinsfunk/contracts'

// Eigene Datei statt in ImageStylePresetForm.vue: Vue rät von benannten Exporten aus
// <script setup> ab (stilprofile.vue/styleProfileDraft.ts folgt demselben Muster).
export interface ImageStylePresetDraft {
  name: string
  frameType: ImageStyleFrameType
  frameColor: string | null
  frameWidthPx: number | null
  frameCornerRadiusPx: number | null
  frameBrandAssetId: string | null
  logoEnabled: boolean
  logoBrandAssetId: string | null
  logoPosition: ImageStyleLogoPosition
  logoSizePercent: number | null
  logoMarginPercent: number | null
  filter: ImageStyleFilter
}

export function emptyImageStylePresetDraft(): ImageStylePresetDraft {
  return {
    name: '', frameType: 'none', frameColor: null, frameWidthPx: null, frameCornerRadiusPx: null, frameBrandAssetId: null,
    logoEnabled: false, logoBrandAssetId: null, logoPosition: 'bottom_right', logoSizePercent: null, logoMarginPercent: null,
    filter: 'original',
  }
}
