# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch` und `git log --oneline main..HEAD`. Falls PR #52 (Plan 035, Branch `worktree-plan-035-recovery-implementierung`) noch nicht gemergt ist, das zuerst klären.

## Ausgangslage: Plan 035 umgesetzt, PR #52 offen, Review-Runde 1 abgearbeitet

Plan 034 (PR #50) ist gemergt. Plan 035 (`plans/035-generation-recovery-trigger.md`) ist vollständig umgesetzt:

- **Fencing-Token**: `generation_candidates.generation_lease_token`; `acquire_generation_candidate`/`mark_generation_candidate_ready`/`mark_generation_candidate_failed`/`release_generation_candidate`/`finalize_stalled_generation_recovery` sind fenced, pgTAP-getestet.
- **Sichtbarkeit**: `generation_candidates.triggered_by` (`'member' | 'automatic_recovery'`), sichtbarer Hinweis in `apps/web/app/pages/erstellen.vue` bei `automatic_recovery`.
- **Obergrenze**: `composition_sessions.candidate_count`, Platzhalter-Grenzwert `8` (unkalkuliert, vor Produktivbetrieb mit dem Nutzer zu bestätigen — siehe Plan, STOP conditions).
- **Recovery-Workflow**: `claim_stalled_generation_candidates` claimt nur (Fencing-Token/`updated_at` erneuert, kein terminaler Status), `finalize_stalled_generation_recovery` setzt den alten Kandidaten erst `failed`, sobald der Ersatzversuch erzeugt wurde oder das Kandidatenlimit erreicht ist — ein Absturz zwischen beiden Schritten verliert den Kandidaten dadurch nicht, siehe `docs/operations/hatchet.md`. Eigenständiger Hatchet-Workflow `generation-recovery-scan` (`apps/worker/src/generationRecovery.ts`), deklarativ per `onCrons: ['*/5 * * * *']` registriert, außerhalb von `WorkflowNameSchema`s Pro-Entity-Schleife.

**Abweichung von der Ausplanung** (technische Korrektur, per `tsc` verifiziert): der Plan ging davon aus, `onCrons` sei nur auf `client.workflow(...)` verfügbar. Tatsächlich liegt `onCrons` auf `CreateBaseWorkflowOpts`, das in `CreateTaskWorkflowOpts` (die Optionen von `client.task(...)`) enthalten ist — die im bestehenden Code bereits genutzte `client.task(...)`-Kurzform funktioniert direkt, keine `client.workflow(...)`-Umleitung nötig.

**Nicht behoben, wie geplant zurückgestellt**: Kontingent-Interaktion (Paket 021), provider-seitige Idempotenz gegen doppelt abgerechnete LLM-Aufrufe (aus Plan 034), UI-Anzeige verbleibender Versuche vor Erreichen der Obergrenze.

Lokal verifiziert: der volle Gate (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`), `pnpm db:reset && pnpm db:test` sowie ein Browser-Check des `triggered_by`-Hinweises in `erstellen.vue` (alle grün, siehe PR-Beschreibung #52).

## Nächster Schritt

1. Verbleibende CodeRabbit-Runde(n) zu PR #52 abarbeiten, dann mergen.
2. Nach Merge: `plans/README.md` bleibt aktuell (bereits in diesem Branch auf „erledigt" nachgezogen).
3. Vor Produktivbetrieb: den `candidate_count`-Platzhalter (`8`) mit dem Nutzer kalibrieren.

Alternativ, falls der Nutzer zuerst anderswo weiterarbeiten möchte: aus `plans/README.md`, Tabelle „Vierte Serie", sind 029 und 031 als „bereit" markiert (beide abhängig von 027, das mit PR #38 vollständig gemergt ist).
