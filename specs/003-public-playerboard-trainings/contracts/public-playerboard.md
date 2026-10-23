# Public PlayerBoard Contract

## Team metadata

`GET /v1/public/playerboard/{orgSlug}/{teamSlug}` returns the existing team metadata and a `tabs.trainings` boolean. It returns 404 when no public tab is enabled or the team is not publicly available.

## Training list

`GET /v1/public/playerboard/{orgSlug}/{teamSlug}/trainings` returns an array of:

```json
{
  "id": "opaque-training-uuid",
  "trainingDate": "2026-10-22"
}
```

The ID identifies a training only; no player or directory identifier is returned.

## Training detail

`GET /v1/public/playerboard/{orgSlug}/{teamSlug}/trainings/{trainingId}` returns:

```json
{
  "trainingDate": "2026-10-22",
  "entries": [
    { "label": "#7 M. K.", "category": "Fairness", "value": 5 }
  ]
}
```

No public contract may contain a player ID, directory ID, profile ID, full name, email, birth data, position or internal person URL. Closed, draft, wrong-team and invalid training reads return 404.
