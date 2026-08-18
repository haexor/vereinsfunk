import type { SocialPlatform } from '@vereinsfunk/contracts'

// Paket 045: vorher vier identische Kopien (PlatformIcon.vue, DefaultTargetPlatformsPicker.vue,
// erstellen.vue, plattform-admin/llm.vue) -- eine Quelle, damit eine neue Plattform nicht an vier
// Stellen nachgezogen werden muss.
export const platformLabels: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
  website: 'Eigene Website',
}

export const platformGlyphs: Record<SocialPlatform, string> = {
  instagram: 'IG',
  facebook: 'f',
  twitter: 'X',
  linkedin: 'in',
  website: '🌐',
}
