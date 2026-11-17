---
description: "Task list for hierarchical public PlayerBoard URLs"
---

# Tasks: Hierarchische öffentliche PlayerBoard-URLs

**Input**: Design documents from `/specs/005-playerboard-hierarchical-public-url/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/public-playerboard.md, quickstart.md

**Tests**: Required (FR-015). Database, API, web, middleware and contract tests cover the new path, with positive and negative isolation across club, department and team. Write each test task first and see it fail before its implementation task.

**Organization**: Tasks are grouped by user story. US1 to US3 are all P1, so they are ordered by dependency: US3 (server-side resolution and access gate) comes before US1 (page) and US2 (links).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: User story from spec.md (US1 to US4)
- Paths are relative to the repository root

## Phase 1: Setup

**Purpose**: Confirm the workspace and a green baseline before the first edit.

- [X] T001 Confirm the checkout is the registered worktree on branch `feat/playerboard-hierarchical-public-url` (`git worktree list`, `git branch --show-current`) and record a green baseline with `pnpm db:reset && pnpm db:test`, `pnpm --filter @vereinsfunk/contracts test`, `pnpm --filter @vereinsfunk/api test -- src/playerboard.routes.test.ts src/structure.routes.test.ts` and `pnpm --filter @vereinsfunk/web test -- app/utils/publicTeamPage.test.ts app/middleware/auth.global.test.ts app/pages/playerboardPages.test.ts app/pages/apiClientPages.test.ts`.
- [X] T002 Consult the knowledge graph for the new named artifacts before authoring them (`graphify query "public team address slug schema and path builder"`, `graphify explain playerboard_slug_part`, `graphify explain isPublicTeamPagePath`). If the graph is still missing in this worktree, name the failed invocation in the pull request description and continue with the reuse candidates listed in `specs/005-playerboard-hierarchical-public-url/plan.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared address schema and the generated, UUID-free team segment with its uniqueness rule. Every story builds on both.

**⚠️ CRITICAL**: No user story work starts before this phase is complete.

### Tests

- [X] T003 [P] Add contract tests in `packages/contracts/src/playerboard.test.ts`: organization and department segment accept up to 200 characters and reject 201; team segment accepts 80 and rejects 81; each rejects uppercase, empty string, `..`, leading, trailing and double hyphens; `PublicTeamAddressSchema` requires all three segments; `publicTeamPath()` returns `/mannschaft/<org>/<department>/<team>`.
- [X] T004 [P] Rewrite `supabase/tests/playerboard_public_slug.test.sql` (single transaction, `begin;` … `rollback;`): the team slug is the normalized team name only, without department part or UUID; a department rename leaves it unchanged; a team rename regenerates it; a colliding normalized name (`U-13`, `u 13`, `U_13`) is rejected on insert, rename and un-archive; the same name is accepted in another department and in another club; an archived team does not block a new team with its name; an empty or symbol-only name yields `mannschaft`; umlauts map as in `authz.playerboard_slug_part`; the slug is cut to 80 characters without a trailing hyphen; insert and rename succeed as role `authenticated`; non-team settings rows keep `public_slug is null`; regeneration leaves `public_sharing_allowed`, the data switches and `public_player_name_format` unchanged; a team without a settings row gets none.

### Implementation

- [X] T005 Add the exported slug pattern string, `OrganizationPublicSlugSchema`, `DepartmentPublicSlugSchema`, `TeamPublicSlugSchema`, `PublicTeamAddressSchema` and `publicTeamPath(address)` to `packages/contracts/src/playerboard.ts` (makes T003 pass).
- [X] T006 Create `supabase/migrations/2026111702_playerboard_hierarchical_public_url.sql` with data-model steps 2 to 5: `authz.team_url_slug(name)` (immutable), the partial unique index `teams_active_url_slug_unique` on `(organization_id, department_id, authz.team_url_slug(name)) where archived_at is null`, the replaced `authz.set_playerboard_public_slug()` and `authz.refresh_playerboard_public_slugs()` (teams branch only), `drop trigger departments_refresh_playerboard_public_slug`, `drop function authz.playerboard_team_public_slug`, and the dropped `unique (organization_id, public_slug)` constraint on `playerboard_settings` (makes T004 pass). Do not edit earlier migrations. If the insert as `authenticated` in T004 fails on the expression index, make `authz.team_url_slug` usable for that role as described in research.md R2.

