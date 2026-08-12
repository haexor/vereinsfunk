# Plan 035: Von Hatchets Wiederholungsbudget unabhängiger Recovery-Trigger für hängende Textgenerierungs-Kandidaten

> **Executor instructions**: Dieses Dokument vollständig lesen, die Schritte in Reihenfolge ausführen und nach jedem Schritt verifizieren. Bei einer STOP-Bedingung anhalten und berichten. Danach den Status dieses Plans im Index (`plans/README.md`) aktualisieren.
>
> **Drift check (run first)**: `git diff --stat 0bd63886..HEAD -- supabase/migrations supabase/tests apps/worker/src apps/api/src/app.ts apps/web/app/pages/erstellen.vue`. Prüfe zusätzlich, ob `@hatchet-dev/typescript-sdk` in `apps/worker/package.json` noch `1.28.1` (oder eine Version mit unverändertem `onCrons`/`CronClient`-Verhalten) ist — dieser Plan verlässt sich auf die deklarative `onCrons`-Option aus `v1/declaration.d.ts`.

## Status

- **Priority**: P1 (schließt die seit Plan 034 dokumentierte, real produktwirksame Lücke: ein Mitglied bleibt nach einem Worker-Absturz dauerhaft auf „wird generiert" stehen)
- **Effort**: M
- **Risk**: MEDIUM — zwei additive Migrationen mit Signaturänderungen an vier bereits genutzten RPCs (Fencing-Token), ein neuer, unabhängig geplanter Hatchet-Workflow.
- **Depends on**: 034 (vollständig umgesetzt und gemergt — Commit `22149b83` auf PR #50, gemergt `2026-08-12T09:23:34Z`)
- **Category**: bug, migration, reliability
- **Planned at**: commit `0bd63886`, 2026-08-12

## Why this matters

Plan 034 gab `acquire_generation_candidate` einen 15-Minuten-Lease-Rückfall für einen seit über 15 Minuten auf `generating` hängenden Kandidaten (`supabase/migrations/2026081202_generation_candidate_lease_recovery.sql:21-53`). Dieser Rückfall greift aber nur, wenn die Funktion erneut *aufgerufen* wird — und der einzige heutige Aufrufer ist `TextGenerationExecutor.execute()` (`apps/worker/src/textGeneration.ts:57-84`), ausgelöst durch einen Hatchet-Workflow-Versuch (`apps/worker/src/workflows.ts:57-86`, `retries: 3`, `backoff: { factor: 2, maxSeconds: 60 }`, `executionTimeout: '10m'`).

Hatchets eigenes Wiederholungsbudget ist strukturell immer vor der 15-Minuten-Schwelle aufgebraucht: der erste Wiederholungsversuch kommt nach `executionTimeout` (10 Minuten), jeder weitere binnen Sekunden bis maximal 60 Sekunden Backoff. Nach drei Versuchen gibt Hatchet den Workflow-Run endgültig auf (`technical_status = 'failed'`/`'action_required'` via `finish_workflow_run`, `supabase/migrations/2026081102_workflow_run_lifecycle.sql:150-170`), und nichts im System (bestätigt über `apps/worker/`, `apps/api/`, die Outbox-Dispatch-Migrationen, `docs/operations/hatchet.md`) sendet einen so beendeten Run je erneut an Hatchet. Ohne einen von Hatchets Versuchszählung unabhängigen Auslöser bleibt ein nach einem echten Worker-Absturz hängender Kandidat für die betroffenen Vereinsmitglieder dauerhaft auf „wird generiert" stehen.

Dieser Plan ist die im Nachtrag von Plan 034 angekündigte Fortsetzung (`plans/README.md`, Zeile zu 033; `plans/NEXT-SESSION.md` vor Umsetzung dieses Plans).

## Current state

- `supabase/migrations/2026081003_text_workshop_foundation.sql:139-164` — `generation_candidates`: `generation_intent text not null check (generation_intent in ('initial', 'revise'))` (Zeile 144), gekoppelt an `revision_instruction` per zweitem CHECK (Zeile 163). Kein Lease-Token, kein `triggered_by`. `composition_sessions` (Zeile 65ff.) hat keine Zählspalte für Generierungsversuche.
- `supabase/migrations/2026081105_text_generation_review_fixes.sql:15-71` — `create_text_generation_session`: einziger Einfügepunkt für `generation_candidates`-Zeilen, sowohl für die erste Generierung (`POST /v1/text-workshop/sessions`, `apps/api/src/app.ts:1450-1487`) als auch für eine manuelle Überarbeitung (`POST /v1/text-workshop/sessions/:id/generations`, `apps/api/src/app.ts:1502-1529`). Serialisiert per `pg_advisory_xact_lock` auf `(organization_id, input_hash)`, dedupliziert Kandidaten per `candidate_input_hash`.
- `supabase/migrations/2026081105_text_generation_review_fixes.sql:147-212` — `acquire_generation_candidate`, `mark_generation_candidate_ready`, `mark_generation_candidate_failed`, `release_generation_candidate`: alle vier prüfen nur `status = 'generating'` in ihrer `WHERE`-Klausel, kein Fencing gegen einen veralteten Aufrufer. `apps/worker/src/context.ts:103-118` ruft alle vier ausschließlich per Service-Role-RPC auf.
- `supabase/migrations/2026081102_workflow_run_lifecycle.sql:7-8,116-148` — bereits etabliertes, getestetes Fencing-Muster für `workflow_runs`: `worker_lease_token uuid`, gesetzt bei `begin_workflow_run` (`gen_random_uuid()`), geprüft bei `finish_workflow_run` (`and worker_lease_token = p_lease_token`). Dieses Muster deckt nur die technische Run-Buchhaltung ab, nicht `generation_candidates`.
- `packages/contracts/src/index.ts:576-579` — `WorkflowNameSchema` (elf reservierte Namen, u. a. `sync-integration-source`, `enforce-retention`, `aggregate-metrics` als „reserviert, nicht verdrahtet") und `WorkflowPayloadSchema`: `entityId`, `organizationId`, `departmentId` sind **zwingend**, nicht optional. Jeder heutige Workflow ist damit eine Pro-Entity-Aktion.
- `apps/worker/src/workflows.ts:52-86` — `createWorkflowDefinitions` registriert generisch **jeden** Namen aus `WorkflowNameSchema.options` als `client.task<WorkflowPayload, void>({...})` mit identischer Retry-/Concurrency-/Idempotenz-Konfiguration, gebunden an `WorkflowExecutionRepository` (`workflow_runs`-Lease) und `ProductWorkflowExecutor.execute()`. `apps/worker/src/index.ts:60-64` routet `'generate-text-post'` an `TextGenerationExecutor`; jeder andere Name wirft `product_executor_unavailable`.
- `apps/worker/src/index.ts:15-16,26-38,84-85` — einziger periodischer Timer im System: `setInterval(() => dispatchOnce(dispatcher), 1_000)` für den ID-only-Outbox-Dispatch (`WorkflowOutboxDispatcher`, `packages/orchestration/src/index.ts:26-39`). Lebt ausschließlich im Prozessspeicher dieses einen Worker-Prozesses.
- `apps/worker/node_modules/@hatchet-dev/typescript-sdk@1.28.1` (`v1/declaration.d.ts:126-135,354`, `v1/client/features/crons.d.ts`) — Hatchet unterstützt native, **deklarative** Cron-Konfiguration direkt an einer Workflow-Definition (`onCrons: string[]`, Alias `on: { cron: ... }`) sowie einen eigenständigen `CronClient` (`client.crons`) für die imperative Variante. `onCrons` liegt auf `CreateBaseWorkflowOpts` (workflow-level), nicht auf der Kurzform `client.task(...)` (task-level) — ein Recovery-Scan braucht deshalb `client.workflow({ name, onCrons })` statt der im bestehenden Code genutzten `client.task(...)`-Kurzform.
- `apps/api/src/app.ts:1489-1500` (`GET /v1/text-workshop/sessions/:id`) selektiert nur `id, status, generated_content, quality_flags, failure_code, accepted_post_version_id, created_at` — weder `generation_intent` noch Provenienzfelder. `quality_flags` wird selektiert, aber von keinem Code je befüllt (Grep über `apps/worker`, `apps/api`: kein Schreibzugriff).
- `apps/web/app/pages/erstellen.vue:6,53-58,98` — `Candidate`-Typ kennt kein Provenienz-/Auslöser-Feld; Status-Update ausschließlich über einen manuellen „Aktualisieren"-Button, kein Auto-Refresh.
- `plans/021-abomodelle-und-speicherkontingent.md:277-280` — dokumentiert bereits, dass Speicher „die falsche Metrik für die Belastung" ist und LLM-Aufrufe der teuerste, noch ungemessene Posten sind; ein Kontingent für Generierungsversuche ist dort explizit als künftiger Schritt angekündigt, nicht Teil dieses Plans.

## Entscheidungen (mit dem Nutzer abgestimmt, 2026-08-12)

Die fünf in der ursprünglichen Skizze offen gelassenen Architektur-/Produktentscheidungen sind geklärt:

1. **Trigger-Ort**: ein eigener, bei Hatchet **deklarativ per `onCrons` registrierter Workflow** — nicht ein `setInterval` im Worker-Prozess, nicht eine Erweiterung des bestehenden 1s-Outbox-Dispatchers. Begründung: der Schedule lebt in Hatchets eigenem, persistentem Scheduler, nicht im Speicher eines einzelnen Worker-Prozesses — ein Neustart oder Redeploy des Workers verliert ihn nicht (anders als ein bare `setInterval`, worauf der Nutzer explizit hinwies). Das entspricht zugleich dem in `plans/README.md` (Zielbild) festgehaltenen Architekturprinzip: „Hatchet ist die einzige technische Workflow- und Zeitplan-Engine."
2. **Fencing-Token**: neue Spalte `generation_candidates.generation_lease_token` (uuid), analog zum bereits etablierten und pgTAP-getesteten Muster `workflow_runs.worker_lease_token`. Schließt die Lücke, dass ein verspätet schreibender, veralteter Worker nach einer Reeroberung durch einen anderen Worker dessen laufenden Versuch unbemerkt überschreiben kann.
3. **Kontingent**: **nicht Teil dieses Plans.** Der Nutzer hat ein vollständiges Token-Budget-Modell beschrieben (monatliches Kontingent je Verein nach Tarif, delegierbar an Abteilungen/Teams, hartes Limit je Anfrage) — das ist exakt die in Paket 021 bereits als offen dokumentierte Lücke (siehe „Current state" oben). Dieser Plan fügt keine Kontingentprüfung ein; ein automatischer Recovery-Versuch zählt vorerst gegen kein Kontingent, weil es aktuell keines gibt. Sobald Paket 021 um Generierungs-/Token-Kontingente erweitert wird, muss diese Erweiterung entscheiden, ob ein automatischer Recovery-Versuch mitzählt.
4. **Sichtbarkeit**: neues, explizites Feld `generation_candidates.triggered_by` (`'member' | 'automatic_recovery'`), keine Zweckentfremdung von `quality_flags`.
5. **Obergrenze**: neue Zählspalte `composition_sessions.candidate_count` mit CHECK-Constraint, atomar hochgezählt in `create_text_generation_session` — gilt hart für jeden Aufrufer (manuelle Überarbeitung und automatischer Recovery-Trigger gleichermaßen), nicht nur eine anwendungsseitige Zählung im Recovery-Trigger selbst.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit-Tests betroffener Pakete | `pnpm --filter @vereinsfunk/worker --filter @vereinsfunk/api --filter @vereinsfunk/contracts test` | exit 0 |
| Typecheck | `pnpm --filter @vereinsfunk/worker --filter @vereinsfunk/api --filter @vereinsfunk/web typecheck` | exit 0 |
| DB-Reset + pgTAP | `pnpm db:reset && pnpm db:test` | exit 0, neue Fencing-/Obergrenze-/Recovery-Tests bestehen |
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |

## Scope

**In scope**

- Zwei additive Migrationen: (a) `generation_lease_token` auf `generation_candidates` plus geänderte Signaturen von `acquire_generation_candidate`/`mark_generation_candidate_ready`/`mark_generation_candidate_failed`/`release_generation_candidate`; (b) `triggered_by` auf `generation_candidates` und `candidate_count` auf `composition_sessions`, plus erweiterte `create_text_generation_session`-Signatur.
- Neue SQL-Funktion `claim_stalled_generation_candidates` (bulk, `for update skip locked`, analog `claim_workflow_outbox`).
- Neuer, eigenständiger Hatchet-Workflow `generation-recovery-scan` (`apps/worker/src/generationRecovery.ts`), deklarativ cron-geplant, registriert neben den bestehenden generischen Workflows in `createHatchetWorker`.
- `apps/worker/src/context.ts`, `apps/worker/src/textGeneration.ts`: Lease-Token durch `acquirePendingCandidate`/`markReady`/`markFailed`/`releaseCandidate` durchreichen.
- `apps/api/src/app.ts` (`GET /v1/text-workshop/sessions/:id`): `triggered_by` in die Antwort aufnehmen.
- `apps/web/app/pages/erstellen.vue`: `triggered_by` anzeigen.
- `plans/README.md`, `docs/operations/hatchet.md`: Status-/Betriebsdokumentation.

**Out of scope**

- Jedes Kontingent-/Token-Budget-System (Entscheidung 3 — gehört zu einer künftigen Erweiterung von Paket 021).
- Provider-seitige Idempotenz-Schlüssel gegen einen tatsächlich doppelt abgerechneten LLM-Aufruf (bereits in Plan 034 als bewusst zurückgestellt dokumentiert, unverändert).
- Jede Änderung an Bild-/Video-Generierung.
- Eine UI, die einem Mitglied die verbleibenden Versuche vor Erreichen der Obergrenze anzeigt — die bestehende generische Fehlermeldung bei `status = 'failed'` (`erstellen.vue:98`) deckt den Fall bereits ab.

## Steps

### Step 1: Fencing-Token gegen einen veralteten Worker

Migration: `alter table public.generation_candidates add column generation_lease_token uuid;` (nullable — nur `generating`-Zeilen tragen einen aktiven Token).

`acquire_generation_candidate` (beide `UPDATE`-Zweige: frische `pending`-Zeile und 15-Minuten-Rückfall) setzt zusätzlich `generation_lease_token = gen_random_uuid()` und gibt ihn im `jsonb`-Ergebnis als `lease_token` zurück.

`mark_generation_candidate_ready`, `mark_generation_candidate_failed`, `release_generation_candidate` bekommen je einen neuen Parameter `p_lease_token uuid` und prüfen zusätzlich `and generation_lease_token = p_lease_token` in ihrer `WHERE`-Klausel. Ein durch Fencing verhinderter Schreibversuch löst dieselbe, bereits vorhandene `raise exception '..._update_lost'` aus wie ein Statuswechsel, der das Update sonst verpasst hätte — keine neue Exception-Klasse nötig, nur eine strengere `WHERE`-Bedingung.

`apps/worker/src/textGeneration.ts`: `CandidateRow` bekommt `lease_token: string`; `TextGenerationRepository`s `markReady`/`markFailed`/`releaseCandidate` bekommen je einen `leaseToken: string`-Parameter. `TextGenerationExecutor.execute()` reicht `candidate.lease_token` an alle drei Aufrufe weiter (aktuell `apps/worker/src/textGeneration.ts:77,80-81`, kein Token vorhanden).

`apps/worker/src/context.ts`: `CandidateRowSchema` erweitern; `markReady`/`markFailed`/`releaseCandidate` reichen `leaseToken` als `p_lease_token` an die jeweilige RPC weiter.

**Verify**: neue pgTAP-Assertionen in `supabase/tests/text_workshop_foundation.test.sql` — (a) ein Kandidat wird akquiriert (Token T1), künstlich als über 15 Minuten hängend zurückgesetzt, erneut akquiriert (Token T2 ≠ T1); ein `mark_generation_candidate_ready`-Aufruf mit T1 aktualisiert keine Zeile (Exception), derselbe Aufruf mit T2 gelingt. (b) Bestehende Tests, die `mark_generation_candidate_ready`/`_failed`/`release_generation_candidate` ohne Token aufrufen, auf die neue Signatur umstellen. `apps/worker/src/textGeneration.test.ts` entsprechend erweitern. `pnpm db:reset && pnpm db:test`, `pnpm --filter @vereinsfunk/worker test`.

### Step 2: Sichtbares Auslöser-Feld

Migration: `alter table public.generation_candidates add column triggered_by text not null default 'member' check (triggered_by in ('member', 'automatic_recovery'));`.

`create_text_generation_session`: neuer Parameter `p_triggered_by text default 'member'`, in die `insert into generation_candidates (...)` aufgenommen. Bestehende Aufrufer (`POST /v1/text-workshop/sessions`, `POST /v1/text-workshop/sessions/:id/generations`) ändern sich nicht — der Default greift.

`apps/api/src/app.ts:1497` (`GET /v1/text-workshop/sessions/:id`): `triggered_by` in die `select(...)`-Liste aufnehmen.

`apps/web/app/pages/erstellen.vue`: `Candidate`-Typ (Zeile 6) und das Zod-Schema in `refreshSession()` (Zeile 55) um `triggered_by: z.enum(['member', 'automatic_recovery'])` erweitern; im Template (Zeile 98) bei `triggered_by === 'automatic_recovery'` einen Hinweis anzeigen, z. B. „Diese Version wurde nach einem technischen Fehler automatisch neu erzeugt."

**Verify**: pgTAP prüft Default `'member'` für bestehende Pfade und ein direktes `'automatic_recovery'`-Insert. Browser-Check über die `run-web`-Skill: eine manuell auf `triggered_by = 'automatic_recovery'` gesetzte Testzeile zeigt den Hinweis in der Textwerkstatt-UI.

### Step 3: Obergrenze für Generierungsversuche je Sitzung

Migration: `alter table public.composition_sessions add column candidate_count integer not null default 1;` (der erste Kandidat einer neuen Sitzung ist bereits mitgezählt). Der konkrete Grenzwert (unten `8`) ist ein **Platzhalter ohne Kalkulation**, analog zu den in `plans/021-abomodelle-und-speicherkontingent.md:277` offen benannten Preis-Platzhaltern — vor Produktivbetrieb mit dem Nutzer zu bestätigen oder anzupassen.

`create_text_generation_session`: im „gefunden"-Zweig (bestehende Sitzung, `p_generation_intent = 'revise'` oder ein automatischer Recovery-Versuch) vor dem Einfügen des neuen Kandidaten prüfen: `if session_row.candidate_count >= 8 then raise exception 'composition_session_candidate_limit_reached'; end if;`. Die begleitende `update composition_sessions set status = 'queued', ...` (Zeile 57 im Original) erweitert sich um `candidate_count = candidate_count + 1`. Der „nicht gefunden"-Zweig (neue Sitzung) bleibt unverändert — `candidate_count` startet am Spalten-Default `1`.

**Verify**: pgTAP — acht aufeinanderfolgende `create_text_generation_session`-Aufrufe mit `p_generation_intent = 'revise'` auf derselben Sitzung gelingen, der neunte wirft `composition_session_candidate_limit_reached`; `candidate_count` entspricht der tatsächlichen Zeilenzahl in `generation_candidates`.

### Step 4: `generation-recovery-scan` — eigener, cron-geplanter Hatchet-Workflow

Neue SQL-Funktion `claim_stalled_generation_candidates(p_limit integer default 20)`, analog `claim_workflow_outbox` (`supabase/migrations/2026081101_workflow_outbox_dispatch.sql:22-30`): claimt bis zu `p_limit` Zeilen aus `generation_candidates` mit `status = 'generating' and updated_at < now() - interval '15 minutes'` per `for update skip locked`, setzt sie atomar auf `status = 'failed', failure_code = 'stalled_after_crash', generation_lease_token = null` und gibt `id, composition_session_id, organization_id, generation_intent, revision_instruction` zurück. Diese eine `UPDATE ... RETURNING`-Anweisung ist bereits gegen mehrere gleichzeitig laufende Worker-Replikas sicher (kein zusätzlicher Aufruf von `acquire_generation_candidate` nötig — der Scan reerobert keine `generating`-Zeile, er beendet sie direkt terminal).

Neue Datei `apps/worker/src/generationRecovery.ts`: `scanAndRecoverStaleCandidates()` ruft `claim_stalled_generation_candidates` wiederholt auf (bis eine leere Seite zurückkommt oder eine Sicherheitsobergrenze an Iterationen erreicht ist). Für jede zurückgegebene Zeile: die zugehörige `composition_sessions`-Zeile laden (`organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot, source_revision, input_hash, created_by` — dieselben Felder, die `POST /v1/text-workshop/sessions/:id/generations` bereits liest, `apps/api/src/app.ts:1507-1511`), dann `create_text_generation_session` aufrufen mit denselben Werten plus `p_generation_intent`/`p_revision_instruction` der soeben beendeten Kandidatenzeile (nicht `'revise'` fest verdrahtet — ein hängender `'initial'`-Versuch wird als `'initial'`-Versuch wiederholt), `p_candidate_input_hash = sha256(staleCandidateId || ':recovery')` (deterministisch, garantiert verschieden vom Hash des beendeten Versuchs, damit `create_text_generation_session`s Dedup-Zweig nicht die soeben beendete Zeile zurückgibt), `p_created_by` aus der Sitzung (Provenienz zeigt weiterhin auf ein echtes Mitglied), `p_triggered_by = 'automatic_recovery'`, frische `p_correlation_id`/`p_idempotency_key`. Wirft dieser Aufruf `composition_session_candidate_limit_reached` (Step 3), wird das geloggt und **nicht** erneut versucht — die Sitzung bleibt in ihrem bereits durch den Scan gesetzten `failed`-Zustand, sichtbar für ein Mitglied über die bestehende Fehlermeldung.

Registrierung: `client.workflow({ name: 'generation-recovery-scan', onCrons: ['*/5 * * * *'] })` mit einer einzelnen Task, die `scanAndRecoverStaleCandidates()` aufruft, `input`-Typ `z.object({})` (kein `entityId` — dieser Workflow ist bewusst **nicht** Teil von `WorkflowNameSchema`/`createWorkflowDefinitions`s generischer Pro-Entity-Schleife, da er selbst keine fachliche Pro-Entity-Aktion ausführt, sondern nur hängende Zeilen erkennt und über den gewöhnlichen, bereits abgesicherten Pro-Entity-Pfad (`workflow_outbox` → `generate-text-post`) einen neuen Versuch anstößt). In `createHatchetWorker` (`apps/worker/src/workflows.ts:88-103`) zum bestehenden `worker.registerWorkflows([...])`-Array hinzufügen. Kein `workflow_runs`/`workflow_outbox`-Eintrag für diesen Workflow selbst — er braucht keine Lease-Buchhaltung, weil jeder einzelne Tick bereits durch `claim_stalled_generation_candidates`s `skip locked`-Semantik gegen gleichzeitige oder wiederholte Ausführung sicher ist; das im Code kommentieren, damit ein künftiger Leser das Fehlen von `runs.begin/succeed/fail` nicht für ein Versehen hält.

Der 5-Minuten-Cron-Takt ist ein einstellbarer Parameter, kein Korrektheitserfordernis: er bestimmt nur, wie lange ein hängender Kandidat zusätzlich zur 15-Minuten-Schwelle im schlimmsten Fall wartet (hier: bis zu 5 zusätzliche Minuten), nicht ob die Wiederherstellung überhaupt stattfindet.

**Verify**: neuer `apps/worker/src/generationRecovery.test.ts` mit einer Fake-Repository-Implementierung — ein seit über 15 Minuten hängender Kandidat wird beendet und ein neuer, `triggered_by = 'automatic_recovery'`-Kandidat mit demselben `generation_intent`/`revision_instruction` entsteht; ein frischer `generating`-Kandidat bleibt unberührt; eine Sitzung am `candidate_count`-Limit erzeugt keinen neuen Kandidaten und wirft keinen unbehandelten Fehler. Neue pgTAP-Assertionen für `claim_stalled_generation_candidates` (Staleness-Filter, `skip locked`-Verhalten bei simulierter Nebenläufigkeit über zwei Transaktionen). `pnpm --filter @vereinsfunk/worker test`, `pnpm db:reset && pnpm db:test`.

### Step 5: Dokumentation und Plan-Index aktualisieren

`plans/README.md`: Zeile zu 035 in der Tabelle „Vierte Serie" ergänzen (Abhängigkeit: 034). `docs/operations/hatchet.md`: neuer Abschnitt zum cron-geplanten `generation-recovery-scan`-Workflow — Name, Kadenz, und wie er im Betrieb pausiert/gelöscht wird (`client.crons.list`/`client.crons.delete`, falls er versehentlich zu aggressiv reerobert).

**Verify**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, danach `pnpm db:reset && pnpm db:test`.

## Bewusst nicht gebaut

- **Kontingent-/Token-Budget-System.** Siehe Entscheidung 3 — gehört zu einer künftigen Erweiterung von Paket 021, nicht zu diesem Plan.
- **Provider-seitige Idempotenz gegen doppelt abgerechnete LLM-Aufrufe.** Unverändert aus Plan 034 zurückgestellt; ein automatischer Recovery-Versuch erzeugt denselben theoretischen Doppelaufruf-Fall wie ein manueller.
- **UI-Anzeige verbleibender Versuche vor Erreichen der Obergrenze.** Die bestehende generische Fehlermeldung bei `status = 'failed'` deckt den Fall ab; eine differenziertere Anzeige ist eine spätere UX-Verbesserung, kein Korrektheitserfordernis.

## Done criteria

- [x] `generation_candidates.generation_lease_token` existiert; `acquire_generation_candidate`/`mark_generation_candidate_ready`/`mark_generation_candidate_failed`/`release_generation_candidate` sind fenced (pgTAP-getestet: ein veralteter Token aktualisiert keine Zeile).
- [x] `generation_candidates.triggered_by` existiert, Default `'member'`, `create_text_generation_session` akzeptiert `p_triggered_by`; die Textwerkstatt-UI zeigt einen sichtbaren Hinweis bei `'automatic_recovery'`.
- [x] `composition_sessions.candidate_count` existiert, wird in `create_text_generation_session` atomar hochgezählt, eine Obergrenze wird per klar benannter Exception durchgesetzt.
- [x] `claim_stalled_generation_candidates` existiert und ist gegen gleichzeitige Aufrufer sicher (pgTAP).
- [x] `generation-recovery-scan` ist als eigener, deklarativ per `onCrons` geplanter Hatchet-Workflow registriert, unabhängig von `WorkflowNameSchema`s Pro-Entity-Schleife, und erzeugt für einen hängenden Kandidaten zuverlässig einen neuen, als `automatic_recovery` gekennzeichneten Versuch mit demselben `generation_intent`. **Abweichung von der Ausplanung**: registriert über die bestehende `client.task(...)`-Kurzform (nicht `client.workflow(...)`) — `onCrons` liegt auf `CreateBaseWorkflowOpts`, das in `CreateTaskWorkflowOpts` enthalten ist; per `tsc` verifiziert.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test` bestehen vollständig.

## STOP conditions

- Das selbst gehostete Hatchet in `infrastructure/hatchet/docker-compose.yml` unterstützt `onCrons`/`client.crons` in der dort gepinnten Server-Version nicht (SDK- und Server-Version können auseinanderlaufen) — dann vor Step 4 klären, ob ein Server-Upgrade nötig ist oder die imperative `client.crons.create(...)`-Variante (mit eigener Idempotenz-Prüfung beim Worker-Start) verwendet werden muss.
- Mehrere Worker-Replikas registrieren beim Start jeweils denselben `onCrons`-Workflow und Hatchet dedupliziert das nicht wie erwartet (mehrere gleichzeitig gefeuerte Ticks wären durch `claim_stalled_generation_candidates`s `skip locked` zwar unschädlich, aber unnötig) — vor Produktivbetrieb mit mehreren Replikas verifizieren, nicht annehmen.
- Der `candidate_count`-Grenzwert (`8`, Platzhalter) erweist sich als zu knapp für legitime Mehrfach-Überarbeitungen eines Mitglieds — dann mit dem Nutzer neu kalibrieren, nicht einseitig ändern.

## Maintenance notes

Jeder künftige, `generation_candidates` schreibende Aufrufer muss den Lease-Token respektieren (Step 1) und `candidate_count` korrekt mitführen (Step 3) — beides gilt nicht nur für den in diesem Plan gebauten Recovery-Trigger. Sobald Paket 021 um Generierungs-/Token-Kontingente erweitert wird, ist zu entscheiden, ob ein `triggered_by = 'automatic_recovery'`-Versuch dagegen zählt (siehe Entscheidung 3).
