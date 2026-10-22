# Contract: Veo-Analyse (API `apps/api`, Schemas `packages/contracts/src/playerboardVeoAnalysis.ts`)

Für alle Endpunkte gilt:
- Anmeldung ist nötig.
- Reihenfolge der Prüfungen wie in Paket 052: erst das Modul (`403 module_disabled`), dann die Sicht `authz.can_view_playerboard_stats` (`403 forbidden`).
- Eine Mannschaft oder ein Spiel, das man nicht sehen darf oder das nicht existiert, ergibt in beiden Fällen `404 not_found` mit gleichem Body (FR-063).
- Die Daten kommen über den Nutzer-Client aus den Lesefunktionen in [data-model.md](../data-model.md), RLS ist die zweite Prüfung.
- Jede Antwort wird vor dem Senden mit dem Zod-Schema geprüft.
- Koordinaten sind normiert (R-06): `x` und `y` liegen zwischen 0 und 1, die jeweilige Mannschaft greift Richtung `x = 1` an.

## `GET /v1/playerboard/teams/:teamId/veo/matches/:fixtureId/analysis`

Grundlage für Story 1, 2 und 5. Response `PlayerboardVeoMatchAnalysisSchema`:

```ts
{
  fixtureId: uuid, kickoffAt: iso, opponentName: string | null, isHome: boolean | null,
  ownScore: int | null, opponentScore: int | null,
  veoUrl: url | null,                       // https://app.veo.co/matches/{slug}/
  analyticsVersion: '1' | '1.1' | '2' | null,   // null, solange kein Analysepaket geholt wurde
  analysisStatus: 'none' | 'pending' | 'complete' | 'unavailable',
  periods: { number: int, startS: int, endS: int, ownSide: 'left' | 'right', confirmed: boolean }[],
  availability: Record<AnalysisPart, { status: 'available' | 'unavailable' | 'pending', reason?: AvailabilityReason }>,
  teamStats: { teamAssociation: 'own' | 'opponent', statType: string, category: string, value: number,
               periodValues: { period: int, value: number }[] }[],
  players: { jerseyNumber: int, playerId: uuid | null, personId: uuid | null, name: string | null,
             matchedManually: boolean,
             stats: { statType: string, category: string, value: number, periodValues: {...}[] }[] }[],
  events: { id: string, teamAssociation: 'own' | 'opponent', eventType: string, jerseyNumber: int | null,
            playerId: uuid | null,              // nur own
            periodNumber: int, periodTimeMs: int, videoTimeMs: int,
            x: number | null, y: number | null, endX: number | null, endY: number | null, // end* nur bei Pässen
            outcome: int | null, receiverJerseyNumber: int | null, assistJerseyNumber: int | null }[],
  heatmaps: { jerseyNumber: int, periodNumber: int /* 0 = ganzes Spiel */, width: int, height: int,
              cells: base64, averageX: number | null, averageY: number | null }[],
  passPossession: PassPossession | null,
  momentum: [number, number | null][] | null,
  passingNetwork: { periodNumber: int, nodes: { jerseyNumber: int, x: number, y: number }[],
                    edges: { fromJersey: int, toJersey: int, completedPasses: int }[] }[] | null,
  hasReport: boolean,
  hasTracking: boolean,
}
```

`players` hat zunächst keine Position: Veo liefert sie für dieses Konto nicht (`lineup/players/` antwortet mit `403`, research.md). Matrizen (`cells`) und Positionsdaten (`samples`) kommen als base64 in einer Zeile.

`AvailabilityReason` hat die Werte `veo_processing`, `periods_missing`, `older_analytics_version`, `not_provided` und `no_jersey`. Daraus entstehen die Hinweistexte nach FR-066. Gegnerspieler erscheinen nur als `jerseyNumber` in `events`; `players` enthält nur die eigene Mannschaft (FR-064).

## `GET /v1/playerboard/teams/:teamId/veo/matches/:fixtureId/tracks`

Nur wenn `hasTracking` gilt. Response `{ sampleHz: 1, periods: Period[], tracks: { veoTrackId: int, side: 'left' | 'right', goalkeeper: boolean, jerseyNumber: int | null, startS: int, samples: base64 }[] }`. Die Koordinaten sind Kamera-Koordinaten. `packages/domain` ordnet die Spuren je Halbzeit über `ownSide` der eigenen Mannschaft oder dem Gegner zu und rechnet die Heatmap für den gewählten Zeitabschnitt (R-05). Gegnerspuren tragen nie einen Bezug zum Kader. Gibt es keine Positionsdaten, kommt `404 not_found`.

## `GET /v1/playerboard/teams/:teamId/veo/matches/:fixtureId/report`

