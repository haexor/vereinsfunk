# Quickstart: Public trainings and anonymized Veo

1. Start the local Supabase stack and apply migrations:

   ```bash
   pnpm db:start
   pnpm db:reset
   ```

2. Run focused tests:

   ```bash
   pnpm --filter @vereinsfunk/web test -- app/pages/playerboardPages.test.ts
   pnpm --filter @vereinsfunk/web typecheck
   pnpm --filter @vereinsfunk/api test -- src/playerboard.routes.test.ts
   supabase test db --file supabase/tests/playerboard_core.test.sql
   ```

3. Manual scenario:

   - Enable public sharing, public trainings and public Veo for a team.
   - Create and save a training with at least one point entry and one Veo match.
   - Open the internal training overview and click “Link kopieren”.
   - Open the copied link without authentication.
   - Verify the training date and anonymized labels are visible, while free titles, full names, IDs and emails are absent.
   - Disable public trainings and verify the same training URL returns not found; disable public Veo and verify the Veo endpoint does likewise.
