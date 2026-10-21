---

description: "Aufgabenliste für die Veo-Analyse im PlayerBoard"
---

# Tasks: Veo-Analyse im PlayerBoard

**Input**: Design-Dokumente aus `specs/002-veo-analyse/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/veo-analysis.md](contracts/veo-analysis.md), [quickstart.md](quickstart.md), [scope.md](scope.md), [veo-ui-inventory.md](veo-ui-inventory.md)

**Tests**: Eingeplant.
- `AGENTS.md` verlangt für neue exponierte Tabellen und Funktionen positive und negative Isolationstests.
- Die Spec verlangt Gleichheit mit Veo (FR-002, SC-001). Die Rechenregeln werden deshalb gegen die Testdaten aus dem Testabruf geprüft.
- Testdateien liegen getrennt vom Produktionscode (Constitution).
- Das Web-Paket mountet keine Komponenten (keine DOM-Umgebung). Web-Tests prüfen reine Funktionen in `apps/web/app/utils/` und Quelltext-Verdrahtung, wie `appPageLayout.test.ts`.

**Organization**: Nach User Stories geordnet. Lieferung in sechs PRs (siehe plan.md):

| PR | Phasen | Inhalt |
|---|---|---|
| 1 | 1–2 | Datengrundlage. Wird er zu groß, teilen in 1a (T002–T012) und 1b (T013–T025). |
| 2 | 3 | US1 Spielauswertung der Mannschaft |
| 3 | 4 | US2 Spieler im Spiel |
| 4 | 5 | US3 Saison der Mannschaft |
| 5 | 6 | US4 Spieler über die Saison |
| 6 | 7–8 | US5 Spielbericht, Abschluss |

Jeder PR hat einen eigenen Topic-Branch von `main`, baut auf dem gemergten Vorgänger auf und hat eine eigene Migration. Das weicht von plan.md ab, wo eine einzige Migration steht: So bleibt jeder PR für sich einspielbar.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Datei, keine offene Abhängigkeit)
- **[Story]**: US1 Spiel der Mannschaft · US2 Spieler im Spiel · US3 Saison der Mannschaft · US4 Spieler über die Saison · US5 Spielbericht

## Path Conventions

Monorepo, das Arbeitsverzeichnis ist ein Worktree unter `.worktrees/`. Pfade sind relativ zu dessen Wurzel. Veo-Begriffe und Regeln stehen im Inventar; „Inv. §x“ verweist auf dessen Abschnitte.

---

## Phase 1: Setup (PR 1)

- [ ] T001 Ausgangslage sichern: `pnpm install`, `pnpm db:reset`, dann `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`. Notieren, was schon vor der Änderung rot ist. Keine Dateiänderung.
- [ ] T002 Lesender Testabruf gegen das Veo-Konto der C1 nach der Prüfliste in [research.md](research.md) („Testabruf: Prüfliste“, Punkte 1–10). Die Rohantworten bleiben außerhalb des Repos. Zugang wie vom Betreiber freigegeben. Hilfsdateien mit Zugangsdaten oder Cookie danach löschen. Ins Log nur die Form der Antworten, keine Werte.
- [ ] T003 `specs/002-veo-analyse/research.md` an den Befund anpassen: jede Markierung **[Testabruf]** durch das belegte Ergebnis ersetzen. Bei Abweichung die betroffene Entscheidung (R-01, R-03, R-05, R-06, R-07, R-10, R-12) samt `data-model.md` und `contracts/veo-analysis.md` nachziehen. Ist kein Tracking verfügbar: `playerboard_veo_tracks`, `GET …/tracks` und T029/T038 streichen und in `scope.md` „Heat map (Mannschaft)“ auf den Fallback aus R-05 setzen.
- [ ] T004 Anonymisierte Testdaten in `packages/veo-client/src/__fixtures__/` ablegen, eine JSON-Datei je Endpunkt aus R-01 (Name = Endpunkt, z. B. `match-events.json`, `player-heatmaps.json`). Dabei ersetzen:
  - Namen, `known_name`, Avatare und Video-URLs durch Platzhalter
  - Veo-IDs durch feste Dummy-IDs
  - Werte, Orte und Rückennummern bleiben erhalten

  Dazu `packages/veo-client/src/__fixtures__/README.md` mit Spiel, Analyseversion und Abrufdatum, ohne Namen.

---

## Phase 2: Foundational (PR 1, blockiert alle Stories)

**⚠️ CRITICAL**: Ohne gespeicherte Analysedaten zeigt keine Story etwas.

### Veo-Client

- [ ] T005 [P] `packages/veo-client/src/http.ts`: `VEO_HOSTS` um `dt3kfuz4eo879.cloudfront.net` erweitern, mit einem `ponytail:`-Kommentar nach R-12. Test in `packages/veo-client/src/client.test.ts`: Der Host ist erlaubt, ein fremder CloudFront-Host wird abgelehnt.
- [ ] T006 [P] Test `packages/veo-client/src/analysis.test.ts`, vor T007. Je Testdatei aus T004 wird geparst und die Felder nach [contracts/veo-analysis.md](contracts/veo-analysis.md) „Veo-Client“ geprüft. Fehlt ein Pflichtfeld oder hat ein Feld einen falschen Typ, kommt `VeoError('upstream_changed')`. 404 ergibt `null`. 401 oder 403 ergibt `auth_expired`.
- [ ] T007 `packages/veo-client/src/analysis.ts` anlegen und in `packages/veo-client/src/index.ts` exportieren:
  - Funktionen: `fetchMatchDetail` (Slug, `recordings[0].identifier`, `has_*`-Felder), `fetchProcessingStatus`, `fetchRasStatus` (daraus `analyticsVersion` `'1'|'1.1'|'2'` nach Inv. §1a.0.3), `fetchPeriods`, `fetchMatchEvents` (`aggregatedDuels=true`), `fetchPlayerHeatmaps(start, end)`, `fetchMatchDetails` (RAS, ein `filters=` je Halbzeit), `fetchMomentum`, `fetchPassingNetwork(periods)`, `fetchMatchReport`, `fetchTrackingWindow(start)`
  - Jede Antwort läuft durch ein Zod-Schema. Muster ist `parseOrChanged` in `client.ts`, gemeinsame Helfer werden dorthin exportiert statt kopiert.
  - Header wie die Veo-App: `Veo-App-Id: hazard`, `veo-agent: veo:svc:web-app`
  - Die Datei bleibt unter 500 Zeilen, sonst nach Endpunktgruppen teilen.
- [ ] T008 `packages/veo-client/src/client.ts`: `fetchPlayerStats` auf `{ type: 'match_all_players', match_id, team_id }` umstellen (R-07):
  - Ergebnis je Rückennummer `stats: { statType, category, value, periodValues }[]`
  - `CURATED_PLAYER_STATS` auf alle Typen aus Inv. §4.2.1 erweitern, mit den Kategorien `general`, `physical`, `attacking`, `distribution`, `defending`, `set_pieces`, `goalkeeping`
  - `parsePlayerStats` und die Tests in `client.test.ts` an die neue Form anpassen, inklusive `player.type: 'jersey_only'`

### Domain

- [ ] T009 [P] Test `packages/domain/src/veoPitch.test.ts`, vor T010:
  - Spiegelung je Halbzeit nach `own_side` für eigene und gegnerische Ereignisse (Regel aus Inv. §1a.7 `wt`, Ergebnis nach R-06 in [0,1])
  - Ereignis ohne Ort bleibt ohne Ort
  - Strafraumtest nach den Maßen aus Inv. §1a.7
  - Drittel (`x < 1/3`, `x > 2/3`)
  - Matrix-Decode base64 → `width × height` mit `direction_of_play = rightToLeft` gespiegelt (Inv. §4.2.2)
  - Heatmap-Raster 60 × 30 aus Positionsproben für einen Zeitabschnitt
  - Gewichtete Summe mehrerer Matrizen nach Spielsekunden, neu normiert (R-05)
  - Testdaten aus T004 benutzen, wo vorhanden
- [ ] T010 `packages/domain/src/veoPitch.ts` und Export in `packages/domain/src/index.ts`. Keine Framework-Abhängigkeit.

### Datenbank

- [ ] T011 [P] pgTAP `supabase/tests/playerboard_veo_analysis.test.sql`, vor T012. Erste Anweisung `begin;`, letzte `rollback;`, Muster `supabase/tests/playerboard_veo_views.test.sql`. Fälle:
  - Mitspieler liest `playerboard_veo_match_analysis`, `playerboard_veo_events`, `playerboard_veo_heatmaps` und `playerboard_veo_tracks` bei `stats_visibility = team`.
  - Nachbarmannschaft ohne Sicht und fremder Verein lesen 0 Zeilen.
  - Nachbarmannschaft bei `department` liest.
  - `authenticated` kann nicht `insert`, `update` oder `delete`.
  - `anon` hat keinen Zugriff.
  - `playerboard_veo_apply_analysis`:
    - mit nicht laufendem Lauf: `sync_run_not_running`
    - mit Spiel einer anderen Quelle: `unknown_match`
    - Zweiter Aufruf ersetzt Ereignisse und Heatmaps vollständig, ohne Dubletten.
    - Setzt `analysis_status`, `analysis_fetched_at` und `veo_match_slug`.
  - Check-Constraints: `x`/`y` außerhalb 0–1 wird abgelehnt; nur eins von beiden gesetzt wird abgelehnt; `period_number` 0 bei Ereignissen wird abgelehnt; `cells`-Länge ≠ `width × height` wird abgelehnt.
  - Löschen des Spiels kaskadiert.
  - `playerboard_public_veo_stats` liefert nach dem Schreiben einer Analyse dieselbe Ausgabe wie vorher.
- [ ] T012 Migration `supabase/migrations/2026102201_playerboard_veo_analysis.sql`. Der Zeitstempel muss `pnpm db:test:timestamps` bestehen und größer als der neueste auf `main` sein. Inhalt nach [data-model.md](data-model.md):
  - `playerboard_veo_matches`:
    - `veo_match_slug` text null, 1–200 Zeichen
    - `analysis_status` text not null default `'none'` check in (`none`, `pending`, `complete`, `unavailable`)
    - `analysis_fetched_at` timestamptz null, `analysis_refresh_requested_at` timestamptz null
  - `playerboard_veo_player_stats.period_values` jsonb not null default `'[]'` check `jsonb_typeof = 'array'`
  - Tabellen `playerboard_veo_match_analysis`, `playerboard_veo_events` (`unique (fixture_id, veo_event_id)`, Index `(organization_id, team_id, event_type)`), `playerboard_veo_heatmaps` (PK `(fixture_id, jersey_number, period_number)`, „0 = ganzes Spiel“) und `playerboard_veo_tracks` (PK `(fixture_id, track_key)`), jeweils mit:
    - allen Spalten und Checks aus data-model.md
    - zusammengesetztem Fremdschlüssel `(organization_id, team_id, fixture_id)` auf `playerboard_veo_matches` mit `on delete cascade`
    - RLS `enable` und `force`
    - Select-Policy `authz.can_view_playerboard_stats(team_id)`
    - `revoke all` von `anon`/`authenticated`, `grant select` an `authenticated`, `grant all` an `service_role`
  - `public.playerboard_veo_apply_analysis(p_run_id uuid, p_fixture_veo_match_id text, p_analysis jsonb) returns text`:
    - `security definer`, `set search_path = public, pg_temp`, nur `service_role`
    - Prüfungen wie `playerboard_veo_apply_match`: Lauf `running`, Spiel gehört über `playerboard_veo_links` zur Quelle des Laufs
    - Ersetzt alle Zeilen des Spiels in einer Transaktion.

  Danach `pnpm db:reset`. T011 muss grün sein.

### Abgleich im Worker

- [ ] T013 [P] Zod-Schema der Schreibdaten `PlayerboardVeoAnalysisWriteSchema` in `packages/contracts/src/playerboardVeoAnalysis.ts` (neu, Export in `packages/contracts/src/index.ts`): Form des `p_analysis`-JSON mit normierten Orten, Matrizen als base64 und Verfügbarkeit je Teil (`AnalysisPart`, `AvailabilityReason` aus dem Vertrag). Test `packages/contracts/src/playerboardVeoAnalysis.test.ts`: gültige Daten werden akzeptiert; `x` > 1, ein unbekannter Teil und eine unbekannte Begründung werden abgelehnt.
- [ ] T014 [P] Test `apps/worker/src/veoAnalysisSync.test.ts`, vor T015, mit Fake-`fetch` auf die Testdaten aus T004:
  - Ein Spiel wird zu genau einem Schreibaufruf mit normierten Orten.
  - Ein fehlender Teil (404) wird als `unavailable` mit Grund `not_provided` vermerkt.
  - `upstream_error` bekommt einen zweiten Versuch und lässt danach das Paket weg.
  - `upstream_changed` und `auth_expired` werden weitergereicht.
  - Halbzeiten nicht bestätigt: `pending` mit `periods_missing`.
  - Veo rechnet noch: `pending` mit `veo_processing`.
  - Ins Log kommen nur Zähler und Status.
- [ ] T015 `apps/worker/src/veoAnalysisSync.ts`: holt das Analysepaket eines Spiels mit den Funktionen aus T007, normiert mit `packages/domain` (T010), verdichtet Tracking auf 1 Hz und prüft mit dem Schema aus T013. Die Wiederholungsregel wird aus `veoSync.ts` übernommen (`withRetry` gemeinsam nutzen statt kopieren).
- [ ] T016 Test in `apps/worker/src/veoSync.test.ts` ergänzen, vor T017:
  - Analyse nur für Spiele, die `analysis_status in ('none', 'pending')` haben, deren Anstoß höchstens 14 Tage zurückliegt oder deren Mannschaft `analysis_refresh_requested_at` gesetzt hat.
  - Ein Fehler im Analysepaket lässt `apply_match` desselben Spiels bestehen, und der Lauf endet mit der Fehlerklasse.
  - Nach einem Lauf mit Neuladen ist `analysis_refresh_requested_at` geleert.
- [ ] T017 `apps/worker/src/veoSync.ts`: Nach `applyMatch` wird für passende Spiele `VeoAnalysisSync` aufgerufen und `repository.applyAnalysis` geschrieben. Die Regel bekommt einen `ponytail:`-Kommentar nach R-03. Im Repository `apps/worker/src/context.ts` kommen `analysisCandidates(teamId)`, `applyAnalysis(runId, veoMatchId, analysis)` (RPC aus T012) und `clearAnalysisRefresh(teamId)` dazu. `toMatchWrite` übernimmt die `periodValues` der Spieler aus T008.
- [ ] T018 Migration aus T012 ergänzen: `playerboard_veo_apply_match` schreibt `period_values` aus `players[].stats[].periodValues`. Den Test in `supabase/tests/playerboard_veo.test.sql` um diesen Fall ergänzen.

### „Analyse neu laden“

- [ ] T019 [P] `packages/contracts/src/playerboard.ts`: `PlayerboardVeoSyncRequestSchema` bekommt `refreshAnalysis: z.boolean().optional()` (bleibt `strict`).
- [ ] T020 Test in `apps/api/src/playerboardVeo.routes.test.ts`, vor T021: `POST /v1/playerboard/veo/sync` mit `refreshAnalysis: true` setzt `analysis_refresh_requested_at`. Ohne das Recht für „Jetzt abgleichen“ gibt es `403`.
- [ ] T021 `apps/api/src/routes/playerboard/veo.ts`: `refreshAnalysis` auswerten. Dafür eine kleine RPC in der Migration aus T012 (`playerboard_veo_request_analysis_refresh(team_id)`, Recht wie Sync) statt eines direkten Updates mit Service Role.
- [ ] T022 `apps/web/app/pages/playerboard/veo.vue` und `apps/web/app/composables/usePlayerboardVeo.ts`: Knopf „Analyse neu laden“ neben „Jetzt abgleichen“, mit Erklärung: „Holt die Spielanalysen aller Spiele erneut von Veo, z. B. nach Korrekturen in Veo.“

### Abschluss PR 1

- [ ] T023 [P] `apps/web/app/utils/playerboardVeo.ts`: Bezeichnungen korrigieren. `football_loose_total` wird „Ballgewinne (loser Ball)“, `football_interception_total` wird „Abfangen“, `football_duel_total` wird „Zweikämpfe“. Die neuen Typen aus T008 bekommen deutsche Bezeichnungen. Tests in `apps/web/app/utils/playerboardVeo.test.ts` anpassen.
- [ ] T024 Gesamtlauf: `pnpm lint`, `typecheck`, `test`, `build`, `db:test`. Danach lokal mit der C1 abgleichen und prüfen, dass für die Referenzspiele Analysezeilen existieren und `analysis_status = 'complete'` ist (per SQL-Zählung, ohne Inhalte auszugeben).
- [ ] T025 PR 1 öffnen: Conventional Commits, Rebase-Merge, Beschreibung mit Testabruf-Befund und Größe der Analysedaten je Spiel.

**Checkpoint**: Der Abgleich speichert Analysepakete, ohne Ansichten. Story-Phasen können beginnen.

---

## Phase 3: User Story 1 – Ein Spiel der Mannschaft auswerten (Priority: P1) 🎯 MVP (PR 2)

**Goal**: Spielwerte, Schusskarte, Heatmap mit Zeitabschnitt, Pass- und Ballbesitzdrittel, Passketten, Spielverlauf und Ereignisse je Spiel, gleich wie in Veo.

**Independent Test**: [quickstart.md](quickstart.md) §2, Schritte 1–3 ohne Spielertabelle und Spielerkarte, für drei Referenzspiele.

### Tests für User Story 1

- [ ] T026 [P] [US1] pgTAP `supabase/tests/playerboard_veo_match_analysis.test.sql`:
  - `playerboard_veo_match_analysis(team, fixture)` liefert für Mitspieler alle Teile.
  - Bei Nachbarmannschaft ohne Sicht, fremdem Verein, unbekanntem Spiel und Spiel einer anderen Mannschaft kommt `insufficient_permission`, bzw. dieselbe Antwort für „unbekannt“ und „nicht sichtbar“, wie in `playerboard_veo_team_matches` geregelt.
  - Gegnerereignisse haben kein `playerId`.
  - Eigene Ereignisse tragen das `playerId` der aktuellen Zuordnung.
  - `playerboard_veo_match_tracks` ist entsprechend geschützt.
- [ ] T027 [P] [US1] Test `packages/domain/src/veoMetrics.test.ts`, Teil Spiel, vor T028:
  - Gegenüberstellung inklusive `TotalAttempts` und `MissedShots` (Inv. §1a.2 `mt`/`gt`)
  - Ballbesitz % und Minuten mit „ohne Ballbesitz“ (Inv. §1a.3.1)
  - Treffer- und Abschlussquoten gesamt, innen und außen (Inv. §1a.7)
  - Drittel-Anteile Pässe und Ballbesitz (Inv. §1a.3.2–3)
  - Passketten-Buckets 3–9 und „+10“, „3 bis 5“, „6 oder mehr“, längste Kette (Inv. §1a.6)
  - Spielverlauf-Anteile je Seite und Vorzeichen-Normierung auf die Heimmannschaft (Inv. §1a.11)

  Erwartete Werte mit den Testdaten aus T004 und einem in Veo abgelesenen Referenzspiel.
- [ ] T028 [US1] `packages/domain/src/veoMetrics.ts`, Teil Spiel, und Export. Teilen, sobald die Datei gegen 500 Zeilen geht.
- [ ] T029 [P] [US1] Test `apps/api/src/playerboardVeoAnalysis.routes.test.ts`:
  - `GET …/veo/matches/:fixtureId/analysis` und `…/tracks`: Erst kommt die Prüfung des Moduls, dann die der Sicht.
  - Gleicher `404`-Body für unbekannt und nicht sichtbar.
  - Antwort entspricht dem Schema.
  - `tracks` ohne Positionsdaten ergibt `404`.

### Implementierung für User Story 1

- [ ] T030 [US1] Migration `supabase/migrations/<zeitstempel>_playerboard_veo_match_analysis.sql`:
  - `public.playerboard_veo_match_analysis(target_team_id uuid, target_fixture_id uuid) returns jsonb` und `public.playerboard_veo_match_tracks(…)`
  - `security definer`, Prüfung `authz.can_view_playerboard_stats` vorab, `grant execute` an `authenticated, service_role`
  - Form exakt nach [contracts/veo-analysis.md](contracts/veo-analysis.md) „analysis“, mit `veoUrl` aus `veo_match_slug`
- [ ] T031 [P] [US1] Schemas `PlayerboardVeoMatchAnalysisSchema` und `PlayerboardVeoMatchTracksSchema` in `packages/contracts/src/playerboardVeoAnalysis.ts`, mit Tests.
- [ ] T032 [US1] `apps/api/src/routes/playerboard/veoAnalysis.ts` (neu) mit `GET /v1/playerboard/teams/:teamId/veo/matches/:fixtureId/analysis` und `…/tracks`, registriert in `apps/api/src/routes/playerboard/index.ts`. Muster für Modulprüfung, Fehlerabbildung und Nutzer-Client ist `GET …/veo/matches` in `veo.ts`.
- [ ] T033 [P] [US1] `apps/web/app/components/PlayerboardPitch.vue`:
  - SVG-Spielfeld in den Varianten `full` (234 × 150), `half` und `landscape` (627 × 402)
  - Zonen-Overlays `thirds`, `3-lanes`, `5-lanes`, `9-zones`, `18-zones` (Maße aus Inv. §3.4)
  - Slot für Markierungen in normierten Koordinaten
  - Richtungspfeil und `aria`-Beschreibung über Prop
- [ ] T034 [P] [US1] `apps/web/app/components/PlayerboardPitchHeatmap.vue`: Canvas unter `PlayerboardPitch`. Rezept aus Inv. §3.6d: σ 0,8, bilinear, < 5 % transparent, Gamma 0,8, Verlauf Grün → Gelb → Orange. Die Rechenschritte liegen als reine Funktion in `packages/domain` (T010). Textersatz: „Schwerpunkt im <Drittel>“.
- [ ] T035 [P] [US1] `apps/web/app/components/PlayerboardVeoStatComparison.vue`: gespiegelte Balken wir/Gegner nach Inv. §1a.2, unterlegener Wert abgeschwächt, Ballbesitzminuten dreiteilig, Wahl der Halbzeit.
- [ ] T036 [P] [US1] `apps/web/app/components/PlayerboardVeoShotMap.vue`:
  - Tore und Schüsse beider Mannschaften auf dem Spielfeld
  - Filter nach Mannschaft und Halbzeit
  - Zahlen und Quoten aus T028
  - Liste „Schüsse ohne Ort“
  - Marker mit Link ins Veo-Video (`videoTimeMs − 3 s`, neuer Tab, R-11)
  - Tor und Schuss unterschieden durch Form und Füllung
- [ ] T037 [P] [US1] Komponenten `apps/web/app/components/PlayerboardVeoThirds.vue` (Pass- und Ballbesitzdrittel), `apps/web/app/components/PlayerboardVeoPassStrings.vue` (Histogramm und Kacheln) und `apps/web/app/components/PlayerboardVeoMomentum.vue` (geglätteter SVG-Pfad, Lücken außerhalb der Halbzeiten, Anteile je Seite).
- [ ] T038 [US1] Heatmap der Mannschaft:
  - Wahl der Halbzeit und Schieber für den Zeitabschnitt in 60-s-Schritten, mit `mm:ss`-Anzeige
  - Positionsdaten lädt der Composable bei Bedarf über `…/tracks`
  - Ohne Positionsdaten gilt der Fallback aus R-05.
- [ ] T039 [P] [US1] `apps/web/app/components/PlayerboardVeoEvents.vue`: Ereignisliste mit Zeitleiste, Filter nach Art, Mannschaft, Spieler und Halbzeit (Inv. §1a.12), Spielminute nach Inv. §3.3, Link ins Video je Eintrag.
- [ ] T040 [US1] `apps/web/app/composables/usePlayerboardVeoAnalysis.ts` und Seite `apps/web/app/pages/playerboard/spiele/[fixtureId].vue`:
  - Reiter Mannschaft | Spieler | Ereignisse (Reiter Spieler zunächst mit der bestehenden `PlayerboardVeoPlayerTable`)
  - Hinweise je Teil aus `availability` (FR-066), deutsche Erklärtexte „So liest du …“ je Grafik (FR-004)
  - Link „In Veo öffnen“
  - Ohne seitliches Scrollen bei 360 px
- [ ] T041 [US1] `apps/web/app/components/PlayerboardVeoMatchCard.vue` und `apps/web/app/pages/playerboard/spiele.vue`: Jede Spielkarte führt zur Spielauswertung.
- [ ] T042 [P] [US1] Web-Tests in `apps/web/app/utils/playerboardVeoAnalysis.test.ts`: Abbildung `availability` → Hinweistext, Video-Link aus Slug und Zeit, Formatierung der Minuten. Quelltext-Test, dass die Seite jede Teilansicht nur bei verfügbarem Teil rendert.
- [ ] T043 [US1] Prüfung nach [quickstart.md](quickstart.md) §2 (Teile von Story 1) und §4 mit `run-web`; Abweichungen von Veo beheben oder in `scope.md` begründen. PR 2 öffnen.

**Checkpoint**: Story 1 ist für sich nutzbar.

---

## Phase 4: User Story 2 – Spieler eines Spiels ansehen (Priority: P1) (PR 3)

**Goal**: Spielertabelle mit allen Werten und Spielerkarte mit Übersicht, Werten, Physis und Karten, gleich wie in Veo.

**Independent Test**: [quickstart.md](quickstart.md) §2, Schritt 3 (Spielertabelle und Spielerkarte).

- [ ] T044 [P] [US2] Test in `packages/domain/src/veoMetrics.test.ts`, Teil Spieler, vor T045:
  - Ableitungen aus Inv. §4.2.1: `MissedShots`, `passes_unsuccessful`, `passes_success_rate`, `GoalInvolvements`, `ConversionRate`, `TotalEvents`, Minuten aus Sekunden
  - Kacheln je Position aus Inv. §2.3 (alle Positionscodes und der Rückfall)
  - Standardspalten der Tabelle aus Inv. §2.2
- [ ] T045 [US2] `packages/domain/src/veoMetrics.ts`, Teil Spieler, mit dem Spalten- und Gruppenkatalog: Bezeichnungen und Kürzel deutsch, Gruppen Allgemein, Physis und Ereignisse.
- [ ] T046 [US2] `apps/web/app/components/PlayerboardVeoPlayerTable.vue` erweitern:
  - Spalten wählbar nach Gruppen, mindestens 1, gespeichert in `localStorage` unter `vereinsfunk.veo.match-columns`. Zugriffe in `try/catch`, sodass die Tabelle auch ohne Speicher funktioniert.
  - Jede Spalte sortierbar, `aria-sort`
  - Spielername als `PersonLink`, öffnet die Spielerkarte
  - nicht zugeordnete Nummern als „#7“ ohne Link, Zuordnung durch Trainer wie bisher
  - Tabelle scrollt in sich (`w-0 min-w-full`)
- [ ] T047 [US2] `apps/web/app/components/PlayerboardVeoPlayerCard.vue`:
  - Reiter Übersicht (4 Kacheln nach Position), Werte (Gruppen aus Inv. §2.3), Physis, Karten
  - Karten: Heatmap je Halbzeit mit Schieber über die Positionsdaten der Rückennummer, sonst Veo-Matrix der Halbzeit; Schusskarte im Halbfeld mit Toren, verfehlten Schüssen, Abschlüssen und Quote
  - Link „Profil öffnen“ (`PersonLink`)
  - Hinweise „Keine Rückennummer zugeordnet“ und „Von Veo nicht erkannt“
  - Als Dialog auf dem Handy, als Seitenleiste ab `lg`
- [ ] T048 [US2] Reiter Spieler in `apps/web/app/pages/playerboard/spiele/[fixtureId].vue` auf Tabelle und Karte umstellen. Die Halbzeitwahl wirkt auf die Tabelle (Werte je Halbzeit aus `periodValues`).
- [ ] T049 [P] [US2] Web-Tests in `apps/web/app/utils/playerboardVeoPlayers.test.ts`: Sortierung (Namen zuerst, fehlende Werte zuletzt, Zahlen beim ersten Klick absteigend, Inv. §2.1.2), Spaltenauswahl mit ungültigem Speicherinhalt ergibt Standard, Zeilen ohne Werte und ohne Position entfallen.
- [ ] T050 [US2] Prüfung nach [quickstart.md](quickstart.md) §2, Schritt 3, und §4. PR 3 öffnen.

**Checkpoint**: Story 1 und 2 laufen unabhängig voneinander.

---

## Phase 5: User Story 3 – Die Saison der Mannschaft verfolgen (Priority: P2) (PR 4)

**Goal**: Filter, Kennzahlen mit Verlauf, Form, Schusskarte und Zonen über Spiele, Vergleichsradar.

**Independent Test**: [quickstart.md](quickstart.md) §2, Schritt 5 (Mannschaft).

- [ ] T051 [P] [US3] pgTAP `supabase/tests/playerboard_veo_season.test.sql`:
  - `playerboard_veo_team_matches` mit Filtern: `kinds`; `last_n`; `fixture_ids` schließt andere Filter aus; die alte Signatur mit drei Argumenten liefert unverändert.
  - Neue Felder vorhanden: `kind`, `analysisStatus`, `thirds`, `periodValues`, `personId`.
  - `playerboard_veo_team_shots` mit Isolation positiv und negativ.
  - `playerboard_veo_team_views`: Standard ohne Zeile.
  - `playerboard_veo_save_team_views`:
    - ohne `training.manage` verweigert
    - mehr als 4 Kennzahlen abgelehnt
    - Radar ohne genau 6 Kennzahlen abgelehnt
    - Vergleichsmannschaft aus anderem Verein oder ohne Sicht abgelehnt
  - Isolation der Tabelle `playerboard_veo_team_views`
- [ ] T052 [US3] Migration `supabase/migrations/<zeitstempel>_playerboard_veo_season.sql`:
  - `playerboard_veo_team_matches` als Überladung mit `kinds text[]`, `fixture_ids uuid[]`, `last_n int` und den neuen Feldern; `authz.playerboard_veo_matches_json` entsprechend erweitern, die öffentliche Ausgabe unverändert lassen.
  - `playerboard_veo_team_shots`
  - Tabelle `playerboard_veo_team_views` nach [data-model.md](data-model.md): `key_metrics` text[] not null mit 0–4 Einträgen aus dem Kennzahlenkatalog; `radar` jsonb null; Fremdschlüssel `(organization_id, team_id)` auf `teams`; RLS lesen `can_view_playerboard_stats`, kein direktes Schreiben.
  - `playerboard_veo_team_views(team)` und `playerboard_veo_save_team_views(team, jsonb)`, Recht `training.manage`.
- [ ] T053 [P] [US3] Test in `packages/domain/src/veoMetrics.test.ts`, Teil Saison, vor T054:
  - Kennzahlenkatalog der Mannschaft aus Inv. §1b.3 (Tabelle „Edit key metrics modal“) mit Einheit und Berechnung je Spiel
  - Durchschnitt nur über Spiele mit Wert
  - Siegquote und Sieg/Remis/Niederlage (Inv. §1a.9)
  - Standardkennzahlen `[possession_percent, goals_scored, shots_on_goal]`
  - Radar-Normierung `own/max(own, cmp) * 0.9` und Standard-Radar (Inv. §1b.8)
  - Form der letzten 3 Spiele
- [ ] T054 [US3] `packages/domain/src/veoMetrics.ts`, Teil Saison.
- [ ] T055 [P] [US3] Contracts:
  - `PlayerboardVeoSeasonQuerySchema`, Erweiterung von `PlayerboardVeoMatchSchema`
  - `PlayerboardVeoShotsSchema` und `PlayerboardVeoTeamViewsSchema` mit `keyMetrics` 0–4 eindeutig und `radar.metrics` genau 6
  - Tests
- [ ] T056 [US3] API:
  - `GET …/veo/matches` mit Filtern (in `veo.ts`)
  - `GET …/veo/shots`, `GET` und `PUT …/veo/views` in `veoAnalysis.ts`; `PUT` mit Audit-Eintrag nach dem Muster in `routes/playerboard/settings.ts`; Fehler `422 invalid_metric`, `404 not_found`
  - Tests in `apps/api/src/playerboardVeoAnalysis.routes.test.ts`
- [ ] T057 [P] [US3] `apps/web/app/components/PlayerboardVeoFilters.vue`: Spielart, Zeitraum, „letzte n“, Einzelauswahl. Der Zustand liegt in der URL-Query, damit Links geteilt werden können.
- [ ] T058 [P] [US3] `apps/web/app/components/PlayerboardVeoKeyMetrics.vue`:
  - Karten mit Durchschnitt und Hilfetext, Verlauf als Balken je Spiel (7 Teilstriche, Inv. §1b.3), Siegquote mit S/U/N
  - Antippen eines Balkens zeigt Gegner, Datum, Ergebnis und Link zur Spielauswertung
  - Dialog „Kennzahlen bearbeiten“ (max. 4) nur mit `training.manage`
  - Hinweis, wenn nur ein Teil der Spiele beiträgt
- [ ] T059 [P] [US3] `apps/web/app/components/PlayerboardVeoRadar.vue`: Radar mit 6 Achsen, zwei Flächen, Gitter bei 25/50/75/100 %, Beschriftung „eigen · Vergleich“. Wahl einer Mannschaft des Vereins mit Veo-Verbindung und Sicht, oder „Keine“ (Zeitraumvergleich). Dialog „Kennzahlen bearbeiten“ (genau 6). Textersatz als Tabelle.
- [ ] T060 [US3] `apps/web/app/composables/usePlayerboardVeoSeason.ts` und Seite `apps/web/app/pages/playerboard/saison.vue`, Reiter Mannschaft: Filter, Kennzahlen, Schusskarte (`PlayerboardVeoShotMap` im Saisonmodus), Drittel, Radar. Navigation „Saison“ neben „Spiele“ in `apps/web/app/modules/registry.ts`.
- [ ] T061 [US3] Kopf der Spielauswertung (`spiele/[fixtureId].vue`): Kennzahlen der Mannschaft für dieses Spiel und Form der letzten 3 Spiele (Inv. §1a.9).
- [ ] T062 [US3] Prüfung nach [quickstart.md](quickstart.md) §2, Schritt 5 (Mannschaft), sowie §3 und §4. PR 4 öffnen.

**Checkpoint**: Story 3 nutzbar, Stories 1 und 2 unverändert.

---

## Phase 6: User Story 4 – Spieler über die Saison vergleichen (Priority: P2) (PR 5)

**Goal**: Ranglisten, Saisontabelle, Schusskarte und Heatmap je Spieler, Spielervergleich, Veo-Abschnitt im Spielerprofil.

**Independent Test**: [quickstart.md](quickstart.md) §2, Schritt 5 (Spieler), und das Profil einer Spielerin.

- [ ] T063 [P] [US4] pgTAP-Fälle in `supabase/tests/playerboard_veo_season.test.sql`:
  - `playerboard_veo_player_heatmaps`: Spieler mit wechselnden Rückennummern über Spiele; Isolation; Spieler einer anderen Mannschaft ergibt Fehler.
  - `person_profile` liefert `veo` nur für Mannschaften mit Verbindung und Sicht.
- [ ] T064 [US4] Migration `supabase/migrations/<zeitstempel>_playerboard_veo_player_season.sql`: `playerboard_veo_player_heatmaps(…)` nach [data-model.md](data-model.md); `person_profile` um `veo` je Mannschaft erweitern (Spec 001, `supabase/migrations/2026101701_person_profile.sql` als Ausgang).
- [ ] T065 [P] [US4] Test in `packages/domain/src/veoMetrics.test.ts`, Teil Spieler-Saison, vor T066:
  - Ranglisten: Top 5, Gleichstand nach Name, Gegner nie enthalten, Umrechnung der Quote ×100 und Sekunden in Minuten (Inv. §4.2.4)
  - Saisonsummen und -durchschnitte je Spieler über wechselnde Rückennummern
  - Vergleich mit gruppierten Werten und Hervorhebung des höheren Werts (Inv. §2.1.5)
  - Spiele, Startelf, Kapitän, „Spieler des Spiels“, soweit vorhanden
- [ ] T066 [US4] `packages/domain/src/veoMetrics.ts`, Teil Spieler-Saison.
- [ ] T067 [US4] API `GET …/veo/season/players/:playerId/heatmaps` in `veoAnalysis.ts` mit Tests. `apps/api/src/routes/playerboard/personProfile.ts` und `packages/contracts/src/personProfile.ts` liefern `veo: { teamId, playerId } | null`, mit Tests.
- [ ] T068 [P] [US4] `apps/web/app/components/PlayerboardVeoLeaderboards.vue`: Karten je Kennzahl, bis 3 wählbar (`localStorage` `vereinsfunk.veo.leaderboard-metrics`), Standards nach Inv. §2.1.1, Name führt zur Spielerkarte.
- [ ] T069 [P] [US4] `apps/web/app/components/PlayerboardVeoPlayerComparison.vue`: zwei Spieler wählbar (`localStorage` je Mannschaft), Gruppen aus Inv. §2.1.5, Heatmaps und Schusskarten nebeneinander.
- [ ] T070 [US4] Seite `apps/web/app/pages/playerboard/saison.vue`, Reiter Spieler:
  - Ranglisten
  - Saisontabelle (`PlayerboardVeoPlayerTable` im Saisonmodus mit Standardspalten aus Inv. §2.1.2)
  - Spieler-Schusskarte mit Filter Abschlüsse, Schüsse, Tore und Spielerliste
  - Positions-Heatmap mit Spielerliste
  - Vergleich
  - Spielerkarte im Saisonmodus
- [ ] T071 [US4] `apps/web/app/pages/personen/[id].vue`: Abschnitt „Spielanalyse“ je Mannschaft mit `veo` (Saisonwerte, Heatmap, Schusskarte), mit denselben Komponenten.
- [ ] T072 [US4] Prüfung nach [quickstart.md](quickstart.md) §2, Schritt 5 (Spieler), sowie §3 und §4. PR 5 öffnen.

**Checkpoint**: Stories 1–4 nutzbar.

---

## Phase 7: User Story 5 – Spielbericht lesen (Priority: P3) (PR 6)

**Goal**: Spielbericht mit sechs Abschnitten, gemeinsamer Sicht- und Halbzeitwahl und Vergleich mit den letzten Spielen.

**Independent Test**: [quickstart.md](quickstart.md) §2, Schritt 4.

- [ ] T073 [P] [US5] pgTAP in `supabase/tests/playerboard_veo_match_analysis.test.sql`: `playerboard_veo_match_report` liefert den Bericht mit `playerId`/`name` aus der Zuordnung, nur für sichtbare Mannschaften. Für Spiele ohne Bericht kommt `null`.
- [ ] T074 [US5] Migration `supabase/migrations/<zeitstempel>_playerboard_veo_match_report.sql`: `public.playerboard_veo_match_report(target_team_id, target_fixture_id) returns jsonb` (Form nach Vertrag „report“: Felder, die Veo nicht liefert, werden weggelassen, nicht genullt).
- [ ] T075 [P] [US5] Schema `PlayerboardVeoMatchReportSchema` (StatValue mit `fullTime`, `periods`, optional `comparison`) und Route `GET …/veo/matches/:fixtureId/report` in `veoAnalysis.ts`, mit Tests.
- [ ] T076 [P] [US5] Test in `packages/domain/src/veoMetrics.test.ts`, Teil Bericht, vor T077:
  - Spielminute (Inv. §3.3)
  - Kennzahlkarten-Vergleich nur bei `matchCount >= 2`, nur eigene Mannschaft und ganzes Spiel (Inv. §3.5)
  - Passrichtungen angekommen und nicht angekommen
  - Anteile Passorte in 9 Zonen
  - Breite der Passnetz-Kanten 1–8
  - Skalierung der Geschwindigkeitszonen (Inv. §3.10)
- [ ] T077 [US5] `packages/domain/src/veoMetrics.ts`, Teil Bericht.
- [ ] T078 [P] [US5] Komponenten `apps/web/app/components/PlayerboardVeoPassingNetwork.vue` und `apps/web/app/components/PlayerboardVeoSpeedZones.vue`. `apps/web/app/components/PlayerboardVeoEventMap.vue` mit Defensivaktionen: Form je Typ Raute, Dreieck, Sechseck, Quadrat, Quadrat ohne Füllung, einzeln ein- und ausblendbar (Inv. §3.9).
- [ ] T079 [US5] Seite `apps/web/app/pages/playerboard/spiele/[fixtureId]/bericht.vue`:
  - Abschnittsnavigation mit Ankern
  - Sicht (eigen oder Gegner) und Halbzeit wirken auf alle Abschnitte
  - Übersicht: Schlüsselereignisse mit Link ins Video, wichtige Spielwerte, Startaufstellung, Durchschnittsposition
  - Verteilung, Angriff (Donuts, Schusskarte mit Zonen), Verteidigung, Physis, Spielerwerte
  - Kennzahlkarten
  - Gegnerspieler nur mit Rückennummer
  - Link „Spielbericht“ in der Spielauswertung nur bei `hasReport`
- [ ] T080 [US5] Prüfung nach [quickstart.md](quickstart.md) §2, Schritt 4, und §4. PR 6 vorbereiten (zusammen mit Phase 8).

---

## Phase 8: Polish & Cross-Cutting (PR 6)

- [ ] T081 [P] `specs/002-veo-analyse/scope.md` auf den gelieferten Stand bringen: jede Zeile ✅, ⚠️ mit Begründung oder ➖. Keine Veo-Ansicht ohne Eintrag (SC-002).
- [ ] T082 [P] Verarbeitungsdokumentation (Paket 020): Zweck „Spielanalyse mit Positionsdaten“, Datenarten Ereignisse, Heatmaps und Positionen, Sichtbarkeit `stats_visibility`, Löschung mit Spiel oder Mannschaft (R-16). Ort wie bei Paket 052/053 dokumentiert.
- [ ] T083 [P] Ergebnisdokument `plans/059-veo-analyse.md` nach Repo-Konvention (wie `plans/053-playerboard-veo-anbindung.md`): Ergebnis, Abweichungen vom Plan, Funde aus dem Testabruf, verifizierte Prüfungen. Dazu ein Eintrag in `plans/README.md`.
- [ ] T084 Vollständiger Durchlauf nach [quickstart.md](quickstart.md) §1–5 für alle drei Referenzspiele (SC-001, SC-004, SC-005, SC-006). Abweichungen beheben oder in `scope.md` begründen.
- [ ] T085 PR 6 öffnen. Nach dem Merge den Betreiber an SC-007 erinnern (Befragung der Trainer nach vier Spielwochen).

---

## Dependencies & Execution Order

### Phasen

- **Setup (Phase 1)**: T002 braucht den Veo-Zugang. T003 und T004 hängen an T002.
- **Foundational (Phase 2)**: hängt an T003 und T004 und blockiert alle Stories. Innerhalb:
  - T005, T006, T009, T011, T013 und T019 können parallel laufen.
  - T007 nach T006, T008 nach T004, T010 nach T009, T012 nach T011.
  - T015 nach T007, T010, T013 und T014; T017 nach T012, T015 und T016; T021 nach T012 und T020.
- **US1 (Phase 3)**: nach PR 1. Die MVP-Story.
- **US2 (Phase 4)**: nach US1, weil sie die Seite `spiele/[fixtureId].vue`, `PlayerboardPitch` und die Heatmap-Komponente nutzt.
- **US3 (Phase 5)**: nach US1 (Schusskarte, Drittel). Unabhängig von US2.
- **US4 (Phase 6)**: nach US2 (Spielertabelle, Spielerkarte) und US3 (Filter, Saisonseite).
- **US5 (Phase 7)**: nach US1. Nutzt die Spielerwerte aus US2, wenn vorhanden.
- **Polish (Phase 8)**: nach allen Stories.

### Innerhalb jeder Story

Erst die Tests, die vorher fehlschlagen müssen, dann Migration, Contracts, Domain, API und Web, zuletzt die Prüfung nach quickstart.

## Parallel Example: User Story 1

```text
# Tests zuerst, parallel:
T026 pgTAP playerboard_veo_match_analysis.test.sql
T027 domain veoMetrics.test.ts (Spiel)
T029 API playerboardVeoAnalysis.routes.test.ts

