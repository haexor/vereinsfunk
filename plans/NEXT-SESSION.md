# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git log --oneline main..HEAD` und `gh pr list --state open`.

## Ausgangslage: Plan 034 gemergt, Plan 035 vollständig ausgeplant

PR #50 (`worktree-llm-provider-dropdowns`, Plan 034: SSRF-Sperre im Textgenerierungspfad + Kandidaten-Wiederherstellung nach Absturz) ist **gemergt** (`2026-08-12T09:23:34Z`, Merge-Commit `0bd63886`). Alle Done-Kriterien aus Plan 034 sind erreicht, mit einer dokumentierten Restlücke: der 15-Minuten-Lease-Rückfall in `acquire_generation_candidate` kann nach einem echten Worker-Absturz in der Praxis nie greifen, weil Hatchets eigenes Wiederholungsbudget strukturell davor aufgebraucht ist.

Diese Restlücke ist jetzt in `plans/035-generation-recovery-trigger.md` **vollständig ausgeplant** (nicht mehr nur eine Skizze). Alle fünf zuvor offenen Architektur-/Produktentscheidungen sind mit dem Nutzer abgestimmt:

1. **Trigger-Ort**: ein eigener, bei Hatchet deklarativ per `onCrons` registrierter Workflow (`generation-recovery-scan`) — kein `setInterval` im Worker-Prozess (der Nutzer wies zu Recht darauf hin, dass das einen Server-Neustart/Redeploy nicht übersteht). Der Schedule lebt in Hatchets eigenem Scheduler.
2. **Fencing-Token**: neue Spalte `generation_candidates.generation_lease_token`, analog `workflow_runs.worker_lease_token`.
3. **Kontingent**: **nicht Teil dieses Plans.** Der Nutzer plant ein vollständiges Token-Budget-Modell (Verein → Abteilung → Team, hartes Limit, tarifabhängig) — das ist die bereits in `plans/021-abomodelle-und-speicherkontingent.md:277-280` angekündigte Erweiterung, kein neues Thema. Separater Plan, wenn es soweit ist.
4. **Sichtbarkeit**: neues Feld `generation_candidates.triggered_by` (`'member' | 'automatic_recovery'`).
5. **Obergrenze**: neue Zählspalte `composition_sessions.candidate_count` mit CHECK-Constraint (Platzhalter-Grenzwert `8`, unkalkuliert — vor Produktivbetrieb bestätigen).

Wichtige technische Erkenntnis beim Ausplanen: `WorkflowPayloadSchema` verlangt zwingend eine einzelne `entityId`/`organizationId` — ein Scan über alle hängenden Kandidaten passt nicht in das bestehende generische Pro-Entity-Workflow-Schema (`WorkflowNameSchema`/`createWorkflowDefinitions`). Der neue Workflow ist deshalb bewusst **außerhalb** dieser generischen Schleife registriert, ohne `workflow_runs`/`workflow_outbox`-Buchhaltung (er ist durch `claim_stalled_generation_candidates`s `skip locked`-Semantik bereits gegen Nebenläufigkeit sicher) — Details und Begründung stehen im Plan, Step 4.

## Nächster Schritt

Plan 035 umsetzen (fünf Schritte, siehe Plan: Fencing-Token, sichtbares Auslöser-Feld, Obergrenze, der eigentliche Recovery-Workflow, Dokumentation) — in einem neuen Worktree/Branch, nicht auf `main`. Vor Beginn den „Drift check" am Kopf des Plans ausführen (SDK-Version, Datei-Diffs seit `0bd63886`) und insbesondere die STOP-Bedingung zu Hatchets Server-/SDK-Cron-Unterstützung in der lokal gepinnten Version verifizieren, bevor Step 4 begonnen wird.

Alternativ, falls der Nutzer zuerst anderswo weiterarbeiten möchte: aus `plans/README.md`, Tabelle „Vierte Serie", sind 029 und 031 als „bereit" markiert (beide abhängig von 027, das mit PR #38 vollständig gemergt ist).
