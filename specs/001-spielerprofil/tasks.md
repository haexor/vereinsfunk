---

description: "Aufgabenliste für das Spielerprofil auf Vereinsebene"
---

# Tasks: Spielerprofil auf Vereinsebene

**Input**: Design-Dokumente aus `specs/001-spielerprofil/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/person-profile.md](contracts/person-profile.md), [quickstart.md](quickstart.md)

**Tests**: Eingeplant. `AGENTS.md` verlangt für jede neue exponierte Funktion positive und negative Isolationstests, und die Spec fordert sie in User Story 3. Testdateien liegen getrennt vom Produktionscode (Constitution).

**Organization**: Nach User Stories geordnet. Lieferung in zwei PRs (siehe plan.md):

- **PR 1 – Profil**: Phase 1–5 (Foundation, US1, US3, US4)
- **PR 2 – Links überall**: Phase 6 (US2), baut auf dem gemergten PR 1 auf

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 Vom Namen zum Profil · US2 Überall derselbe Link · US3 Rechte · US4 Saisonverlauf

## Path Conventions

Monorepo, Arbeitsverzeichnis ist der Worktree `.worktrees/spielerprofil`. Pfade unten sind relativ zu dessen Wurzel.

---

## Phase 1: Setup

- [X] T001 Ausgangslage sichern: im Worktree `pnpm install`, `pnpm db:reset`, dann `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test` ausführen und notieren, was vor der Änderung schon rot ist (keine Dateiänderung)

---

## Phase 2: Foundational (blockiert alle Stories)

**⚠️ CRITICAL**: Vertrag, Datenbankfunktion und Link-Komponente werden von allen Stories gebraucht.

- [X] T002 [P] Zod-Vertrag `PersonProfileSchema` und `PersonProfileQuerySchema` in `packages/contracts/src/personProfile.ts` anlegen und in `packages/contracts/src/index.ts` exportieren. Form exakt nach [contracts/person-profile.md](contracts/person-profile.md): `id` UUID, `firstName`, `lastName`, `status` (`DirectoryPersonStatusSchema`), `teams[]` mit `teamId`, `teamName`, `playerId`, `jerseyNumber` (nullable), `position` (nullable), `active`, `isSelf`, `rank` (nullable: ein inaktiver Spieler ohne Punkte im Zeitraum steht nicht in der Rangliste), `total`, `categories[] { name, points }`; `email` und `hasAccount` **optional** (fehlen als Schlüssel, nicht `null`); **kein** Geburtsjahr, kein `isMinor`. Query: `period` ∈ `season | all`, Standard `season`; Pfad-`id` ist `UuidSchema`
- [X] T003 [P] Vertragstest in `packages/contracts/src/personProfile.test.ts`: gültiges Profil wird akzeptiert; fehlendes `email` ist gültig; unbekannter `period`-Wert wird abgelehnt; Standardwert `season`; `birthYear` und `isMinor` sind im geparsten Ergebnis nicht vorhanden
- [X] T004 [P] pgTAP-Test `supabase/tests/person_profile.test.sql` schreiben (erste Anweisung `begin;`, letzte `rollback;`, sonst schlägt `pnpm db:test:isolation` an). Muster: `supabase/tests/playerboard_ranking_places.test.sql`. Fälle (alle müssen vor T005 fehlschlagen):
  - `authz.current_season_start`: dieselben Fälle wie `currentSeasonStart` in `packages/domain/src/playerboard.test.ts` (`2026-07-01`/`2026-10-08` → `2026-07-01`; `2026-07-01`/`2027-03-15` → `2026-07-01`; `2020-08-15`/`2026-08-15` → `2026-08-15`; `null` → `null`; `2024-02-29`/`2025-03-01` → `2025-02-28`; `2024-02-29`/`2025-02-27` → `2024-02-29`)
  - Trainer der Mannschaft ruft Spieler seiner Mannschaft ab → Profil mit Mannschaft, Trikot, Position, Punkten
  - Spieler ruft Mitspieler ab (`stats_visibility` = `team`) → Profil
  - Spieler ruft Person aus Nachbarmannschaft ohne Sicht ab → `null`
  - Mitglied eines **anderen Vereins** → `null`, wie bei unbekannter UUID
  - Unbekannte UUID → `null`
  - Person in zwei Mannschaften, Betrachter sieht nur eine → genau ein Eintrag in `teams`
  - Person ohne Kader, Betrachter mit `directory.read` → Profil mit leerem `teams`
  - Person ohne Kader, Betrachter ohne `directory.read` und ohne Mannschaftssicht → `null`
  - `period` = `season` und `all` liefern bei gesetztem Saisonbeginn unterschiedliche Summen; `period` = `foo` löst `invalid_period` aus
  - `teams[].total`/`categoryTotals` gleich `public.playerboard_team_ranking` für denselben Zeitraum
  - Entwurf-Training zählt nicht mit
  - Rückgabe enthält weder Geburtsjahr noch E-Mail
- [X] T005 Migration `supabase/migrations/2026101701_person_profile.sql` (Zeitstempel muss `pnpm db:test:timestamps` bestehen und größer als `2026101301` sein): `authz.current_season_start(season_start date, today date) returns date` (`immutable`, Regeln siehe [data-model.md](data-model.md)) und `public.person_profile(target_person_id uuid, period text default 'season') returns jsonb`. `security definer`, `set search_path = public, pg_temp`, `revoke all ... from public`, `grant execute ... to authenticated, service_role`. Sichtbar nach research.md §2: `authz.can_view_playerboard_stats(team_id)` für mindestens eine Kadermannschaft der Person **oder** dieselbe Bedingung wie `directory_people_select` (`authz.has_organization_permission`/`has_department_permission`/`has_team_permission` mit `directory.read`); sonst `null`, ebenso bei unbekannter Id. `teams` nur für Mannschaften mit `can_view_playerboard_stats`; Punkte aus `authz.playerboard_ranking_rows(team, from, to)` gefiltert auf die Person; `from` bei `season` aus `authz.playerboard_setting(org, dept, team, 'season_start')` und dem heutigen Datum in `organizations.timezone`; `isSelf` = `directory_people.profile_id = auth.uid()`; Verknüpfungen nur über zusammengesetzte Schlüssel `(organization_id, …)`. Liefert **nie** Geburtsjahr, E-Mail oder Konto-Id. Danach `pnpm db:reset` und T004 muss grün sein
- [X] T006 [P] Komponente `apps/web/app/components/PersonLink.vue`: Prop `personId` (`string | null | undefined`), Slot für den Namen. Mit `personId` ein `NuxtLink` auf `/personen/${personId}` mit `focus-ring`, ohne `target="_blank"`; ohne `personId` den Slot als reinen Text (`<span>`, kein Link, kein Fokusziel). Stil und Namensgebung wie die übrigen Komponenten (Deutsch in Kommentaren, kurzer Zweckkommentar oben)
- [X] T007 [P] Test `apps/web/app/utils/personProfile.test.ts` mit der reinen Funktion `personProfilePath` in `apps/web/app/utils/personProfile.ts`: mit Id `/personen/<id>`, ohne Id (`null`, `undefined`, leer) kein Pfad, die Id wird kodiert; dazu ein Quelltext-Test, dass `PersonLink.vue` genau diese Funktion benutzt (Muster: `appPageLayout.test.ts`). **Abweichung**: Das Web-Paket mountet keine Komponenten (kein `@vue/test-utils`, keine DOM-Umgebung); eine neue Abhängigkeit wäre gegen die Constitution

**Checkpoint**: `pnpm db:test`, `pnpm --filter @vereinsfunk/contracts test` und der Web-Test von `PersonLink` sind grün.

---

## Phase 3: User Story 1 – Vom Namen direkt zum Profil (Priority: P1) 🎯 MVP

**Goal**: Aus der Punkteeingabe im Training erreicht man mit einem Klick das Profil einer Person mit Name, Mannschaften (Trikot, Position) und Saisonpunkten.

**Independent Test**: Auf `/playerboard/trainings/<id>` einen Spielernamen anklicken; `/personen/<id>` zeigt genau diese Person. Eine Person in zwei Mannschaften erscheint als ein Profil mit zwei Karten (Quickstart 2.1–2.4).

### Tests for User Story 1

- [X] T008 [P] [US1] Routentest `apps/api/src/personProfile.routes.test.ts` (Muster und Fakes: `playerboard.routes.test.ts`, `testSupport.ts`): `200` mit gültigem `PersonProfile` bei sichtbarer Person; `401` ohne Anmeldung; `400` bei ungültiger UUID; `404 { error: 'not_found' }`, wenn die RPC `null` liefert; Kategorienamen in der Reihenfolge der Mannschaft; Header `Cache-Control: private, no-store`

### Implementation for User Story 1

- [X] T009 [US1] Route `apps/api/src/routes/playerboard/personProfile.ts`: `GET /v1/people/:id/profile` nach [contracts/person-profile.md](contracts/person-profile.md). `requireAuth`, Pfad mit `UuidSchema`, Query mit `PersonProfileQuerySchema`; RPC `person_profile` über `supabaseClients.forUser(...)`; `null` → `404 { error: 'not_found', correlationId: request.id }`; **keine** Scope-Vorabprüfung (sie verriete die Existenz); Kategorienamen und Reihenfolge aus `playerboard_point_categories` (Service-Client, nur die Ids aus der eigenen Antwort; Punkte je Kategorie-Id → `{ name, points }`, Verein vor Abteilung vor Mannschaft, dann `sort_order`, dann Name). **Abweichung**: nicht über `playerboard_effective_categories`, sonst fehlten inzwischen deaktivierte Kategorien mit Punkten und die Summe stimmte nicht mit dem Gesamtwert überein; Antwort mit `PersonProfileSchema.parse`; Header `Cache-Control: private, no-store`. Registrierung in `apps/api/src/routes/playerboard/index.ts`. Keine Payload- oder Namen-Logs
- [X] T010 [US1] Profilseite `apps/web/app/pages/personen/[id].vue`: lädt mit `useApiClient().request('/v1/people/<id>/profile', {}, PersonProfileSchema)`; Kopf mit Name und Statuskennzeichen für inaktiv bzw. ausgetreten; je Mannschaft eine Karte mit Name, Trikot (`–` ohne Nummer wie in `PlayerboardPointEntry`), Position, Rang, Gesamtpunkten; Zurück-Link (`router.back()`, Fallback `/`); bei `404` eine verständliche Karte „Person nicht gefunden“ ohne technische Details (FR-014), Fehlerbehandlung wie `trainings/[id].vue` (`playerboardErrorMessage`); Layout und Klassen wie die Trainingsseite
- [X] T011 [US1] Spielername in `apps/web/app/components/PlayerboardPointEntry.vue` (Zeile 145) in `PersonLink` mit `player.directoryPersonId` setzen; `truncate` und Zeilenlayout bleiben, die `aria-label` der Schaltflächen bleiben unverändert
- [X] T012 [US1] Manuell prüfen (Skill `run-web`): Quickstart 2.1, 2.2, 2.4 und 2.5 (FR-013: mit blockiertem Netz Punkte ändern, dann Namen anklicken → Rückfrage erscheint, keine Werte gehen verloren). Ergebnis für den PR-Text festhalten

**Checkpoint**: US1 ist allein nutzbar und testbar.

---

## Phase 4: User Story 3 – Profil zeigt nur, was man sehen darf (Priority: P1)

**Goal**: Trainer sehen zusätzlich E-Mail und Kontostatus; Mitspieler nicht; Fremde erfahren nicht, ob die Person existiert; Minderjährige geben nichts preis, was Mitspieler nichts angeht.

**Independent Test**: Dasselbe Profil mit Trainer-, Mitspieler- und Fremdkonto öffnen (Quickstart 2.9, 2.10).

### Tests for User Story 3

- [X] T013 [P] [US3] Routentest in `apps/api/src/personProfile.routes.test.ts` erweitern: Nicht-Trainer → Antwort **ohne** die Schlüssel `email` und `hasAccount`; Trainer (`training.manage` in einer sichtbaren Mannschaft) → beide vorhanden; Antwort einer minderjährigen Person enthält weder `birthYear` noch `isMinor`; unbekannte und nicht sichtbare Person liefern `404` mit identischem Body außer `correlationId`

### Implementation for User Story 3

- [X] T014 [US3] In `apps/api/src/routes/playerboard/personProfile.ts` Verwaltungsfelder ergänzen: je Mannschaft in `teams` den Scope über `loadTeamScope` (`routes/playerboard/shared.ts`) auflösen, `hasPermission(await roleProvider.rolesForScope(...), 'training.manage')` prüfen (Muster: `players.ts`, `GET .../players`); nur wenn mindestens eine Mannschaft das Recht gibt, `email` und `profile_id` der Person per Service-Client aus `directory_people` lesen (nur diese Spalten, **nie** `birth_year`) und `email` sowie `hasAccount` (`profile_id is not null`) setzen. Sonst Schlüssel weglassen
- [X] T015 [US3] In `apps/web/app/pages/personen/[id].vue` einen Abschnitt „Verwaltung“ mit E-Mail und Kontostatus einblenden, nur wenn `profile.email !== undefined`

**Checkpoint**: T013 grün, Quickstart 2.9 und 2.10 bestanden.

---

## Phase 5: User Story 4 – Saisonverlauf im Profil (Priority: P2)

**Goal**: Punkte je Mannschaft und Kategorie, Umschalter „Laufende Saison / Gesamte Zeit“, klarer Hinweis ohne Punkte.

**Independent Test**: Profil einer Person mit Punkten in zwei Mannschaften öffnen; Summen stimmen mit der Saisonübersicht der jeweiligen Mannschaft überein (Quickstart 2.3).

### Tests for User Story 4

- [X] T016 [P] [US4] Routentest in `apps/api/src/personProfile.routes.test.ts` erweitern: ohne Query geht `period = 'season'` an die RPC; `?period=all` wird durchgereicht; `?period=foo` → `400 invalid_request`

### Implementation for User Story 4

- [X] T017 [US4] In `apps/web/app/pages/personen/[id].vue` Umschalter „Laufende Saison“ / „Gesamte Zeit“ (Standard Saison) ergänzen, der `period` als Query an den Endpoint gibt und neu lädt; je Mannschaftskarte die Punkte je Kategorie aufklappbar (Muster: `PlayerboardRankingList.vue`, Aufklappen per Button); bei `total === 0` und leeren `categories` der Hinweis „Noch keine Punkte in diesem Zeitraum“ statt leerer Fläche; Bedienelemente ≥ 44 px und auf 360 px ohne Querscrollen
- [X] T018 [US4] Manuell prüfen (Skill `run-web`): Quickstart 2.3 – Summen je Mannschaft und Zeitraum mit der Rangliste vergleichen (`/playerboard/rangliste`, Zeitraum „Saison“ bzw. „Alle“)

**Checkpoint**: PR 1 vollständig. Vor dem PR: Phase 7 (T028–T030) für diesen Stand ausführen.

---

## Phase 6: User Story 2 – Überall derselbe Link (Priority: P1, PR 2)

**Goal**: Jeder Spielername mit zugeordneter Person ist in allen internen Ansichten ein Link; die öffentliche Rangliste bleibt anonym.

**Independent Test**: Jede Ansicht mit Spielern öffnen und jeden Namen anklicken (Quickstart 2.6–2.8, 2.11).

**Voraussetzung**: PR 1 ist in `main` gemergt und der Branch ist darauf aktualisiert. **Stand**: PR 2 wurde auf demselben Branch ohne vorherigen Merge umgesetzt; beim Committen die Dateien beider PRs getrennt halten.

### Tests for User Story 2

- [X] T019 [P] [US2] Test `apps/web/app/components/PlayerboardRankingList.test.ts` (Quelltext-Test im Stil von `appPageLayout.test.ts`, weil das Web-Paket keine Komponenten mountet; die Entscheidung Link/Text liegt in `personProfilePath`): Eintrag mit `personId` → Namenslink auf `/personen/<id>`; Eintrag ohne `personId` → reiner Text, kein `<a>`; Klick auf den Aufklapp-Knopf klappt die Kategorien auf, ohne zu navigieren; Namenslink und Aufklapp-Knopf sind getrennte, tastaturerreichbare Steuerelemente; Eintrag ohne Kategorien hat deaktivierten Aufklapp-Knopf, der Namenslink bleibt aktiv

### Implementation for User Story 2

- [X] T020 [US2] `RankingListItem` in `apps/web/app/utils/playerboardRanking.ts` um `personId?: string` erweitern; in `apps/web/app/composables/usePlayerboardRanking.ts` (`loadRankingItems`) `personId` je Eintrag aus dem bereits geladenen Kader (`playerId → directoryPersonId`) setzen. Keine Änderung an RPC oder Ranglistenvertrag (research.md §7)
- [X] T021 [US2] `apps/web/app/components/PlayerboardRankingList.vue`: Zeile von einem `<button>` auf ein `<div>` mit zwei Steuerelementen umbauen (Link in einem Button ist ungültig): Namenslink über `PersonLink` und ein Aufklapp-Knopf (Chevron samt übriger Fläche), `aria-expanded` und `disabled`-Verhalten bleiben; Medaillen- und „Du“-Hervorhebung unverändert (research.md §9). Deckt nur die interne Rangliste `/playerboard/rangliste` ab. **Korrektur**: `PlayerboardSeasonSummary.vue` (Übersicht `/playerboard` und Kachel auf der Startseite) hat eigenes Listen-Markup und bekommt den `PersonLink` dort direkt
- [X] T022 [P] [US2] Kader `apps/web/app/pages/playerboard/kader.vue` (Zeile 259): Name in `PersonLink` mit `player.directoryPersonId`
- [X] T023 [P] [US2] Foto-Zuordnung `apps/web/app/components/PlayerboardTrainingPhotos.vue`: Name in der Zuordnungsliste (Zeile 234) und die Namen im Hinweis „Ohne gültige Einwilligung: …“ (Zeile 241, bisher ein per `join(', ')` gebauter Text) als `PersonLink`, durch Kommas getrennt
- [X] T024 [P] [US2] Veo-Tabellen: `VeoPlayerTableRow` in `apps/web/app/components/PlayerboardVeoPlayerTable.vue` um `personId?: string | null` erweitern und das Standard-Label über `PersonLink` ausgeben. Saison: `PlayerStatRowInput` und `PlayerSeasonRow` in `apps/web/app/utils/playerboardVeo.ts` um optionales `personId` erweitern (`playerSeasonRows` übernimmt es), `PlayerboardVeoOverview.vue` lädt den Kader der Mannschaft (`PlayerboardPlayerSchema.array()`, `GET /v1/playerboard/teams/:teamId/players`) und setzt `personId` je Zeile über `playerId`; die öffentliche Mannschaftsseite (`PlayerboardVeoSeason` mit Label-Zeilen) setzt kein `personId` und bleibt ohne Links. Spielkarte: `PlayerboardVeoMatchCard.vue` bekommt `personId` je Zeile von der Seite `pages/playerboard/spiele.vue`, die den Kader jetzt für alle lädt (bisher nur für Trainer; für andere ist ein Ausfall des Kaders folgenlos, es fehlen nur die Links); Zeile ohne Zuordnung bleibt Text und `muted`. Der Zuordnungsmodus mit `<select>` (`#label`-Slot) bleibt unverändert. Test: `apps/web/app/utils/playerboardVeo.test.ts` um den Fall „`personId` bleibt in der Saisonzeile erhalten, fehlt es, bleibt es leer“ ergänzen
- [X] T025 [P] [US2] `apps/web/app/pages/playerboard/einstellungen.vue` (Zeile 323): Spielernamen in der Liste in `PersonLink` setzen
- [X] T026 [US2] Prüfen, dass keine öffentliche Ansicht Links erhält (FR-005): `apps/web/app/pages/mannschaft/[orgSlug]/[teamSlug].vue` und die Komponenten, die sie nutzt, reichen kein `personId` durch; `PublicPlayerboardRankingEntrySchema` und `PublicPlayerboardVeoMatchSchema` bleiben unverändert (keine Ids). In `PlayerboardRankingList.test.ts` ist der Fall „ohne `personId` kein Link“ bereits abgedeckt
- [X] T027 [US2] Manuell geprüft (Skill `run-web`, 18 von 18 Prüfungen, Demo-Daten danach entfernt): Quickstart 2.6, 2.7, 2.8 und 2.11; Veo-Spielkarte, Veo-Saison, Kader, Fotos, Rangliste, Startseitenkachel, öffentliche Mannschaftsseite abgemeldet (kein `/personen/` im DOM)

