import { ApiRequestError } from './apiClient'

// Paket 052, PR 3: fachliche Fehlercodes der PlayerBoard-API in Klartext. Unbekannte Codes fallen
// auf die Meldung der Seite zurueck.
const messages: Readonly<Record<string, string>> = {
  forbidden: 'Dafür fehlt dir in dieser Mannschaft die Berechtigung.',
  module_disabled: 'PlayerBoard ist hier nicht aktiviert.',
  training_date_in_future: 'Ein Training kann nicht in der Zukunft liegen.',
  player_not_in_training_team: 'Dieser Spieler gehört nicht zur Mannschaft des Trainings.',
  category_not_effective: 'Diese Kategorie gilt für die Mannschaft nicht (mehr).',
  point_value_out_of_range: 'Ein Wert liegt außerhalb des erlaubten Bereichs.',
  player_already_in_team: 'Diese Person steht bereits im Kader.',
  player_has_points: 'Der Spieler hat bereits Punkte. Setze ihn stattdessen auf inaktiv.',
  player_has_account: 'Der Spieler hat bereits ein Konto.',
  email_required: 'Für eine Einladung braucht es eine E-Mail-Adresse.',
  already_a_member: 'Diese Adresse gehört bereits zu einem Mitglied.',
  invitation_already_open: 'An diese Adresse ist schon eine Einladung offen.',
  invite_not_allowed: 'Einladungen sind hier nicht erlaubt.',
  resend_limit_reached: 'An diese Adresse gingen schon zu viele Einladungen. Versuche es später erneut.',
  resend_rate_limited: 'An diese Adresse gingen schon zu viele Einladungen. Versuche es später erneut.',
  team_categories_not_allowed: 'Eigene Kategorien der Mannschaft sind von einer höheren Ebene nicht erlaubt.',
  category_in_use: 'Die Kategorie hat bereits Punkte. Deaktiviere sie stattdessen.',
  public_slug_taken: 'Diese Adresse ist im Verein schon vergeben.',
  storage_limit_reached: 'Der Speicherplatz ist aufgebraucht. Lösche alte Fotos oder erweitere den Tarif.',
  upload_missing: 'Die Datei ist nicht vollständig angekommen. Bitte noch einmal hochladen.',
  invalid_upload_size: 'Die Datei ist leer oder beschädigt.',
  photo_size_exceeds_reservation: 'Die Datei ist größer als angekündigt. Bitte noch einmal hochladen.',
  photo_consent_invalid: 'Für mindestens eine ausgewählte Person liegt keine gültige Einwilligung vor.',
  photo_consent_not_approved: 'Das Foto muss zuerst geprüft und freigegeben werden.',
  photo_upload_incomplete: 'Das Foto ist noch nicht vollständig hochgeladen.',
  recognizable_people_not_confirmed: 'Bestätige, dass alle erkennbaren Personen ausgewählt sind.',
}

/** Liefert Klartext fuer bekannte API-Fehlercodes, sonst die Ersatzmeldung der Seite. */
export function playerboardErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return messages[error.code] ?? fallback
  return fallback
}
