# Quickstart: Hierarchische öffentliche PlayerBoard-URLs

## Before the migration touches real data

The migration's preflight (step 1 in `data-model.md`: normalized team-name collisions, unusable club or department slugs) aborts with a list of offenders and changes nothing. Apply the migration to a copy of the target data first, and rename or archive the listed teams before the real run.

## Verify locally

1. Start Supabase and apply migrations:

   ```bash
   pnpm db:start
   pnpm db:reset
   ```

2. Database checks (isolation and timestamp scripts run as part of `db:test`):

   ```bash
   pnpm db:test
   supabase test db --file supabase/tests/playerboard_public_slug.test.sql
   supabase test db --file supabase/tests/playerboard_core.test.sql
   ```

3. Package tests, types, lint, build:

   ```bash
   pnpm --filter @vereinsfunk/contracts test
   pnpm --filter @vereinsfunk/api test -- src/playerboard.routes.test.ts
   pnpm --filter @vereinsfunk/web test -- app/utils/publicTeamPage.test.ts app/pages/playerboardPages.test.ts app/pages/apiClientPages.test.ts
   pnpm typecheck && pnpm lint && pnpm build
   ```

4. Manual scenario (use `run-web` for the browser part):

   - Create club `sv-nordstadt` with departments `fussball` and `handball`, each with a team named `U13`.
   - Enable public sharing, points and trainings for both teams.
   - Open `/playerboard/einstellungen` for each team. Each shows `…/mannschaft/sv-nordstadt/fussball/u13` and `…/handball/u13` and copies it unchanged.
   - Open both addresses in a private window. Each shows only its own team's data and colors.
   - Open `/mannschaft/sv-nordstadt/u13`, `/mannschaft/sv-nordstadt/fussball/u14`, `/mannschaft/sv-nordstadt/handball/fussball/u13` and the same with a trailing slash. None shows data; the legacy two-segment path returns 404 without redirect, while other malformed paths stay behind sign-in.
   - Rename the football team to `U14`. The old address serves nothing, `…/fussball/u14` works, and the handball team is unaffected.
   - Try to create a second active `u13` in the handball department (case-only variant of `U13`). The API answers `409 team_name_taken`. Then rename that team to `U-13` and try `u 13` or `U_13`; those names normalize to the same `u-13` segment and also answer `409 team_name_taken`.
   - Copy a training link from `/playerboard/trainings`. It contains the three-segment path and `?training=<id>`, and opens anonymously.

## Rollback

Ship a follow-up migration that first restores the old generator and department refresh trigger from `2026111701`, then re-runs the slug rewrite, and only after that restores the settings unique constraint on `(organization_id, public_slug)`. Restore the two-argument functions as part of the same migration. Rewriting first gives every team its old department-and-ID-based slug, so equal team names in different departments do not block the old constraint. Previously shared three-segment links stop working again, as after any address change.
