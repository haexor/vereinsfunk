# Plan 030: Verbotene Selbstfreigabe auch im Reviewer-Snapshot entfernen

> **Executor instructions**: Diese kleine Änderung darf die SQL-Verteidigung nicht abschwächen. Zuerst Tests ergänzen, dann implementieren.
>
> **Drift check (run first)**: `git diff --stat 1883758f..HEAD -- packages/domain/src apps/api/src/app.ts supabase/migrations/2026080606_policies_and_review_routes.sql`

## Status

- **Priority**: P2
- **Implementation note (2026-08-09)**: erledigt. `resolveReviewRoute` gibt die gefilterten `effectiveReviewers` als Snapshot zurück; Regressionstests decken reguläre und Minderjährigenstufen ab. Die SQL-Verteidigung blieb unverändert.
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug, tests
- **Planned at**: commit `1883758f`, 2026-08-09

## Why this matters

Bei `selfApprovalAllowed=false` berechnet `resolveReviewRoute` zwar eine gefilterte Reviewer-Menge, nutzt sie aber nur für die Prüfung auf eine leere Stufe. Die zurückgegebenen `ReviewStage.reviewerUserIds` enthalten weiterhin den Autor und werden von der API als `reviewerSnapshot` persistiert. PostgreSQL verhindert die Entscheidung korrekt, aber UI, Snapshot und Audit sagen fälschlich, der Autor sei Reviewer.

## Current state

- `packages/domain/src/index.ts:303-327` berechnet `effectiveReviewers`, gibt bei Zeile 323 jedoch `stage.reviewerUserIds` zurück.
- `packages/domain/src/domain.test.ts:482-487` testet den nicht blockierenden Fall, prüft den Rückgabesnapshot aber nicht.
- `apps/api/src/app.ts:4208-4214` serialisiert `stage.reviewerUserIds` direkt in `reviewerSnapshot`.
- `supabase/migrations/2026080606_policies_and_review_routes.sql:330-355` bleibt die zwingende Verteidigung in der Tiefe und blockiert Selbstentscheidungen zusätzlich.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Domain tests | `pnpm --filter @vereinsfunk/domain test` | exit 0 |
| API tests | `pnpm --filter @vereinsfunk/api test` | exit 0 |
| Full gate | `pnpm check` | exit 0 |

## Scope

**In scope**

- `packages/domain/src/index.ts`
- `packages/domain/src/domain.test.ts`
- optional ein fokussierter API-Test in `apps/api/src/app.test.ts`

**Out of scope**

- keine SQL-Migration und keine Änderung von `authz.can_decide_stage`
- keine Änderung der Freigaberouten- oder Minderjährigenlogik

## Steps

### Step 1: Regressionstests schreiben

Erweitere den vorhandenen Test mit `reviewerUserIds: ['author', 'trainer']` und `selfApprovalAllowed:false`: die resultierende Stufe enthält ausschließlich `trainer`. Ergänze für eine Minderjährigenstufe denselben Fall. Der Author-only-Fall bleibt Blocker.

**Verify**: `pnpm --filter @vereinsfunk/domain test` → alle Tests grün, neue Erwartungen schlagen gegen den alten Code fehl.

### Step 2: Effektive Reviewer persistierbar zurückgeben

Ändere `resolveReviewRoute`, sodass `ReviewStage.reviewerUserIds` die bereits berechneten `effectiveReviewers` erhält. Nur wenn Selbstfreigabe erlaubt ist, ist sie identisch mit der Eingabe. Aktualisiere Kommentierung und ggf. API-Test, der den RPC-Payload inspiziert.

**Verify**: `pnpm --filter @vereinsfunk/domain test && pnpm --filter @vereinsfunk/api test` → exit 0.

## Done criteria

- [ ] Der Autor erscheint bei verbotener Selbstfreigabe in keinem regulär erzeugten Reviewer-Snapshot.
- [ ] Author-only bleibt ein verständlicher Blocker.
- [ ] SQL-Verteidigung bleibt unverändert.
- [ ] `pnpm check` besteht.

## STOP conditions

- Die Änderung würde einen bestehenden, bereits persistierten Snapshot umschreiben.
- Tests zeigen, dass `reviewerUserIds` noch eine zweite fachliche Bedeutung hat.

## Maintenance notes

Die SQL-Prüfung bleibt zwingend: direkte RPC-Aufrufer können Route-Payloads formen und brauchen weiterhin Defense in Depth.