**Checkpoint**: `pnpm db:reset && supabase test db --file supabase/tests/playerboard_public_slug.test.sql` and `pnpm --filter @vereinsfunk/contracts test` are green. The other PlayerBoard pgTAP files still call the two-argument functions and stay green until T013.

---

## Phase 3: User Story 3 - Öffentliche API-Endpunkte und Zugriffsschutz folgen dem neuen Pfad (Priority: P1)

**Goal**: The six anonymous endpoints resolve a team through club, department and team together, and the sign-in gate lets exactly the three-segment page address through.

**Independent Test**: Call every public endpoint anonymously with a valid and with an invalid segment set, and open other paths under `/mannschaft` without a session.

### Tests

- [X] T007 [P] [US3] Change every call of the public functions to the three-argument form (`org_slug, department_slug, team_slug`) in `supabase/tests/playerboard_core.test.sql` (22 calls), `supabase/tests/playerboard_ranking_places.test.sql` (2), `supabase/tests/playerboard_veo_views.test.sql` (10) and `supabase/tests/playerboard_veo_analysis.test.sql` (3). `supabase/tests/playerboard_api_support.test.sql` contains no such call and stays as it is.
- [X] T008 [P] [US3] Add `supabase/tests/playerboard_public_address.test.sql` (single transaction, `begin;` … `rollback;`) with the negative isolation cases: wrong department, wrong club, a same-named team in another department and in another club each return only their own rows, archived department, archived team, a training id of another team, `module_enabled` or `public_sharing_allowed` closed at club, department and team level, each data switch off; the old two-argument signatures of `authz.playerboard_public_team` and the six `public.playerboard_public_*` functions no longer exist; the new functions are executable by `service_role` only; `playerboard_public_team_info` returns `organization_id`, `department_id` and `team_id` of the resolved team.
- [X] T009 [P] [US3] Update the existing public-route cases in `apps/api/src/playerboard.routes.test.ts` to the three-segment URLs and the three-argument RPC parameters. The expected response bodies stay byte-for-byte as they are (SC-005).
- [X] T010 [P] [US3] Add `apps/api/src/playerboardPublicAddress.routes.test.ts`: an invalid, uppercase, over-long (201, 201, 81 characters) or `..` segment returns 404 before any RPC is called; unknown, closed and mismatching addresses return the identical `{ error: 'not_found', correlationId }` body and status; every old two-segment URL shape returns that same body, calls no RPC and sends no redirect; when two departments each have a team `u13`, brand colors and season start come from the team of the requested department; no response body contains `organization_id`, `department_id`, `team_id` or any other id; a training of another team returns 404; a team whose slug is `trainings`, `ranking`, `veo` or `photos` still reaches its own info and sub-endpoints.
- [X] T011 [P] [US3] Update `apps/web/app/utils/publicTeamPage.test.ts`: exactly `/mannschaft/<slug>/<slug>/<slug>` is public; two segments, four segments, an empty segment, a trailing slash, uppercase, `..`, `/mannschaftx/...`, a 201-character club or department segment, an 81-character team segment and a path longer than 512 characters are not; the legacy detector is true only for exactly two slug segments.
- [X] T012 [P] [US3] Update `apps/web/app/middleware/auth.global.test.ts`: a three-segment address passes without a session; a legacy two-segment address ends in a 404 for anonymous and for signed-in visitors, without a redirect to sign-in or to the new path; every other malformed path under `/mannschaft` redirects an anonymous visitor to `/anmelden`.

### Implementation

- [X] T013 [US3] Append data-model step 7 to `supabase/migrations/2026111702_playerboard_hierarchical_public_url.sql`: `authz.playerboard_public_team(org_slug, department_slug, team_slug)` joining `organizations.slug`, `departments.slug` (same organization, `archived_at is null`), the team of that department (`archived_at is null`) and `playerboard_settings.public_slug`, keeping the `module_enabled` and `public_sharing_allowed` checks; the six `public.playerboard_public_*` functions with `department_slug` after `org_slug`; `playerboard_public_team_info` additionally returning the three internal ids; an explicit `drop function` for every old signature; `security definer`, `set search_path = public, pg_temp`, `revoke … from public`, `grant execute … to service_role` on each (makes T007 and T008 pass; depends on T006).
- [X] T014 [US3] Change `apps/api/src/routes/playerboard/public.ts`: the six routes use `/v1/public/playerboard/:orgSlug/:departmentSlug/:teamSlug[...]`; `loadTeam` validates the params with `PublicTeamAddressSchema`, calls the info RPC once and returns the internal ids; `loadTeamPresentation` takes those ids and drops its own organization, settings and slug lookups; the local `SlugSchema` and `ParamsSchema` are removed; old two-segment URL shapes answer with the generic 404 body (makes T009 and T010 pass; depends on T005 and T013). The retired handling must not shadow a three-segment address whose team slug equals `trainings`, `ranking`, `veo` or `photos`.
- [X] T015 [US3] Change `apps/web/app/utils/publicTeamPage.ts`: `isPublicTeamPagePath` accepts exactly three slug segments with the segment limits 200, 200 and 80 and a total length of at most 512, built from the pattern string exported by `@vereinsfunk/contracts`; add the legacy two-segment detector; update the header comment to the three-segment address (makes T011 pass; depends on T005).
- [X] T016 [US3] Change `apps/web/app/middleware/auth.global.ts`: a legacy two-segment address ends in a terminal 404 before the sign-in redirect; all other behavior stays (makes T012 pass; depends on T015).

