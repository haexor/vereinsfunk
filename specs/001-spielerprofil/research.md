# Research: Spielerprofil auf Vereinsebene

Alle Punkte aus dem Technical Context sind geklärt; es blieb kein `NEEDS CLARIFICATION`. Belege verweisen auf den Stand `5ea3c35`.

## 1. Linkziel und Route

- **Decision**: Profil unter `/personen/[id]`, `id` = `directory_people.id`.
- **Rationale**: Die Verzeichnisperson ist die vereinsweit eindeutige Identität (`playerboard_players` verweist per `(organization_id, directory_person_id)` darauf, `unique (team_id, directory_person_id)`). Damit hat eine Person in mehreren Mannschaften genau ein Profil (FR-003). `/personen` kollidiert mit keiner Route und keinem Modulpräfix (`moduleForPath` kennt es nicht), also greift `module.global.ts` nicht.
- **Alternatives**: `/playerboard/kader/[id]` (an die Mannschaft gebunden, Auftraggeber lehnt ab); `/verzeichnis?person=` (nur mit `directory.read` erreichbar, Spieler kämen nicht hin); `/profil` (ist das eigene Konto).

## 2. Wer darf ein Profil sehen

- **Decision**: Eine Person ist sichtbar, wenn die aufrufende Person mindestens eines trifft: (a) sie sieht die Kennzahlen mindestens einer Mannschaft, in der die Person im Kader steht (`authz.can_view_playerboard_stats`), oder (b) sie darf die Person im Verzeichnis lesen (dieselbe Bedingung wie `directory_people_select`: `directory.read` auf Verein, Abteilung oder Mannschaft der Person).
- **Rationale**: (a) deckt Spieler und Trainer; es ist exakt die Regel, nach der sie den Namen heute in Training, Rangliste und Kader sehen (`playerboard_team_roster`, `playerboard_team_ranking`). (b) erhält, dass Verwalter auch Personen ohne Kader erreichen. Kein dritter Fall, damit das Profil nie mehr preisgibt als die bestehenden Ansichten (Spec, Annahme „Sichtbarkeit folgt den bestehenden Regeln“).
- **Alternatives**: Jedes Vereinsmitglied sieht jedes Profil (zu weit: Eltern- und Trainerdaten, Minderjährige); nur `directory.read` (Spieler sähen ihre Mitspieler nicht, Links wären tot).

## 3. Identische Antwort für „nicht gefunden“ und „nicht sichtbar“

- **Decision**: Die Funktion liefert `null`, sowohl für eine unbekannte Id als auch für eine nicht sichtbare Person; die Route antwortet in beiden Fällen mit `404 { error: 'not_found' }` und gleicher Struktur.
- **Rationale**: FR-007 und SC-003. Die Route prüft keine Scopes vorab (anders als `requireStatsAccess`), denn jede Vorabprüfung auf Basis der Person verriete deren Existenz. Ohne Anmeldung greift `requireAuth` (401) wie überall.
- **Alternatives**: `403` für sichtbar-aber-verboten: verrät Existenz und Vereinszugehörigkeit.

## 4. Punkte: wiederverwenden statt neu rechnen

- **Decision**: `person_profile(target_person_id, period)` ruft je sichtbarer Mannschaft `authz.playerboard_ranking_rows(team, from, to)` auf und filtert auf die Person. `period` ist `season` (Standard) oder `all`. Bei `season` bestimmt eine neue SQL-Funktion `authz.current_season_start(season_start date, today date)` den Zeitraumanfang aus dem wirksamen Saisonbeginn der Mannschaft (`authz.playerboard_setting(..., 'season_start')`) und dem heutigen Datum in der Zeitzone des Vereins (`organizations.timezone`). Ohne Saisonbeginn gilt die gesamte Zeit, wie in `loadSeasonFrom`.
- **Rationale**: Dieselbe Funktion speist Rangliste und Saisonübersicht; FR-010 ist damit konstruktionsbedingt erfüllt, inklusive geteilter Plätze und „nur gespeicherte Trainings“. Die Route kennt vor dem Aufruf die sichtbaren Mannschaften nicht, könnte also keine Saisonbeginne je Mannschaft mitgeben, ohne die Funktion zweimal aufzurufen. Die Spiegelung von `currentSeasonStart` (`packages/domain/src/playerboard.ts`) folgt dem Muster des Repos (`resolve_playerboard_setting` spiegelt `resolvePlayerboardSettings`): pgTAP prüft dieselben Fälle wie `packages/domain/src/playerboard.test.ts`, damit beide nicht auseinanderlaufen.
- **Alternatives**: Zeitraum vom Browser schicken (`from`/`to`): ein Datum für alle Mannschaften, obwohl der Saisonbeginn je Mannschaft verschieden sein kann. Zwei RPC-Aufrufe aus der Route (erst Mannschaften, dann Punkte): doppelte Arbeit je Seitenaufruf. Punkte im Browser aus Einzelendpunkten zusammensetzen: n Aufrufe, nicht atomar.