# Danach parallel, je eigene Datei:
T033 PlayerboardPitch.vue
T034 PlayerboardPitchHeatmap.vue
T035 PlayerboardVeoStatComparison.vue
T036 PlayerboardVeoShotMap.vue
T037 Thirds / PassStrings / Momentum
T039 PlayerboardVeoEvents.vue
```

## Implementation Strategy

### MVP zuerst

1. Phase 1 und 2 (PR 1): Daten liegen vor, ohne neue Ansicht.
2. Phase 3 (PR 2): Spielauswertung der Mannschaft.
3. **Anhalten und prüfen**: mit den Trainern der C1 ein Wochenende nutzen und Rückmeldung einholen.

### Danach schrittweise

PR 3 (Spieler) und PR 4 (Saison Mannschaft) können parallel entstehen. Dann folgen PR 5 (Spieler-Saison) und PR 6 (Bericht und Abschluss). Jeder PR liefert für sich nutzbaren Wert und lässt die vorigen Ansichten unverändert.

## Notes

- Jede Grafik hat einen Textersatz und unterscheidet Markierungen nicht nur über Farbe (FR-067).
- Keine Werbung für Veo-Abos und keine Sperrhinweise (FR-066).
- Ins Log kommen nur Zähler, Fehlerklassen und HTTP-Status, nie Inhalte von Veo-Antworten.
- Commits ohne Hinweis auf Werkzeuge oder Agenten. Conventional Commits, Rebase-Merge.