**Checkpoint**: `pnpm db:reset && pnpm db:test` and the API and web suites named in T009 to T012 are green. All six endpoints serve the three-segment address and nothing else.

---

## Phase 4: User Story 1 - Öffentliche Mannschaftsseite unter dreiteiliger Adresse erreichen (Priority: P1) 🎯 MVP

**Goal**: Guests open `/mannschaft/<verein>/<abteilung>/<mannschaft>` without signing in and see the same tabs and content as before.

**Independent Test**: Create a team with public sharing enabled and open its three-segment address in a private window. Acceptance scenarios 3 and 4 (mismatching segments, same-named teams) are pinned by T008 and T010, scenario 5 (name collision) by T004.

### Tests

- [X] T017 [P] [US1] Update `apps/web/app/pages/playerboardPages.test.ts` and `apps/web/app/pages/apiClientPages.test.ts` to read `mannschaft/[orgSlug]/[departmentSlug]/[teamSlug].vue`, and assert: the old file `mannschaft/[orgSlug]/[teamSlug].vue` no longer exists; the API base is `/v1/public/playerboard/${orgSlug}/${departmentSlug}/${teamSlug}`; every `useAsyncData` key contains `orgSlug`, `departmentSlug` and `teamSlug`; the route params are validated before the first request.

### Implementation

- [X] T018 [US1] Extend `PublicTeamRouteParamsSchema` in `apps/web/app/utils/publicTeamPage.ts` to `orgSlug`, `departmentSlug` and `teamSlug` using the shared segment schemas, and remove the local `PublicTeamSlugSchema` once nothing imports it (depends on T015).
- [X] T019 [US1] Move the page with `git mv` to `apps/web/app/pages/mannschaft/[orgSlug]/[departmentSlug]/[teamSlug].vue`, read the three route params, build the three-segment API base, and include all three segments in every `useAsyncData` key (team, trainings, training, ranking, Veo, photos) so that two teams with the same slug in different departments never share a payload cache entry (makes T017 pass; depends on T014 and T018).

**Checkpoint**: The three-segment address renders anonymously. A two-segment address shows no page and no data.

---

## Phase 5: User Story 2 - Adresse und Share-Links in der Verwaltung verwenden (Priority: P1)

**Goal**: Every address the application shows or copies uses the three-segment path.

**Independent Test**: Copy the team address from `/playerboard/einstellungen` and a training link from `/playerboard/trainings`, and open both in a private window.

### Tests

- [X] T020 [P] [US2] Add settings cases to `apps/api/src/playerboard.routes.test.ts`: `publicPath` is `/mannschaft/<org>/<department>/<team>` for a team scope with a slug; `own.publicSlug` is the team segment only; `publicPath` is `null` without a slug, for non-team scopes, and when the club or department slug fails its schema; `PATCH` still cannot set `publicSlug`.
- [X] T021 [P] [US2] Extend `apps/web/app/pages/playerboardPages.test.ts`: the settings page copies `window.location.origin + publicPath` unchanged and offers neither address nor copy button when `publicPath` is `null`; the training link is `publicPath` plus `?training=<id>`; neither page assembles slug segments itself.

### Implementation

- [X] T022 [US2] Select `slug` for departments in `loadOrganizationLevels` in `apps/api/src/routes/modules.ts` and carry it through its row schema and return value.
- [X] T023 [US2] Build `publicPath` in `buildEntry` in `apps/api/src/routes/playerboard/settings.ts` with `publicTeamPath()` from the organization slug, the slug of the team's department and `own.public_slug`, and return `null` unless `PublicTeamAddressSchema` accepts the three segments (makes T020 pass; depends on T005 and T022).

