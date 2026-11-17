# Contract: Public PlayerBoard address and endpoints

## Page

`GET /mannschaft/:orgSlug/:departmentSlug/:teamSlug` (Nuxt page `mannschaft/[orgSlug]/[departmentSlug]/[teamSlug].vue`, layout `auth`, no sign-in). Optional query `?training=<uuid>` selects a training.

The auth middleware lets through exactly `^/mannschaft/<slug>/<slug>/<slug>$` with `<slug> = [a-z0-9]+(?:-[a-z0-9]+)*`, organization and department segments up to 200 characters, a team segment up to 80 characters, and a total path length of at most 512. Everything else under `/mannschaft` stays behind sign-in: fewer or more segments, empty segment, trailing slash, uppercase, `..`, `/mannschaftx/...`.

`/mannschaft/:orgSlug/:teamSlug` (old form) returns a public 404 tombstone for both authenticated and anonymous visitors. It returns no data and does not redirect to sign-in or the new path.

## API (anonymous, rate limited 120 per 60 s per IP, unchanged)

Base: `/v1/public/playerboard/:orgSlug/:departmentSlug/:teamSlug`. Each param is validated with its segment-specific slug schema (organization and department max 200; team max 80) before any RPC.

| Method and path | RPC | Gate besides address | Response |
|---|---|---|---|
| `GET {base}` | `playerboard_public_team_info` | at least one tab on | `PublicPlayerboardTeamSchema`, unchanged |
| `GET {base}/trainings` | `playerboard_public_trainings` | `trainings_enabled` | `PublicPlayerboardTrainingSummarySchema[]`, unchanged |
| `GET {base}/trainings/:trainingId` | `playerboard_public_training` | `trainings_enabled`, training belongs to the team, status `saved` | `PublicPlayerboardTrainingSchema`, unchanged |
| `GET {base}/ranking?from&to` | `playerboard_public_ranking` | `points_enabled` | `PublicPlayerboardRankingEntrySchema[]`, unchanged |
| `GET {base}/veo?from&to` | `playerboard_public_veo_stats` | `veo_stats_enabled` | `PublicPlayerboardVeoMatchSchema[]`, unchanged |
| `GET {base}/photos?from&to` | `playerboard_public_photos` | `photos_enabled`, consent rules | `PublicPlayerboardPhotoSchema[]`, unchanged |

Failure behavior:

- `429 {error: 'rate_limited', correlationId}` when the limit is hit.
- `404 {error: 'not_found', correlationId}` for every other failure: invalid segment, unknown address, wrong club, wrong department, wrong team, archived team or department, module or sharing closed, switch off, foreign training. The body and status are identical for all of them.
- Old two-segment API URLs (`/v1/public/playerboard/:org/:team[...]`) have explicit retired-route handlers returning the same generic 404 body as an unknown public address. They return no data and do not redirect.

Response bodies keep their current fields. No IDs, birth years, positions or emails are added. The internal `organization_id`, `department_id`, `team_id` returned by the info RPC stay inside the API process and are not part of any response schema.

## Authenticated settings API

`GET /v1/organizations/:orgId/playerboard/settings`

- `own.publicSlug`: team segment only (for example `u13`) or `null`.
- `publicPath`: `/mannschaft/<org>/<department>/<team>` for team scope when a team segment exists and all three segments pass their respective schemas, otherwise `null`. Built by `publicTeamPath()`.
- `PATCH` cannot set `publicSlug` (unchanged).

The settings page copies `window.location.origin + publicPath`. The training overview copies the same path plus `?training=<id>`.

## Structure API additions

- `POST /v1/departments/:id/teams` and `PATCH /v1/teams/:id` (rename and un-archive): `409 {error: 'team_name_taken', correlationId}` when the normalized name collides with an active team in the same department.

## Shared contract additions (`packages/contracts/src/playerboard.ts`)

```ts
OrganizationPublicSlugSchema // z.string().max(200).regex(slug pattern)
DepartmentPublicSlugSchema   // z.string().max(200).regex(slug pattern)
TeamPublicSlugSchema         // z.string().max(80).regex(slug pattern)
PublicTeamAddressSchema      // { orgSlug, departmentSlug, teamSlug } using these schemas
publicTeamPath(address)     // '/mannschaft/<org>/<department>/<team>'
```
