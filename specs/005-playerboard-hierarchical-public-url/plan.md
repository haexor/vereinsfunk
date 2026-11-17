# Implementation Plan: Hierarchische öffentliche PlayerBoard-URLs

**Branch**: `feat/playerboard-hierarchical-public-url` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-playerboard-hierarchical-public-url/spec.md`

## Summary

Replace the public team address `/mannschaft/<verein>/<verein-abteilung-mannschaft-uuid>` with `/mannschaft/<verein>/<abteilung>/<mannschaft>`. The club segment is `organizations.slug`, the department segment is the existing, rename-stable `departments.slug`, and the team segment is the generated, UUID-free `playerboard_settings.public_slug`, which now holds only the normalized team name. Uniqueness of the last segment moves from a global per-club suffix to a database rule on the team name itself (active teams, per department, after URL normalization), so ambiguous paths cannot be created. Resolution checks all three segments together in one security-definer function; the six public RPCs, the six public API routes, the page route, the auth-middleware pattern, share links, tests and docs follow. Name formats, switches and the anonymous payload shape do not change.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Vue/Nuxt 4, SQL migrations (PostgreSQL via Supabase)

**Primary Dependencies**: Fastify, Zod, Supabase JS, Nuxt; no new dependency

**Storage**: Supabase PostgreSQL; one new migration, no new table

**Testing**: pgTAP (`supabase/tests`), Vitest in `apps/api`, `apps/web`, `packages/contracts`

**Target Platform**: Web browser (anonymous), Fastify API, PostgreSQL

**Project Type**: Multi-package web application (`apps/web`, `apps/api`, `apps/worker`, `packages/*`)

**Performance Goals**: Public resolution stays one indexed lookup per request; no extra round trips (the info RPC also returns the internal IDs the presentation loader needs, which removes three of today's lookups).

**Constraints**: Anonymous public payloads unchanged (no IDs, birth years, positions, emails); all failure modes return the same 404; old two-segment path serves nothing and does not redirect; migrations never rewrite shared data silently.

**Scale/Scope**: 1 migration, 7 SQL functions, 6 API routes, 1 page + middleware util, settings path builder, team create/rename error mapping, team sync conflict handling, ~12 test files, 1 ADR.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

The Spec Kit constitution at `.specify/memory/constitution.md` is still the unfilled template, so it imposes no gates. Gates come from the spaex constitution (`.spaex/constitution.md`) and `AGENTS.md`.

| Gate | Result |
|---|---|
| Work in a repo-local worktree on a topic branch (spaex general-coding) | PASS: `.worktrees/playerboard-hierarchical-public-url`, `feat/playerboard-hierarchical-public-url` |
| Principle-affecting decisions get an ADR (spaex) | PASS: ADR-014 planned; it supersedes the URL decision of ADR-013 and records the privacy boundary as unchanged |
| Tests in separate files, positive and negative (spaex, AGENTS) | PASS: pgTAP, API, web and contract tests listed in [research.md](research.md) R10 |
| Tenant isolation, RLS, composite FKs (AGENTS) | PASS: no new exposed table; the new index is on `teams` and scoped by `organization_id, department_id`; resolution still joins through `organization_id` |
| Zod at system boundaries (AGENTS, spaex JS/TS) | PASS: three-segment params validated before any RPC; shared schema lives in `packages/contracts` |
| Service role only in API/workers (AGENTS) | PASS: public RPCs stay `service_role`-only |
| Immutable approved post versions, idempotent external actions | N/A |
| Conventional Commits, breaking marked (spaex) | Planned: `feat(playerboard)!:` with `BREAKING CHANGE:` footer for the URL change |
| No speculative abstraction, no new dependency (spaex ponytail) | PASS: existing generator, triggers and RPCs are extended; one shared schema replaces two duplicated regexes |
| Graphify-first consultation (spaex) | DEVIATION, flagged: the linked worktree has no `graphify-out/graph.json` (`graphify query` failed with "graph file not found"). Exploration used scoped `rg` instead. Re-check the candidate list below against a graph if one becomes available. |
| Definition of done: tests, typecheck, lint, build, migration/RLS/observability/docs/recovery considered (AGENTS) | Covered by [quickstart.md](quickstart.md); recovery in [research.md](research.md) R9 |

Candidates evaluated for reuse (no parallel implementation authored): `authz.playerboard_slug_part`, `authz.set_playerboard_public_slug`, `authz.refresh_playerboard_public_slugs`, `authz.playerboard_public_team`, `registerPlayerboardPublicRoutes`, `buildEntry` in `settings.ts`, `PublicTeamSlugSchema` / `isPublicTeamPagePath` in `apps/web/app/utils/publicTeamPage.ts`, `addUniquePendingConflict` in the sync service.

## Phase 0: Research

See [research.md](research.md). Key decisions:

1. Segments: `organizations.slug` / `departments.slug` / `playerboard_settings.public_slug` (team name only).
2. Uniqueness lives on `teams`: partial unique index on the normalized name per department, active teams only.
3. One three-argument resolver; old two-argument functions are dropped, not overloaded.
4. The migration aborts with a precise list on pre-existing collisions or unusable slugs instead of renaming data.
5. Team create, rename, un-archive and sync map a collision to a clear 409 or sync conflict.

## Phase 1: Design

- Data model and invariants: [data-model.md](data-model.md)
- HTTP and page contract: [contracts/public-playerboard.md](contracts/public-playerboard.md)
- Verification path: [quickstart.md](quickstart.md)

Post-design re-check of the constitution gates: unchanged, all PASS except the documented graphify deviation.

## Project Structure

### Documentation (this feature)

```text
specs/005-playerboard-hierarchical-public-url/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── public-playerboard.md
├── checklists/requirements.md
└── tasks.md              # produced by the tasks step, not by this plan
```

### Source Code (repository root)

```text
supabase/
├── migrations/2026111702_playerboard_hierarchical_public_url.sql   # new; never edit earlier migrations
└── tests/                                                           # pgTAP: public_slug (rewrite), core, api_support,
                                                                     # ranking_places, veo_views, veo_analysis (3-arg calls)
packages/contracts/src/playerboard.ts        # segment-specific slug schemas, PublicTeamAddressSchema, publicTeamPath()
apps/api/src/
├── routes/playerboard/public.ts             # 3-segment params, info RPC returns internal IDs
├── routes/playerboard/settings.ts           # publicPath from org + department + team slug
├── routes/modules.ts                        # department select gains `slug` (loadOrganizationLevels)
├── routes/structure.ts                      # 23505 on team name index -> 409 team_name_taken
├── services/sync/teams.ts                   # collision -> pending conflict instead of aborted run
└── *.test.ts                                # playerboard.routes, structure, sync
apps/web/app/
├── pages/mannschaft/[orgSlug]/[departmentSlug]/[teamSlug].vue   # moved from [orgSlug]/[teamSlug].vue
├── utils/publicTeamPage.ts                  # 3-segment pattern, legacy-path detector and route params schema
├── middleware/auth.global.ts                # legacy path gets terminal 404 before auth redirect
└── pages/*.test.ts, utils/publicTeamPage.test.ts
docs/adr/ADR-014-hierarchical-public-playerboard-url.md          # new; ADR-013 status line notes the supersession
```

**Structure Decision**: Extend the existing public-playerboard code paths in place. No new package, table or service; the only relocation is the Nuxt page file into one more directory level.

## Complexity Tracking

No constitution violations to justify. The one deliberate cost is that the team-name uniqueness rule applies to every active team in the club, not only to teams with PlayerBoard settings; the spec requires this (FR-016), and [research.md](research.md) R2 and R4 describe the consequences for sync and migration.
