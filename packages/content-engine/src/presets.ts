import type { ContentPresetSlug, SourceMaterial } from '@vereinswerk/contracts'

export interface ContentPreset { slug: ContentPresetSlug; label: string; helpText: string; requiredFacts: readonly string[]; requiresObservation?: boolean }
export const contentPresets: readonly ContentPreset[] = [
  ['training_insight', 'Trainingseinblick', 'Was wurde konkret geübt?', [], true], ['club_life', 'Vereinsleben', 'Ein echter Moment aus dem Verein.', [], true],
  ['children_program', 'Ballschule & Kinderangebote', 'Beschreibe Angebot und Lernmoment.', ['audience'], true], ['people_spotlight', 'Menschen im Verein', 'Nur freigegebene Zitate verwenden.', ['personName'], true],
  ['volunteering', 'Ehrenamt', 'Wofür soll gedankt werden?', [], true], ['behind_the_scenes', 'Hinter den Kulissen', 'Zeige einen konkreten Einblick.', [], true],
  ['new_offer', 'Neues Angebot', 'Was, für wen und wie erreichbar?', ['title', 'audience', 'contact']], ['event', 'Veranstaltung', 'Termin und Ort nennen.', ['title', 'date', 'location']],
  ['celebration', 'Feier & Erfolg', 'Den Anlass belastbar beschreiben.', ['title']], ['member_recruitment', 'Mitglieder gewinnen', 'Zielgruppe und Kontakt nennen.', ['audience', 'contact']],
  ['sponsor', 'Partner & Sponsoren', 'Beitrag des Partners beschreiben.', ['sponsorName']], ['education_tip', 'Wissen & Tipp', 'Einen konkreten Tipp teilen.', ['topic'], true],
  ['match_announcement', 'Spielankündigung', 'Gegner, Zeit und Ort nennen.', ['opponent', 'date', 'location']], ['match_result', 'Spielergebnis', 'Teams und Ergebnis nennen.', ['homeTeam', 'awayTeam', 'homeScore', 'awayScore']],
  ['freeform', 'Eigene Geschichte', 'Eine bestätigte Beobachtung oder einen Fakt eingeben.', []],
].map(([slug, label, helpText, requiredFacts, requiresObservation]) => ({ slug, label, helpText, requiredFacts, requiresObservation })) as readonly ContentPreset[]

export function getPreset(slug: ContentPresetSlug): ContentPreset {
  return contentPresets.find((preset) => preset.slug === slug) ?? { slug, label: slug, helpText: 'Eigener Anlass', requiredFacts: [] }
}

export function validateSourceMaterial(preset: ContentPreset, material: SourceMaterial): string[] {
  const missing = preset.requiredFacts.filter((key) => material.facts[key] === undefined || material.facts[key] === '')
  if ((preset.requiresObservation || preset.slug === 'freeform') && material.observations.length === 0 && Object.keys(material.facts).length === 0) missing.push('confirmed_observation_or_fact')
  return missing
}
