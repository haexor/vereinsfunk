import type { PhotoLayoutKind } from '@vereinsfunk/contracts'

// Eigene Datei statt in PhotoLayoutPresetForm.vue: Vue raet von benannten Exporten aus
// <script setup> ab (imageStylePresetDraft.ts folgt demselben Muster).
export interface PhotoLayoutPresetDraft {
  name: string
  kind: PhotoLayoutKind
  dividerColor: string
  dividerWidthPx: number
  cornerRadiusPx: number | null
}

export function emptyPhotoLayoutPresetDraft(): PhotoLayoutPresetDraft {
  return { name: '', kind: 'diagonal_split', dividerColor: 'primary', dividerWidthPx: 6, cornerRadiusPx: null }
}
