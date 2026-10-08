// Paket 053, PR 1: Fehler des Veo-Clients mit fachlichem Code. Der Sync entscheidet daran, ob ein
// Lauf "neu verbinden" verlangt (auth_expired), ob Veo seine interne Schnittstelle geaendert hat
// (upstream_changed, dann wird nichts geschrieben) oder ob ein voruebergehender Fehler vorliegt.

export type VeoErrorCode =
  // Anmeldung mit E-Mail und Passwort gescheitert.
  | 'login_failed'
  // Das gespeicherte Session-Cookie erneuert sich nicht mehr oder ein Token wurde abgelehnt.
  | 'auth_expired'
  // Antwortform passt nicht mehr zum erwarteten Schema (inoffizielle API geaendert).
  | 'upstream_changed'
  // Veo antwortet mit einem anderen Fehler (5xx, Zeitueberschreitung, Netzwerk).
  | 'upstream_error'

export class VeoError extends Error {
  constructor(readonly code: VeoErrorCode, message: string, readonly status?: number) {
    super(message)
    this.name = 'VeoError'
  }
}
