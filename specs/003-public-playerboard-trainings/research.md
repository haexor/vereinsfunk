# Research: Öffentliche Trainings und anonymisierte Veo-Statistiken

## Decision: Reuse the public team URL with a training query

**Rationale**: The application already has an unauthenticated team page and a strict middleware predicate for that route. A query parameter identifies the selected training without exposing a new route family or duplicating the public page shell.

**Alternatives considered**: A new `/training/:id` route would provide a clean URL but would duplicate public-page routing and require another public middleware path. A date-only query is ambiguous when a team has multiple trainings on one date.

## Decision: Separate public training switch

**Rationale**: Public Veo and public training data have different privacy and sharing decisions. Reusing the points switch would make it impossible to publish a ranking without publishing individual training entries or vice versa.

**Alternatives considered**: Treating public trainings as an implicit consequence of `publicPointsEnabled` was rejected because it violates the requested configurability.

## Decision: Anonymize at the database public-function boundary

**Rationale**: `playerboard_public_label` already forms the approved `#7 M. K.` representation. Returning only this derived value plus category/value fields prevents API mappers and frontend code from accidentally leaking IDs or names.

**Alternatives considered**: Returning internal player rows and stripping fields in Vue or Fastify was rejected because the database/API boundary would still carry personal data.

## Decision: 404 for closed or invalid public training reads

**Rationale**: The existing public team API uses not-found semantics for closed public pages. The training list/detail endpoints follow the same behavior and do not reveal whether a private or draft training exists.

**Alternatives considered**: Returning 403 would distinguish existence and expose a different public error contract.
