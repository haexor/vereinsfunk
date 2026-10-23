---
description: "Task list for public trainings and anonymized Veo statistics"
---

# Tasks: Öffentliche Trainings und anonymisierte Veo-Statistiken

**Input**: Design documents from `/specs/003-public-playerboard-trainings/`

**Tests**: Required for public contracts, settings gates, tenant isolation and privacy boundaries.

## Phase 1: Setup

- [X] T001 Review the existing PlayerBoard public route, settings contract and public Veo label boundary in `apps/api/src/routes/playerboard/public.ts`, `apps/api/src/routes/playerboard/settings.ts` and `packages/contracts/src/playerboard.ts`.
- [X] T002 [P] Add the feature’s public contract and validation scenarios to `specs/003-public-playerboard-trainings/contracts/public-playerboard.md` and `specs/003-public-playerboard-trainings/quickstart.md`.

## Phase 2: Foundational

- [X] T003 [P] Add `public_trainings_enabled` to team PlayerBoard settings, preserve non-team constraints and add the public-function grants in `supabase/migrations/2026102301_public_playerboard_trainings.sql`.
- [X] T004 [P] Extend the Zod settings and public response contracts with `publicTrainingsEnabled`, the trainings tab, and public training summary/detail schemas in `packages/contracts/src/playerboard.ts`.
- [X] T005 Add pgTAP fixtures and negative isolation assertions for the public training switch, saved-status gate, wrong-team training and anonymized labels in `supabase/tests/playerboard_core.test.sql`.

## Phase 3: User Story 1 - Konfigurierbare öffentliche Inhalte (Priority: P1) 🎯 MVP

**Goal**: Each team can independently turn public trainings and public Veo statistics on or off, with existing public-sharing and module gates still enforced.

**Independent Test**: Change the two team settings and call the public team, training and Veo endpoints without authentication; enabled content is present and disabled content returns no data.

### Tests

- [X] T006 [P] [US1] Add API route tests for enabled/disabled training and Veo tabs and closed direct endpoints in `apps/api/src/playerboard.routes.test.ts`.
- [X] T007 [P] [US1] Add settings-page source assertions for independent public training and Veo switches in `apps/web/app/pages/playerboardPages.test.ts`.

### Implementation

- [X] T008 [US1] Map `public_trainings_enabled` through settings load/save and expose the team-only checkbox in `apps/api/src/routes/playerboard/settings.ts` and `apps/web/app/pages/playerboard/einstellungen.vue`.
- [X] T009 [US1] Extend the public team resolver, team-info response and Veo/public route gates with `trainings_enabled` in `supabase/migrations/2026102301_public_playerboard_trainings.sql` and `apps/api/src/routes/playerboard/public.ts`.
- [X] T010 [US1] Render a configurable Trainings tab on `apps/web/app/pages/mannschaft/[orgSlug]/[teamSlug].vue` while preserving the independent Veo tab behavior.

## Phase 4: User Story 2 - Anonymisiertes Training teilen (Priority: P1)

**Goal**: Trainers can copy a public link for each saved training, and guests can view only anonymized training data.

**Independent Test**: Enable public trainings, save a training with points, copy its link from the internal overview, open it anonymously, and verify the response contains only date/category/value and anonymous labels.

### Tests

- [X] T011 [P] [US2] Add API tests for public training list/detail success, saved-status filtering, wrong-team IDs, closed settings and absence of person fields in `apps/api/src/playerboard.routes.test.ts`.
- [X] T012 [P] [US2] Add frontend source tests for the per-training copy button, saved-only behavior, `?training=` link and clipboard error handling in `apps/web/app/pages/playerboardPages.test.ts`.
- [X] T013 [P] [US2] Add database isolation tests for public training list/detail output and no names/IDs in `supabase/tests/playerboard_core.test.sql`.

### Implementation

- [X] T014 [US2] Add security-definer SQL functions for public saved-training summaries and anonymized detail rows in `supabase/migrations/2026102301_public_playerboard_trainings.sql`.
- [X] T015 [US2] Implement unauthenticated public training list/detail routes with strict Zod parsing and 404 behavior in `apps/api/src/routes/playerboard/public.ts`.
- [X] T016 [US2] Load the selected team’s public settings and add a saved-training “Link kopieren” action with success/error feedback in `apps/web/app/pages/playerboard/trainings/index.vue`.
- [X] T017 [US2] Load and render public training summaries/details from the `training` query parameter without exposing internal data in `apps/web/app/pages/mannschaft/[orgSlug]/[teamSlug].vue`.

## Phase 5: User Story 3 - Anonymisierte Veo-Statistiken (Priority: P1)

**Goal**: Public Veo match data remains configurable and never exposes player names or identifiers.

**Independent Test**: Enable public Veo, inspect an anonymous response with matched and unmatched players, then disable it and repeat the request.

### Tests

- [X] T018 [P] [US3] Strengthen public Veo API tests to assert labels contain only jersey/initials and the payload has no player, directory or matching identifiers in `apps/api/src/playerboard.routes.test.ts`.
- [X] T019 [P] [US3] Add a public contract/source regression test for the Veo public schema and view in `apps/web/app/pages/playerboardPages.test.ts` and `packages/contracts/src/playerboard.ts`.

### Implementation

- [X] T020 [US3] Audit and regression-test the existing public Veo SQL projection so matched players use only `playerboard_public_label` and unmatched players use only jersey numbers, with the privacy assertions in `apps/api/src/playerboard.routes.test.ts` and `supabase/tests/playerboard_veo_views.test.sql`.
- [X] T021 [US3] Keep the public Veo UI limited to the anonymized public contract and document the no-PII boundary in `apps/web/app/pages/mannschaft/[orgSlug]/[teamSlug].vue`.

## Phase 6: Polish and Validation

- [X] T022 [P] Update PlayerBoard fixture expectations for the new settings field in `apps/web/app/utils/playerboardSettings.test.ts` and `apps/api/src/playerboard.routes.test.ts`.
- [ ] T023 Run focused API, web, pgTAP, lint and typecheck validation from `specs/003-public-playerboard-trainings/quickstart.md` and resolve failures without weakening privacy assertions.
- [ ] T024 Run the repository definition of done (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) from the feature worktree and record results.

## Dependencies and execution order

- Phase 1 precedes Phase 2; Phase 2 blocks all stories.
- US1 establishes the setting and public tab gates. US2 depends on the setting/contract work from US1. US3 can be implemented after Phase 2, but its regression tests must pass with US1’s resolver changes.
- Within each story, tests are written before the corresponding implementation tasks.
- T003/T004/T005 can run in parallel after T001; T006/T007 can run in parallel; T011–T013 can run in parallel; T018/T019 can run in parallel.

## Implementation strategy

1. Deliver US1 first so administrators can independently control both public areas.
2. Deliver US2 as the MVP shareable training link, including database-level anonymization and negative tests.
3. Preserve and harden US3’s existing public Veo contract.
4. Run the complete repository validation before handoff.