**Checkpoint**: Alle Stories funktionieren.

---

## Phase 7: Polish & Cross-Cutting

- [X] T028 [P] Ergebnisdokument `plans/058-spielerprofil.md` nach Repo-Konvention (Ergebnis, Umsetzung, Verifikation, Abweichungen; Muster `plans/057-anmeldung-per-magic-link.md`); Nummer vorher gegen `origin/main` prüfen. Abweichungen von der Spec dokumentieren: kein Geburtsjahr, Zeitraum statt benannter Saisons, Entwürfe zählen nie. Wenn `docs/product/implementation-plan.md` Pakete führt, dort ergänzen
- [X] T029 Definition of Done aus `AGENTS.md` je PR: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:test`; Migration, RLS und Wiederherstellung betrachtet (neue Funktion ist rein lesend, Rollback = `drop function`); Ergebnis und eventuell übersprungene Prüfungen im PR-Text nennen
- [ ] T030 Quickstart vollständig mit `run-web` durchspielen und Screenshots der Schritte 2, 4, 9, 10 für den PR-Text sichern (keine echten personenbezogenen Daten, nur Testdaten)
- [ ] T031 Commits nach Conventional Commits je logischer Einheit (`feat(db): …`, `feat(api): …`, `feat(web): …`, `test: …`, `docs: …`), **ohne** zusätzliche Trailer-Zeilen (Constitution, MUST NOT). PR 1 und PR 2 nach `main` öffnen und per Rebase- oder Merge-Commit mergen, **nicht** squashen. Push und PR erst nach Rückfrage beim Auftraggeber

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** (blockiert alles) → **Phase 3 (US1)** → **Phase 4 (US3)** und **Phase 5 (US4)** (beide erweitern Route und Seite aus US1) → **PR 1** → **Phase 6 (US2)** → **Phase 7** je PR

### Innerhalb von Phase 2

- T002, T003, T004, T006, T007 sind unabhängig und parallel möglich
- T005 hängt von T004 ab (Test zuerst, muss fehlschlagen) und vom Ergebnis von T002 nicht
- T009 braucht T002 und T005; T010 braucht T002 und T009; T011 braucht T006

### User Story Dependencies

- **US1** braucht Phase 2
- **US3** und **US4** bauen auf Route (T009) und Seite (T010) von US1 auf; untereinander unabhängig, aber beide ändern dieselben zwei Dateien, daher nacheinander
- **US2** braucht nur `PersonLink` (T006) und eine existierende Zielseite (US1); wegen der Review-Größe als zweiter PR

### Parallel Opportunities

- Phase 2: T002 ‖ T003 ‖ T004 ‖ T006 ‖ T007
- US1: T008 ‖ T011 (nach T006)
- US3 und US4: T013 ‖ T016 (Tests in derselben Datei, bitte als getrennte Commits)
- US2: T019 ‖ T022 ‖ T023 ‖ T024 ‖ T025 (verschiedene Dateien)

## Parallel Example: Phase 2

```text
T002 packages/contracts/src/personProfile.ts
T003 packages/contracts/src/personProfile.test.ts
T004 supabase/tests/person_profile.test.sql
T006 apps/web/app/components/PersonLink.vue
T007 apps/web/app/components/PersonLink.test.ts
```

## Implementation Strategy

### MVP (PR 1)

1. Phase 1 und 2: Vertrag, Datenbankfunktion mit Isolationstests, `PersonLink`
2. US1: Route, Profilseite, Link im Training → **hier anhalten und prüfen**
3. US3: Verwaltungsfelder und Negativtests (Datenschutz ist Voraussetzung fürs Ausliefern, nicht optional)
4. US4: Zeitraum-Umschalter und Kategorien
5. Phase 7 für PR 1, dann PR öffnen (nach Rückfrage)

### Inkrement (PR 2)

6. US2 in einem Zug: Ranglisten-Umbau zuerst (T019–T021), dann die übrigen Ansichten parallel (T022–T025), dann Prüfung (T026–T027)

## Notes

- Neue benannte Artefakte (`PersonLink`, `person_profile`, `current_season_start`, `PersonProfileSchema`) sind in plan.md gegen graphify und Codesuche geprüft; es gibt keine Kandidaten zum Erweitern
- Keine neue Abhängigkeit, keine neue Tabelle, kein ADR (kein Core Principle betroffen)
- Test zuerst: T004, T008, T013, T016, T019 müssen vor der zugehörigen Umsetzung fehlschlagen
