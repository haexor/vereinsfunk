# Implementation Plan: Spielerprofil auf Vereinsebene

**Branch**: `feat/spielerprofil` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-spielerprofil/spec.md`

## Summary

Jede Verzeichnisperson bekommt unter `/personen/[id]` eine Profilseite, und jeder Spielername in den PlayerBoard-Ansichten wird zum Link darauf. Die Seite liest über einen neuen Endpoint `GET /v1/people/:id/profile`. Dahinter steht eine neue `security definer`-Funktion `public.person_profile`, die Sichtbarkeit und Punkte aus den vorhandenen Bausteinen ableitet (`authz.can_view_playerboard_stats`, `authz.playerboard_ranking_rows`). Das Profil zeigt damit nie mehr als Kader, Rangliste und Saisonübersicht zusammen; eine nicht sichtbare Person ist nicht von einer nicht vorhandenen zu unterscheiden. Die Namenslinks brauchen keine Vertragsänderung: Die Ansichten kennen die `directoryPersonId` bereits oder holen sie aus dem schon geladenen Kader.

## Technical Context

**Language/Version**: TypeScript (strict), Node 22, SQL (PostgreSQL via Supabase)

**Primary Dependencies**: Nuxt 4 / Vue 3 (`apps/web`), Fastify (`apps/api`), Zod (`packages/contracts`), Supabase JS; keine neue Abhängigkeit

**Storage**: Supabase Postgres; keine neue Tabelle, eine neue RPC-Funktion (Migration `2026101701_person_profile.sql`)

**Testing**: Vitest (`apps/api`, `apps/web`, Pakete), pgTAP (`supabase/tests`, `pnpm db:test`), Playwright-Skill `run-web` für die Sichtprüfung

**Target Platform**: Browser (mobil ab 360 px, Desktop), Fastify-Server

**Project Type**: Web-Anwendung (Monorepo: `apps/web`, `apps/api`, `packages/*`, `supabase/`)

**Performance Goals**: Profil in unter 2 s (SC-005); ein RPC-Aufruf je Seitenaufruf

**Constraints**: Mandantentrennung per RLS bzw. in der Funktion; Service Role nur in der API; Zod an jeder Systemgrenze; keine E-Mail für Nicht-Trainer; kein Geburtsjahr

**Scale/Scope**: Vereine mit einigen hundert Personen; eine Person hat selten mehr als 3 Kadereinträge

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Geprüft gegen `.spaex/constitution.md` und `AGENTS.md`:

| Regel | Stand |
|---|---|
| Änderung im Worktree auf Topic-Branch | ✅ `.worktrees/spielerprofil`, `feat/spielerprofil` |
| graphify vor neuen benannten Artefakten | ✅ Abfrage nach Link-Komponenten und Profil-Routen lieferte keine Kandidaten (`graphify query`, Budget 1200); ergänzend `grep` über `apps/web/app`: keine bestehende Personen-Link-Komponente, keine Profil-Route. Kandidaten, die bewertet wurden: `usePlayerboardRanking` (wird erweitert, nicht ersetzt), `playerboard_team_roster` und `playerboard_ranking_rows` (werden wiederverwendet), `/profil` (eigenes Konto, anderer Zweck) |
| Tests getrennt vom Produktionscode | ✅ pgTAP, `*.routes.test.ts`, `*.test.ts` |
| Dateien nicht deutlich über 500 Zeilen | ✅ neue Dateien klein; `PlayerboardPointEntry.vue` u. a. werden nur um wenige Zeilen geändert |
| Keine Spekulation, keine neue Abhängigkeit | ✅ siehe Complexity Tracking; eine kleine Link-Komponente mit 8 Aufrufstellen |
| Keine Agent-Verweise in Artefakten und Commit-Trailern (MUST NOT) | ✅ eingehalten, Commits ohne zusätzliche Trailer-Zeilen |
| Conventional Commits, PR nach `main`, kein Squash | ✅ |
| Neue exponierte Funktion braucht positive und negative Isolationstests (AGENTS.md) | ✅ pgTAP: eigener Verein, fremder Verein, Nachbarmannschaft ohne Sicht |
| Externe Aktionen idempotent und auditiert | n/a, nur lesend |
| Medien privat, keine Secrets im Log | ✅ keine Medien, keine Payload-Logs |
| ADR nur bei Änderung eines Core Principle | n/a, keine Prinzipänderung |

**Ergebnis**: Keine Verstöße. Nach Phase 1 erneut geprüft: unverändert grün.

## Project Structure

### Documentation (this feature)

```text
specs/001-spielerprofil/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── person-profile.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, nicht Teil dieses Befehls
```

### Source Code (repository root)

```text
supabase/
├── migrations/2026101701_person_profile.sql          # public.person_profile(uuid, text) -> jsonb
└── tests/person_profile.test.sql                     # pgTAP: positiv + Isolation

packages/contracts/src/
├── personProfile.ts                                  # PersonProfileSchema, Query
└── index.ts                                          # Export

apps/api/src/
├── routes/playerboard/personProfile.ts               # GET /v1/people/:id/profile (Registrierung in routes/playerboard/index.ts)
└── personProfile.routes.test.ts

apps/web/app/
├── pages/personen/[id].vue                           # Profilseite
├── components/PersonLink.vue                         # Name als Link, Fallback ohne personId
├── components/PlayerboardPointEntry.vue              # Name -> PersonLink
├── components/PlayerboardRankingList.vue             # Name -> PersonLink (Zeile bleibt aufklappbar)
├── components/PlayerboardTrainingPhotos.vue          # Name -> PersonLink
├── components/PlayerboardVeoPlayerTable.vue          # Label -> PersonLink
├── components/PlayerboardVeoMatchCard.vue            # personId je Zeile aus dem Kader
├── composables/usePlayerboardRanking.ts              # personId je Eintrag aus dem Kader
├── pages/playerboard/kader.vue                       # Name -> PersonLink
└── utils/playerboardRanking.ts                       # RankingListItem.personId

plans/058-spielerprofil.md                            # Ergebnisdokument nach Repo-Konvention (nach der Umsetzung)
```

**Structure Decision**: Bestehende Struktur des Monorepos. Die Profilseite liegt unter `pages/personen/`, nicht unter `pages/playerboard/`, weil sie dem Verein gehört und nicht dem Modul; die Modul-Middleware greift deshalb nicht. Sie blendet nur den Abschnitt „Mannschaften und Punkte“ aus, wenn PlayerBoard nirgends wirksam ist (das ergibt sich aus der Funktion, siehe research.md).

**Lieferung in zwei PRs** (Review-Größe, Constitution: ~100 Zeilen Warnschwelle):

1. **Profil**: Migration, pgTAP, Contract, Route, Route-Test, Seite, `PersonLink`, Link im Trainingsdetail (User Story 1, 3, 4).
2. **Links überall**: Rangliste, Saisonübersicht, Kader, Fotos, Veo (User Story 2).

## Complexity Tracking

| Abweichung | Warum nötig | Einfachere Alternative abgelehnt, weil |
|---|---|---|
| Neue Komponente `PersonLink.vue` | 8 Aufrufstellen brauchen dasselbe Verhalten: Link mit Fokusring, Mindestgröße, Fallback ohne Person (FR-006, FR-012) | Je Stelle ein eigenes `NuxtLink` würde Fokus, Touchziel und Fallback achtmal einzeln pflegen |
| Neue RPC statt vorhandene Endpunkte zu bündeln | `directory_people` ist per RLS nur mit `directory.read` lesbar; ein Mitspieler müsste sonst Name und Kader über mehrere Calls zusammensetzen und bekäme für die „nicht sichtbar“-Entscheidung unterschiedliche Antworten | Mehrere Calls im Browser können FR-007 (identische Antwort) nicht garantieren |