`apps/web/app/pages/playerboard/einstellungen.vue` and `apps/web/app/pages/playerboard/trainings/index.vue` already read `publicPath` and need a change only if T021 fails.

**Checkpoint**: All displayed and copied links are three-segment and open anonymously (SC-002, SC-006).

---

## Phase 6: User Story 4 - Bestehende Mannschaften auf den neuen Pfad umstellen (Priority: P2)

**Goal**: Existing teams get their address during the migration, and a name collision is reported clearly at create, rename, un-archive and sync instead of failing the request or the sync run.

**Independent Test**: Run the migration on a database with existing teams, then create and rename a team and check the address each time.

### Tests

- [X] T024 [P] [US4] Add `apps/api/src/structureTeamName.routes.test.ts`: `POST /v1/departments/:id/teams`, `PATCH /v1/teams/:id` with a new name and `PATCH /v1/teams/:id` with `archived: false` answer `409 { error: 'team_name_taken', correlationId }` when PostgreSQL reports `23505` on `teams_active_url_slug_unique`; any other `23505` is still thrown; no audit event is written for the rejected change.
- [X] T025 [P] [US4] Add `apps/api/src/services/sync/teams.test.ts`: a batch insert that hits `teams_active_url_slug_unique` falls back to per-row writes; each offending row becomes one `invalid_record` pending conflict on field `name`; the remaining rows are written and the run finishes instead of aborting; an update that hits the index is handled the same way; a run without collision still uses a single batch insert.
- [X] T026 [P] [US4] Add a case to `apps/web/app/pages/apiErrorMessages.test.ts`: `apps/web/app/pages/struktur.vue` maps `team_name_taken` to a German explanation for creating, renaming and un-archiving a team.

### Implementation

- [X] T027 [US4] Complete `supabase/migrations/2026111702_playerboard_hierarchical_public_url.sql` with data-model step 1 as the first statement and step 6 after the constraint drop: the preflight raises one exception that lists active teams whose `team_url_slug(name)` collides within a department and the club or department slugs (for departments with team settings rows) that fail `^[a-z0-9]+(-[a-z0-9]+)*$` or exceed 200 characters, and changes nothing in that case; the rewrite is `update public.playerboard_settings set public_slug = public_slug where scope = 'team'`. No settings row is created and no switch or name format is touched (depends on T013).
- [X] T028 [P] [US4] Map `23505` on `teams_active_url_slug_unique` to `409 team_name_taken` in the team insert and the team update of `apps/api/src/routes/structure.ts` (makes T024 pass).
- [X] T029 [P] [US4] Add the per-row fallback to `apps/api/src/services/sync/teams.ts` and record each collision through the existing `addUniquePendingConflict` with kind `invalid_record`, field `name` and incoming value "Name kollidiert mit einer bestehenden Mannschaft" (makes T025 pass).
- [X] T030 [P] [US4] Show the German message for `team_name_taken` in the create, rename and un-archive handlers of `apps/web/app/pages/struktur.vue` (makes T026 pass). Check whether `apps/web/app/pages/onboarding/index.vue` creates teams through the same endpoint and apply the same message there if it does.
- [X] T031 [US4] Rehearse the migration on pre-migration data: reset the local database to `2026111701`, insert team settings rows in the old slug format plus one colliding pair of active team names, apply the new migration and confirm that it aborts with the list and changes nothing; resolve the collision, apply again and confirm that every team settings row has exactly one UUID-free slug and that `public_sharing_allowed`, the data switches and `public_player_name_format` are identical to before (SC-001, FR-009).