Nur wenn `hasReport` gilt. Response `PlayerboardVeoMatchReportSchema`: die Abschnitte `overview`, `attacking`, `defensive`, `passing` und `physical` mit `StatValue = { fullTime: { own, opponent }, periods: { periodNumber, own, opponent }[], comparison?: { difference, matchCount } }`, dazu `scorers` und `lineup` mit `playerId`/`name` aus der Zuordnung, sowie die Geschwindigkeitszonen. Felder, die Veo nicht liefert, werden weggelassen, nicht genullt.

## `GET /v1/playerboard/teams/:teamId/veo/season` (Veo Analytics)

Grundlage der Saisonsicht „Veo Analytics“ (Nachbau von Veos Analytics Studio). Query `PlayerboardVeoSeasonQuerySchema`:
- `from`, `to` (Datum, optional)
- `kinds` (kommagetrennt, optional)
- `last` (1–100, optional)
- `fixtureIds` (kommagetrennt, optional; schließt die anderen Filter aus)

Response: Array von `PlayerboardVeoSeasonMatchSchema`, ältestes Spiel zuerst. Je Spiel:
- Kopf: `fixtureId`, `kickoffAt`, `kind`, Gegner, Heim, Ergebnis, `veoUrl`
- `analysisStatus` und `analyticsVersion`
- `periods` und `availability`
- `teamStats` mit `periodValues`
- `passPossession`
- `shots`: nur `FootballShot` und `FootballGoal`, eigene mit `playerId`

Kennzahlen, Verlauf, Siegquote, Schusskarte, Zonen und Radar rechnet das Web mit `packages/domain` (R-08). Damit entfällt die frühere Planung, `GET …/veo/matches` zu erweitern und einen eigenen Endpunkt `…/veo/shots` anzulegen. `/playerboard/spiele` bleibt dadurch unverändert.

## `GET /v1/playerboard/teams/:teamId/veo/views`

Response `PlayerboardVeoTeamViewsSchema` (siehe `PUT`). Hat die Mannschaft keine eigene Auswahl, kommen Veos Standards.

Ranglisten, Tabelle, Vergleich, Durchschnitte, Kennzahlen je Spiel und Radar rechnet das Web mit `packages/domain` aus `season` (Spieler aus `matches`). So gilt eine Regel an einer Stelle (R-08). Für das Radar mit einer anderen Mannschaft ruft das Web dieselben Endpunkte für deren `teamId` auf. Darf die Person deren Werte nicht sehen, kommt `404`.

## `GET /v1/playerboard/teams/:teamId/veo/season/players/:playerId/heatmaps`

Query wie bei `matches`. Response `{ items: { fixtureId, secondsPlayed: int | null, width, height, cells: base64 }[] }`. Das Web summiert gewichtet (R-05).

## `PUT /v1/playerboard/teams/:teamId/veo/views`

Erfordert `training.manage`, sonst `403 forbidden`. Body `PlayerboardVeoTeamViewsSchema`:

```ts
{ keyMetrics: KeyMetricId[] /* 0–4, eindeutig */,
  radar: { metrics: KeyMetricId[] /* genau 6 */, comparingTeamId: uuid | null,
           ownRange: [date, date], comparingRange: [date, date] } | null }
```

Fehler: `422 invalid_metric` bei unbekannten Kennzahlen, `404 not_found` bei einer Vergleichsmannschaft außerhalb des Vereins oder ohne Sicht. Antwort ist der gespeicherte Stand. Der Audit-Eintrag folgt dem bestehenden Muster für Einstellungen im PlayerBoard.

## `POST /v1/playerboard/veo/sync` (bestehend, erweitert)

Body bekommt optional `refreshAnalysis: boolean`. Mit `true` setzt der Endpunkt `analysis_refresh_requested_at` für die Mannschaft und reiht den Lauf ein. Dafür sind dieselben Rechte nötig wie für „Jetzt abgleichen“.

## Personenprofil (Spec 001, erweitert)

`GET /v1/people/:id/profile` bekommt je Mannschaft `veo: { teamId, playerId } | null`, wenn die Mannschaft eine Veo-Verbindung hat und die Person ihre Werte sehen darf. Das Profil lädt die Saisonwerte und Karten dann über `matches`, `shots` und `season/players/:playerId/heatmaps` dieser Mannschaft (FR-044).

## Veo-Client (`packages/veo-client/src/analysis.ts`)

Neue Funktionen, jede mit Zod-Schema. Eine geänderte Antwortform ergibt `upstream_changed`, 404 oder eine fehlende Freischaltung ergibt `null` (Teil nicht verfügbar).

- `fetchMatchDetail`
- `fetchProcessingStatus`
- `fetchRasStatus`
- `fetchPeriods`
- `fetchMatchEvents`
- `fetchPlayerHeatmaps` (je Zeitfenster)
- `fetchMatchDetails` (RAS)
- `fetchMomentum`
- `fetchPassingNetwork`
- `fetchMatchReport`
- `fetchTrackingWindow`
- `fetchPlayerStats` wechselt auf `match_all_players` (R-07).