## 5. Welche Felder das Profil liefert

- **Decision**: Immer: Vorname, Nachname, Status, Mannschaften (Id, Name, Trikot, Position, aktiv, eigene Zeile, Rang, Gesamtpunkte, Punkte je Kategorie). Nur mit `training.manage` in mindestens einer sichtbaren Mannschaft der Person: zusätzlich `email` und `hasAccount`. Niemals: Geburtsjahr.
- **Rationale**: Entspricht dem Kader (`/teams/:id/players` liefert E-Mail nur an Trainer). Das Geburtsjahr braucht die erste Ausbaustufe nicht und ist bei Minderjährigen das heikelste Feld; es bleibt im Kader/Verzeichnis für die Berechtigten (FR-009, Spec-Annahme).
- **Alternatives**: Alter oder Geburtsjahr für Trainer: nicht verlangt (YAGNI).

## 6. Kategorienamen

- **Decision**: Die Funktion liefert Punkte je Kategorie-Id; die Route liest Name und Reihenfolge der Kategorien mit Punkten aus `playerboard_point_categories` (Service-Client, nur die Ids aus der eigenen Antwort, Verein vor Abteilung vor Mannschaft, dann `sort_order`, dann Name) und liefert fertige Listen `{ name, points }`.
- **Rationale**: Wie `PlayerboardRankingList` sie darstellt. Nicht über `playerboard_effective_categories`: Das liefert nur aktive, wirksame Kategorien; eine später deaktivierte Kategorie mit Punkten im Zeitraum fehlte, und die Kategorien ergäben nicht die Summe.
- **Alternatives**: Browser lädt Kategorien je Mannschaft nach (n+1 Aufrufe).

## 7. Namenslinks ohne Vertragsänderung

| Ansicht | Quelle der Person-Id |
|---|---|
| Punkteeingabe, Foto-Zuordnung, Kader | `PlayerboardPlayer.directoryPersonId` (vorhanden) |
| Rangliste, Saisonübersicht | `PlayerboardRankingEntry` hat nur `playerId`; `loadRankingItems` lädt den Kader bereits und bildet `playerId → directoryPersonId` |
| Veo-Saison (intern, `PlayerboardVeoOverview`) | Zeilen tragen nur `playerId`; die Übersicht lädt dafür den Kader (`GET /v1/playerboard/teams/:teamId/players`) und bildet `playerId → directoryPersonId`. Die öffentliche Seite nutzt dieselbe Komponente ohne `personId` und bekommt deshalb keine Links |
| Veo-Spielkarte | `playerId` je Zeile; der Kader (`rosterOptions`) liegt in der Karte vor, daraus `directoryPersonId` |

- **Decision**: Keine Änderung an den RPCs `playerboard_team_ranking` und den Veo-Schemas.
- **Rationale**: Eine Änderung der Rückgabetypen bräuchte `drop function` + Migration und gefährdete die öffentlichen Varianten; der Kader ist ohnehin geladen.
- **Alternatives**: `directoryPersonId` in `PlayerboardRankingEntry` und Veo-Match aufnehmen: sauberer, aber Migration und Vertragsänderung für ein reines Lookup.

## 8. Öffentliche Rangliste

- **Decision**: Keine Änderung. Die öffentliche Ansicht nutzt `PublicPlayerboardRankingEntry` ohne Ids (FR-005); `PlayerboardRankingList` bekommt `personId` nur für interne Einträge, und `PersonLink` rendert ohne `personId` reinen Text.
- **Rationale**: Es entsteht keine Möglichkeit, aus der öffentlichen Seite eine Id zu gewinnen, weil sie nie im Datensatz steht.

## 9. Klick auf Namen in klickbarer Zeile

- **Decision**: In `PlayerboardRankingList` ist die Zeile ein `<button>` (Aufklappen). Ein Link darf nicht in einem Button stehen. Zeile wird zu `<div>` mit zwei getrennten Steuerelementen: Namenslink und Aufklapp-Button (Chevron plus restliche Fläche).
- **Rationale**: Gültiges HTML, Tastaturbedienung, FR-012.

## 10. Ungespeicherte Punkte beim Klick

- **Decision**: Kein Zusatzcode. `PlayerboardPointEntry` flusht per `onBeforeRouteLeave` und fragt bei Fehlern nach (FR-013); `NuxtLink` löst diesen Guard aus.
- **Verifikation**: Test mit simuliertem Speicherfehler (Quickstart).
