# Implementation Plan: Veo-Analyse im PlayerBoard

**Branch**: `feat/veo-analyse` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-veo-analyse/spec.md`

## Summary

Der bestehende Veo-Abgleich im Worker (Paket 053) holt künftig auch die Analysedaten eines Spiels. Er nutzt dafür die Endpunkte, die die Veo-Web-App selbst aufruft, und schreibt sie je Spiel als ein Paket in neue Tabellen (R-01 bis R-04):
- Halbzeiten
- Ereignisse beider Mannschaften mit normiertem Ort
- Spieler-Heatmaps je Halbzeit
- Positionsdaten
- Pässe und Ballbesitz je Drittel
- Spielverlauf
- Passnetz
- Spielbericht

Die API liest daraus über `security definer`-Funktionen mit der bestehenden Sichtprüfung `authz.can_view_playerboard_stats`. Damit gilt `stats_visibility` unverändert, auch für Karten einzelner Spieler.

Alle Ableitungen nach Veos Regeln sind reine Funktionen in `packages/domain`: Quoten, Drittel, Passketten, Saisondurchschnitte, Ranglisten, Radar und Kacheln je Position. Die Oberfläche besteht aus handgeschriebenen SVG-Komponenten auf einem gemeinsamen Spielfeld. Heatmaps zeichnet ein Canvas nach Veos Rezept.

Geliefert wird in sechs PRs entlang der User Stories. PR 1 beginnt mit dem lesenden Testabruf gegen das Veo-Konto der C1, der die Annahmen aus dem Inventar belegt.

## Technical Context

**Language/Version**: TypeScript (strict), Node 24 (`.nvmrc`), SQL (PostgreSQL 17 via Supabase)

**Primary Dependencies**: Nuxt 4 / Vue 3 (`apps/web`), Fastify (`apps/api`), Hatchet-Worker (`apps/worker`), Zod (`packages/contracts`, `packages/veo-client`), Supabase JS. Keine neue Abhängigkeit (R-14).

**Storage**: Supabase Postgres, selbst gehostet. Fünf neue Tabellen und Spalten an zwei bestehenden Tabellen ([data-model.md](data-model.md)), Migration `2026102201_playerboard_veo_analysis.sql`.

**Testing**:
- Vitest für `packages/veo-client`, `packages/domain`, `apps/worker`, `apps/api` und `apps/web`
- pgTAP über `pnpm db:test`, mit positiven und negativen Isolationsfällen
- Skill `run-web` für die Sichtprüfung bei 360 px
- Vergleich mit Veo an drei Referenzspielen ([quickstart.md](quickstart.md))

**Target Platform**: Browser (mobil ab 360 px, Desktop), Fastify-API, Hatchet-Worker auf `haex.space`

**Project Type**: Web-Anwendung im Monorepo (`apps/web`, `apps/api`, `apps/worker`, `packages/*`, `supabase/`)

**Performance Goals**:
- Spielauswertung, Spielerkarte und Saisonsicht in unter 2 s bei 40 Spielen und 25 Spielern (SC-004)
- je Ansicht ein Lese-RPC, für Positionsdaten ein zweiter Abruf auf Anforderung
- ein Abgleich mit 40 Spielen holt Analysen nur für neue, ausstehende oder höchstens 14 Tage alte Spiele (R-03)

**Constraints**:
- Mandantentrennung per RLS und in den Funktionen
- Service Role nur in API und Worker
- Zod an jeder Systemgrenze, auch an jeder Veo-Antwort
- Gegner nie mit Namen
- öffentliche Seite unverändert
- keine Inhalte von Antworten im Log
- inoffizielle Veo-API: eine geänderte Form ergibt `upstream_changed` statt falscher Werte

**Scale/Scope**:
- eine Mannschaft mit Veo-Verbindung (C1), ausgelegt auf mehrere
- je Saison bis 40 Spiele, etwa 60.000 Ereignisse und etwa 25 MB Analysedaten (R-15)
- 6 PRs, ungefähr 16 neue Vue-Komponenten

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Geprüft gegen `.spaex/constitution.md` und `AGENTS.md`. `.specify/memory/constitution.md` ist eine unausgefüllte Vorlage und enthält keine Regeln.

| Regel | Stand |
|---|---|
| Änderung im Worktree auf Topic-Branch | ✅ `.worktrees/veo-analyse`, `feat/veo-analyse`; je PR ein eigener Branch davon |
| graphify vor neuen benannten Artefakten | ✅ Abfragen „chart component svg bar comparison“, „pitch football field svg heatmap“ und „season aggregation player stats sum average“ (Budget 800). Ergebnisse siehe unten. |
| Tests getrennt vom Produktionscode | ✅ `*.test.ts`, `*.routes.test.ts`, pgTAP unter `supabase/tests`, Testdaten unter `__fixtures__` |
| Dateien nicht deutlich über 500 Zeilen | ✅ `veo-client` bekommt `analysis.ts` statt `client.ts` zu vergrößern. Die Analyse-Routen bekommen `routes/playerboard/veoAnalysis.ts`, weil `veo.ts` schon 367 Zeilen hat. Die Domain-Logik wird in `veoPitch.ts` und `veoMetrics.ts` geteilt. |
| Keine Spekulation, keine neue Abhängigkeit | ✅ Siehe Complexity Tracking. Positionsdaten sind für die C1 im Testabruf belegt (R-05). |
| Wiederverwenden vor Neubauen (graphify-first) | ✅ Erweitert statt neu: `playerboard_veo_team_matches` mit Endpunkt, `PlayerboardVeoPlayerTable.vue`, `fetchPlayerStats`, `VeoSyncExecutor`, `POST /veo/sync`, Personenprofil. Bestehende Ableitungen aus `apps/web/app/utils/playerboardVeo.ts` ziehen nach `packages/domain` um. |
| Keine Agent-Verweise in Artefakten und Commits (MUST NOT) | ✅ Commits ohne zusätzliche Trailer. Das Inventar ist neutral formuliert, lokale Pfade sind entfernt. |
| Keine lokalen absoluten Pfade, keine Secrets im Repo | ✅ Testdaten werden anonymisiert: Namen, Avatare, Video-URLs und IDs werden ersetzt. Das Veo-Cookie bleibt in `integration_source_secrets`. |
| Conventional Commits, PR nach `main`, kein Squash | ✅ |
| Phasenfolge | ✅ Paket 053 ist seit 2026-10-09 in täglichem Gebrauch (C1). Spec 001 ist ausgeliefert (`PersonLink.vue`, `/personen/[id]`). |
| Jede mandantenbezogene Tabelle mit `organization_id`, RLS, Isolationstests, zusammengesetzte Fremdschlüssel (AGENTS.md) | ✅ [data-model.md](data-model.md), [quickstart.md](quickstart.md) §1 |
| Service Role nur in API und Worker | ✅ Schreiben nur der Worker, Lesen über den Nutzer-Client |
| Externe Aktionen idempotent und auditiert | ✅ Der Abgleich ist nur lesend gegenüber Veo und ersetzt je Spiel idempotent. Läufe stehen in `integration_sync_runs`, die Kennzahlenauswahl wird auditiert. |
| Medien privat, keine Payloads im Log | ✅ Keine Medien (das Heatmap-Bild von Veo wird nicht gespeichert, R-05). Im Log stehen nur Zähler und HTTP-Status. |
| Datenschutz Minderjährige | ✅ Sichtbarkeit nach Betreiberentscheidung. Die Verarbeitungsdokumentation wird ergänzt (R-16). |
| ADR bei Änderung eines Core Principle | n/a. Spiegeln in Supabase folgt dem bestehenden Grundsatz, ein neuer Grundsatz entsteht nicht. |
| Definition of Done: Migrationen, Observability, Doku, Wiederherstellung | ✅ Wiederherstellung über „Analyse neu laden“. Ergebnisdokument `plans/059-veo-analyse.md` nach der Umsetzung, wie bei 053. |

Was die graphify-Abfragen ergaben:
- Es gibt keine Spielfeld-, Heatmap- oder Diagrammkomponente.
- `pages/auswertung.vue` hat eine Linie mit Raster (`chartY`). Sie ist an die Seite gebunden und keine Komponente. Sie dient als Stilvorlage, eine Extraktion lohnt sich nicht.
- Als Kandidaten bewertet: `PlayerboardVeoSeason.vue` (wird erweitert), `PlayerboardSeasonSummary.vue` (Trainingspunkte, anderer Zweck) und `playerboardVeo.ts` (umziehen und erweitern).

**Ergebnis**: Keine Verstöße. Nach Phase 1 erneut geprüft: unverändert grün. Die erweiterte Funktion `playerboard_veo_team_matches` ersetzt die zuerst erwogene neue Saisonfunktion.

## Project Structure

### Documentation (this feature)

```text
specs/002-veo-analyse/
├── spec.md
├── plan.md
├── research.md            # Entscheidungen R-01 … R-16, Prüfliste Testabruf
├── data-model.md
├── contracts/veo-analysis.md
├── quickstart.md
├── scope.md               # Umfangsverzeichnis (FR-001, SC-002)
├── veo-ui-inventory.md    # Inventar der Veo-Web-App (Quelle)
├── checklists/requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
packages/veo-client/src/
├── analysis.ts                     # neue Abrufe + Zod-Schemas (contracts/veo-analysis.md, Veo-Client)
├── analysis.test.ts
├── __fixtures__/                   # anonymisierte Antworten aus dem Testabruf
├── client.ts                       # fetchPlayerStats -> match_all_players, CURATED_PLAYER_STATS erweitert
├── http.ts                         # VEO_HOSTS + RAS-Host (R-12)
└── index.ts

packages/domain/src/
├── veoPitch.ts / veoPitch.test.ts        # Spiegelung je Halbzeit, Drittel, Strafraum, Matrix-Decode, Heatmap-Raster aus Positionen
└── veoMetrics.ts / veoMetrics.test.ts    # Kennzahlenkatalog, Ableitungen, Passketten, Momentum-Anteile, Saison, Ranglisten, Radar, Kacheln je Position

packages/contracts/src/
├── playerboardVeoAnalysis.ts       # Schemas aus contracts/veo-analysis.md
└── playerboard.ts                  # PlayerboardVeoMatchSchema erweitert, Sync-Request refreshAnalysis

supabase/
├── migrations/2026102201_playerboard_veo_analysis.sql
└── tests/playerboard_veo_analysis.test.sql

apps/worker/src/
├── veoAnalysisSync.ts / veoAnalysisSync.test.ts   # Analysepaket je Spiel holen, normieren, prüfen
├── veoSync.ts                      # ruft den Analyseschritt nach apply_match (R-03, R-04)
└── context.ts                      # Repository: applyAnalysis, analysisCandidates

apps/api/src/
├── routes/playerboard/veoAnalysis.ts       # analysis, tracks, report, shots, views, Heatmaps je Spieler
├── routes/playerboard/veo.ts               # matches-Filter, sync refreshAnalysis
├── playerboardVeoAnalysis.routes.test.ts
└── routes/playerboard/personProfile.ts     # profile.veo je Mannschaft (Spec 001)

apps/web/app/
├── pages/playerboard/spiele/[fixtureId].vue          # Spielauswertung: Mannschaft | Spieler | Ereignisse
├── pages/playerboard/spiele/[fixtureId]/bericht.vue  # Spielbericht
├── pages/playerboard/saison.vue                      # Saison: Mannschaft | Spieler
├── pages/playerboard/veo.vue                         # + „Analyse neu laden“
├── pages/personen/[id].vue                           # + Veo-Abschnitt
├── components/PlayerboardPitch.vue                   # Spielfeld (voll, halb, quer), Zonen-Overlays, Slots
├── components/PlayerboardPitchHeatmap.vue            # Canvas-Heatmap nach Veo-Rezept
├── components/PlayerboardVeoStatComparison.vue
├── components/PlayerboardVeoShotMap.vue
├── components/PlayerboardVeoEventMap.vue             # Defensivaktionen, Pässe; Form je Typ
├── components/PlayerboardVeoThirds.vue
├── components/PlayerboardVeoPassStrings.vue
├── components/PlayerboardVeoMomentum.vue
├── components/PlayerboardVeoEvents.vue
├── components/PlayerboardVeoPlayerTable.vue          # erweitert: Spalten wählen, sortieren, Saison-Modus
├── components/PlayerboardVeoPlayerCard.vue
├── components/PlayerboardVeoKeyMetrics.vue
├── components/PlayerboardVeoRadar.vue
├── components/PlayerboardVeoLeaderboards.vue
├── components/PlayerboardVeoPlayerComparison.vue
├── components/PlayerboardVeoPassingNetwork.vue
├── components/PlayerboardVeoSpeedZones.vue
├── components/PlayerboardVeoFilters.vue
├── composables/usePlayerboardVeoAnalysis.ts
├── composables/usePlayerboardVeoSeason.ts
└── utils/playerboardVeo.ts                           # Bezeichnungen und Formatierung; Rechenregeln -> packages/domain

plans/059-veo-analyse.md            # Ergebnisdokument nach der Umsetzung (Repo-Konvention)
```

**Structure Decision**: Die bestehende Struktur des Monorepos bleibt. Die neuen Seiten liegen unter `pages/playerboard/`, weil sie zum Modul gehören und dessen Middleware brauchen. Rechenregeln liegen in `packages/domain`, weil Worker (Spiegelung) und Web (Anzeige) sie teilen und weil Domain-Pakete keine Frameworks kennen (AGENTS.md). Die Navigation bekommt „Saison“ neben „Spiele“. Die Spielauswertung öffnet sich aus der Spielkarte in `/playerboard/spiele`.

### Lieferung in sechs PRs

Die PRs folgen der Constitution: Warnschwelle etwa 100 Zeilen, ab etwa 1000 Zeilen teilen. Migrationen und Testdaten sind erlaubte Ausnahmen.

1. **Datengrundlage**:
   - Testabruf ausführen, `research.md` angleichen, anonymisierte Testdaten ablegen
   - `veo-client/analysis.ts`, RAS-Host
   - Migration und pgTAP
   - `veoPitch.ts`, Analyseschritt im Worker
   - „Analyse neu laden“
   - Ohne neue Ansicht. Wird PR 1 zu groß, wird er geteilt in 1a (Client und Testdaten) und 1b (Speichern und Abgleich).
2. **Spielauswertung der Mannschaft** (Story 1): Lesefunktion, Route `analysis`/`tracks`, Spielfeld, Spielwerte, Schusskarte, Heatmap, Drittel, Passketten, Spielverlauf, Ereignisse.
3. **Spieler im Spiel** (Story 2): Spielertabelle erweitert, Spielerkarte, Kacheln je Position, Link zum Profil.
4. **Saison der Mannschaft** (Story 3): Filter, erweiterte `matches`, `shots`, `views`, Kennzahlen, Form, Radar.
5. **Spieler über die Saison** (Story 4): Ranglisten, Tabelle, Schusskarte, Heatmap, Vergleich, Personenprofil.
6. **Spielbericht** (Story 5): `report`-Route und alle Abschnitte. Dazu die Verarbeitungsdokumentation (R-16) und `plans/059-veo-analyse.md`.

## Complexity Tracking

| Abweichung | Warum nötig | Einfachere Alternative abgelehnt, weil |
|---|---|---|
| Fünf neue Tabellen statt einer JSON-Spalte | Ereignisse und Heatmaps müssen über die Rückennummer-Zuordnung je Spieler lesbar sein, auch über Spiele hinweg (FR-023, FR-042). Kleine, nur je Spiel gelesene Strukturen liegen gebündelt als JSON in `playerboard_veo_match_analysis`. | Ein JSON je Spiel würde Saisonabfragen über alle Ereignisse in den Browser oder in JSON-Pfade in SQL verlagern |
| Positionsdaten speichern (`playerboard_veo_tracks`) | Heatmaps für frei wählbare Minutenabschnitte und die Mannschafts-Heatmap ohne Veos Bild (FR-012, FR-022, R-05) | Je Abschnitt bei Veo nachfragen braucht Live-Zugriff (FR-060). Positionsdaten werden einmal je Spiel geholt (etwa 138 Abrufe) und roh je Seite gespeichert |
| Eigene Spielfeld- und Heatmap-Komponenten | Etwa 12 Grafiken teilen Spielfeld, Zonen und Koordinaten | Je Grafik ein eigenes Spielfeld würde Maße, Zonen und Spiegelung zwölfmal pflegen |
| 14-Tage-Regel im Abgleich | Begrenzt die Last auf die inoffizielle API (R-03) | Jedes Mal alles holen wären über 500 Abrufe täglich; ein Änderungsmerkmal von Veo ist unbelegt |