**Checkpoint**: Existing data migrates or aborts with a readable list; collisions never produce a 500 or an aborted sync run.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T032 [P] Write `docs/adr/ADR-014-hierarchical-public-playerboard-url.md`: the three-segment address and its sources, supersession of the URL decision in ADR-013, name formats and privacy boundaries unchanged, old links not redirected, the name-uniqueness rule for all active teams of a department, the differing normalization of department and team slugs (research.md R1), the preflight requirement and the rollback path (research.md R4 and R9).
- [X] T033 [P] Add the supersession note for the URL decision to the status line of `docs/adr/ADR-013-public-playerboard-display.md`.
- [X] T034 Search for leftover two-segment references outside `specs/001-*` to `specs/004-*`, `plans/` and earlier migrations (`rg "\[orgSlug\]/\[teamSlug\]|mannschaft/\{verein\}/\{mannschaft\}|PublicTeamSlugSchema"` plus RPC calls without `department_slug`) and fix code comments that still describe the old address in `apps/api/src/routes/playerboard/public.ts`, `apps/web/app/middleware/auth.global.ts` and `apps/web/app/utils/publicTeamPage.ts`.
- [X] T035 Run `pnpm db:reset && pnpm db:test` and `pnpm check` (lint, typecheck, tests, build) and report what ran and what was skipped.
- [ ] T036 Walk through the manual scenario in `specs/005-playerboard-hierarchical-public-url/quickstart.md` step 4 in the running app (two departments with a team `U13` each, copy and open both addresses, legacy and malformed paths, rename, collision, training link).
- [ ] T037 Operator gate before merge: run the two preflight queries from T027 against a copy of the production data and record the result in the pull request. Rename or archive every listed team before the migration is deployed (research.md R4, open check).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US3 (Phase 3)**: after Foundational.
- **US1 (Phase 4)**: after US3. The page needs the three-segment API (T014) and the middleware pattern (T015, T016).
- **US2 (Phase 5)**: after Foundational. Its automated tests are independent of US3 and US1; the end-to-end check (opening a copied link) needs both.
- **US4 (Phase 6)**: T027 after T013 (same migration file); T028 to T030 after Foundational.
- **Polish (Phase 7)**: after all stories.

### Shared files (never edit in parallel)

- `supabase/migrations/2026111702_playerboard_hierarchical_public_url.sql`: T006 → T013 → T027
- `apps/web/app/utils/publicTeamPage.ts`: T015 → T018
- `apps/api/src/playerboard.routes.test.ts`: T009 → T020
- `apps/web/app/pages/playerboardPages.test.ts`: T017 → T021
- `packages/contracts/src/playerboard.ts`: T005 only

### Within Each User Story

- Test tasks first; each must fail for the right reason before its implementation task starts.
- Database before API, API before web.

### Parallel Opportunities

- T003 and T004.
- T007 to T012 (six different files).
- After T013: T014 and T015 (API and web util).
- US2 (T020 to T023) alongside US3 once Foundational is done, apart from the shared test file noted above.
- T024 to T026, then T028 to T030.
- T032 and T033.

## Parallel Example: User Story 3

```bash
# Tests for US3, all in different files:
Task: "Three-argument calls in supabase/tests/playerboard_core.test.sql and the three other pgTAP files"
Task: "Negative isolation in supabase/tests/playerboard_public_address.test.sql"
Task: "Three-segment URLs in apps/api/src/playerboard.routes.test.ts"
Task: "Address validation and retired routes in apps/api/src/playerboardPublicAddress.routes.test.ts"
Task: "Path pattern in apps/web/app/utils/publicTeamPage.test.ts"
Task: "Gate behavior in apps/web/app/middleware/auth.global.test.ts"
```

## Implementation Strategy

### MVP

1. Phase 1 and Phase 2.
2. Phase 3 (US3): the server resolves three segments.
3. Phase 4 (US1): the page is reachable. **Stop and validate** with an anonymous browser.

### Incremental Delivery

4. Phase 5 (US2): links in the application follow.
5. Phase 6 (US4): existing data and collision handling.
6. Phase 7: ADR, sweep, full verification, operator gate.

The feature ships as one pull request. An intermediate state is not deployable, because the migration drops the two-argument functions that the old API routes call.

## Notes

- New test cases go into new files where the existing file is already far above 500 lines (`apps/api/src/playerboard.routes.test.ts` 596, `apps/api/src/structure.routes.test.ts` 907, `apps/api/src/integrations.routes.test.ts` 765, `supabase/tests/playerboard_core.test.sql` 500). Existing cases are only adapted in place. `packages/contracts/src/playerboard.ts` has 529 lines and grows by the address schemas; splitting it is out of scope for this feature.
- For exactly two slug segments under `/mannschaft`, the tasks follow plan.md and the contract (public 404, no redirect; US1 scenario 2, FR-008). US3 scenario 2 lists "fewer than three segments" among the paths that go to sign-in; that applies to every other malformed path.
- Commits follow Conventional Commits. The change that switches the public address uses `feat(playerboard)!:` with a `BREAKING CHANGE:` footer naming the old and the new path.
- Earlier migrations, `plans/052-*.md` and `plans/053-*.md` stay untouched.
