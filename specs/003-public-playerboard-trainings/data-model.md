# Data Model: Öffentliche Trainings

## Team public settings

Existing `playerboard_settings` rows at `scope = team` gain:

- `public_trainings_enabled boolean`: whether saved trainings may be listed and opened publicly; `null` means disabled for the team’s own row and is mapped to false in the public resolver.

The existing `public_sharing_allowed`, module-enabled check and `public_slug` remain mandatory gates.

## Public training summary

- `id uuid`: opaque training identifier used only to build a share link; it is not a person identifier.
- `trainingDate date`: saved training date.
Only rows with `status = saved` and a team whose public training switch is enabled are returned.

## Public training detail

- `trainingDate date`
- `entries[]`:
  - `label string`: database-generated `#number Initials` or `Initials`, never a name or ID.
  - `category string`
  - `value integer`

The detail intentionally has no `trainingId`, `playerId`, `directoryPersonId`, `profileId`, email, birth data, position or internal URL.

## Public Veo player representation

The existing public Veo schema remains the source of truth: each player entry has `jerseyNumber`, `label`, and stats only. Internal IDs, names and matching metadata remain absent from the public variant.
