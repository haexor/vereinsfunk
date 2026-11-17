# Data Model: Hierarchische öffentliche PlayerBoard-URLs

No new table. Changes touch `teams` (one index), `playerboard_settings` (one constraint, one trigger function) and the public resolution functions.

## Address

`/mannschaft/<organization.slug>/<department.slug>/<team.public_slug>`

| Segment | Source | Stability | Format |
|---|---|---|---|
| club | `organizations.slug` (unique) | stable | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 200 |
| department | `departments.slug` (unique per organization) | stable, rename does not change it | same, ≤ 200 |
| team | `playerboard_settings.public_slug` where `scope = 'team'` | regenerated when `teams.name` changes | same, ≤ 80, no UUID, ID or counter |

Only the team segment is generated. It is not editable through API or UI.

## Functions

| Function | Change |
|---|---|
| `authz.playerboard_slug_part(text)` | unchanged |
| `authz.team_url_slug(name text) → text` | new, `immutable`: `rtrim(left(coalesce(nullif(playerboard_slug_part(name), ''), 'mannschaft'), 80), '-')` |
| `authz.playerboard_team_public_slug(dept_id, team_id)` | replaced by `team_url_slug(team.name)`; the old function is dropped |
| `authz.set_playerboard_public_slug()` | team scope: `public_slug := team_url_slug(team.name)`; other scopes: `null` |
| `authz.refresh_playerboard_public_slugs()` | only the `teams` branch remains |
| trigger `departments_refresh_playerboard_public_slug` | dropped (department slug does not depend on the name) |
| `authz.playerboard_public_team(org_slug, department_slug, team_slug)` | new three-argument signature; old one dropped |
| `public.playerboard_public_team_info(org_slug, department_slug, team_slug)` | also returns `organization_id, department_id, team_id` (service role only) |
| `public.playerboard_public_trainings`, `_training`, `_ranking`, `_photos`, `_veo_stats` | new `department_slug` parameter after `org_slug`; old signatures dropped |

All stay `security definer`, `set search_path = public, pg_temp`, `revoke … from public`, `grant execute … to service_role`.

## Constraints and indexes

| Object | Change | Invariant |
|---|---|---|
| `teams_active_url_slug_unique` | new partial unique index on `(organization_id, department_id, authz.team_url_slug(name)) where archived_at is null` | two active teams in one department never share a team segment (FR-016) |
| `playerboard_settings (organization_id, public_slug)` unique | dropped | uniqueness is owned by the teams index; resolution filters `team.archived_at is null`, so a stale slug on an archived team is unreachable |
| `playerboard_settings_public_fields_scope_check`, format check on `public_slug` | unchanged | non-team rows keep `public_slug is null` |

## Resolution rule

A request resolves to one team only if all of these hold, otherwise zero rows:

1. `organizations.slug = org_slug`
2. `departments.slug = department_slug`, same organization, `departments.archived_at is null`
3. `playerboard_settings.public_slug = team_slug`, `scope = 'team'`, joined to a team of that department with `teams.archived_at is null`
4. `authz.module_enabled(..., 'playerboard')` and `resolve_playerboard_setting(..., 'public_sharing_allowed') = 'true'`
5. the data-area switch of the route (`points`, `trainings`, `veo_stats`, `photos`) is on

The route handlers keep their own switch checks on top, as today.

## State transitions

| Event | Effect on address |
|---|---|
| team created | settings row (when it exists) gets `public_slug` from the name; collision rejected |
| team renamed | `public_slug` regenerated, old address serves nothing, no redirect; collision rejected |
| team archived | address serves nothing; the slug stays on the row |
| team un-archived | rejected if an active team in the department now owns the slug |
| department renamed | no change |
| department archived | address serves nothing |
| team moved to another department (only via sync, only when no settings row blocks the composite FK) | resolves under the new department slug; rejected on collision |

## Migration order (`2026111702_playerboard_hierarchical_public_url.sql`)

1. Preflight: collisions among active teams per department; non-conforming or over-long organization and department slugs (>200 characters) for departments that have team settings rows. Raise one exception listing offenders; change nothing.
2. Create `authz.team_url_slug`.
3. Create `teams_active_url_slug_unique`.
4. Replace `set_playerboard_public_slug`, `refresh_playerboard_public_slugs`; drop the department trigger and `playerboard_team_public_slug`.
5. Drop the settings `(organization_id, public_slug)` unique constraint.
6. Rewrite existing team slugs: `update public.playerboard_settings set public_slug = public_slug where scope = 'team'`.
7. Create the new resolver and the six public functions; drop the old two-argument versions.

Name formats, `public_player_name_format`, all data switches and `public_sharing_allowed` are not touched.
