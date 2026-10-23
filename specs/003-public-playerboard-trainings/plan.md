# Implementation Plan: Öffentliche Trainings und anonymisierte Veo-Statistiken

**Branch**: `feat/training-public-link-copy` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

## Summary

Add a team-level public-trainings switch beside the existing public Veo switch, expose only saved training data through unauthenticated endpoints, and keep the public boundary limited to anonymous labels (`#Trikotnummer Initialen`). The internal training overview loads the team’s public path and copies a training-specific query link. Existing public Veo output remains enabled independently and is covered by stronger negative contract tests.

## Technical Context

**Language/Version**: TypeScript 6, Vue/Nuxt 4, SQL migrations

**Primary Dependencies**: Fastify, Supabase PostgreSQL, Zod, Vue, Lucide

**Storage**: Supabase PostgreSQL with RLS/security-definer public functions

**Testing**: Vitest, API route tests, pgTAP isolation tests, Nuxt typecheck/lint/build

**Target Platform**: Web browser, Fastify API, PostgreSQL

**Project Type**: Multi-package web application

**Performance Goals**: Public training and tab responses should be a single bounded API read and remain responsive on mobile.

**Constraints**: No authentication for public reads; no person/account identifiers, names, emails, birth data or profile links in public payloads; public content only when module, team and setting gates all allow it.

**Scale/Scope**: One public training list and one selected training view per team; existing Veo public match view is preserved.

## Constitution Check

*GATE: Must pass before Phase 0 research and after Phase 1 design.*

- Dedicated topic worktree and branch: PASS (`feat/training-public-link-copy`).
- Existing public/provider boundaries: PASS; the API remains the public boundary and Supabase remains source of truth.
- Tenant isolation: PASS; public functions resolve one organization/team slug and verify the training belongs to that team.
- Privacy/security: PASS; public SQL functions return only anonymous labels and no person IDs; closed content returns 404.
- Tests separate from production code: PASS; API, contract/source, and pgTAP tests remain separate.
- No new dependency: PASS.
- Graphify-first consultation: PASS; existing public route, settings mapper, public contracts, and team page were evaluated and extended rather than duplicated.

## Phase 0: Research

### Decisions

- Use the existing public team URL with a `training` query parameter for the training-specific link. This keeps the public route family and middleware stable while making every training link distinct.
- Add a separate `public_trainings_enabled` team setting. Existing `public_points_enabled`, `public_photos_enabled`, and `public_veo_stats_enabled` do not express whether individual trainings are listed/shared.
- Reuse `playerboard_public_label` as the only public player representation. It produces `#7 M. K.` or `M. K.` and never returns a person identifier.
- Return public training data through security-definer functions and Zod schemas that contain no player, directory, profile, or email fields.
- Treat saved status and all public gates as mandatory for both list and selected-training reads.

## Phase 1: Design

### Data and contracts

- Add `publicTrainingsEnabled` to team settings and the settings update contract.
- Add public team tab `trainings`.
- Add public training summary and detail contracts. Summary contains an opaque training ID and date; detail contains date and category/label/value rows only. Free titles and notes remain private.
- Extend the public team resolver with `trainings_enabled` and add list/detail SQL functions that filter to saved trainings and use `playerboard_public_label`.

### UI flow

- Settings page exposes “Trainings öffentlich anzeigen”.
- Internal training overview loads the selected team’s public settings. Each saved training gets a “Link kopieren” button when a public training path is available; clipboard failures are shown as an inline error.
- Public team page adds a Trainings tab. It lists saved trainings and opens the selected training via `?training=<opaque id>`. The selected view renders only the public detail contract.

### Security verification

- API tests cover closed switches, wrong-team training IDs, drafts, and no-auth responses.
- Contract/source tests assert public training and Veo schemas/routes do not expose player or directory identifiers or names.
- pgTAP assertions in `supabase/tests/playerboard_core.test.sql` assert the public SQL functions return anonymous labels only and are empty/closed when settings or status disallow publication.

## Project Structure

```text
specs/003-public-playerboard-trainings/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/public-playerboard.md
├── quickstart.md
└── tasks.md

supabase/migrations/2026102301_public_playerboard_trainings.sql
supabase/tests/playerboard_core.test.sql
packages/contracts/src/playerboard.ts
apps/api/src/routes/playerboard/settings.ts
apps/api/src/routes/playerboard/public.ts
apps/api/src/playerboard.routes.test.ts
apps/web/app/pages/playerboard/einstellungen.vue
apps/web/app/pages/playerboard/trainings/index.vue
apps/web/app/pages/mannschaft/[orgSlug]/[teamSlug].vue
apps/web/app/pages/playerboardPages.test.ts
```

**Structure Decision**: Extend the existing PlayerBoard contracts, API routes, public SQL functions, pages and tests. No parallel public module or provider is introduced.

## Complexity Tracking

No constitution violations identified.
