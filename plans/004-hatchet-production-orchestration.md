# 004 – Hatchet produktionsreif integrieren

> **Status-Nachtrag (2026-08-08, vor Paket 025 verifiziert)**: `@hatchet-dev/typescript-sdk` ist real als Abhängigkeit eingebunden, `apps/worker/src/workflows.ts` importierte echte SDK-Symbole und registrierte Fairness/Concurrency für einen einzigen Workflow (`process-submission`) — `apps/worker/src/index.ts` rief den Worker aber nie tatsächlich auf, der Prozess war nur ein Logger-Scaffold. `packages/orchestration` hatte nur `FakeOrchestrator` (In-Memory-Map), kein `createHatchetClient`/keine echte `HatchetOrchestrator`-Implementierung. **Mit Paket 025 wurde selbst dieser eine Trigger entfernt**: die Entwurfserzeugung läuft jetzt synchron in `POST /v1/submissions`, ein Aufruf ohne laufenden Worker dahinter wäre irreführend gewesen. `workflow_outbox`/`workflow_runs` existieren als Tabellen, werden aber von keinem Code referenziert. Dieser Plan bleibt vollständig offen — Hatchet ist im Projekt aktuell nirgends produktiv im Einsatz.

## Ergebnis

Der bisherige Workflow-Stub wird durch den echten Hatchet-TypeScript-SDK ersetzt. Hatchet übernimmt Ausführung, Retries, Zeitplanung, Abbruch und faire Verteilung; Supabase bleibt alleinige fachliche Source of Truth. Ein Prozessneustart oder doppelter Trigger erzeugt weder doppelte Versionen noch doppelte Veröffentlichungen.

## Ausgangslage und Evidenz

Geplant auf `unborn HEAD` am 2026-08-02.

- `apps/worker/src/workflows.ts:11-32` definiert einen lokalen `WorkflowContext`, aber registriert keinen Hatchet-Worker.
- `apps/worker/package.json` enthält keine Hatchet-Abhängigkeit.
- `apps/worker/src/workflows.ts:4-9` hat Concurrency-Werte als Konstanten; der Produktplan bezeichnet sie dagegen als Konfiguration.
- `apps/worker/src/workflows.ts:38-40` erzeugt bereits den Fairness-Key `organizationId:departmentId`.
- ADR-002 schreibt IDs-only Payloads und Supabase als fachliche Source of Truth fest.
- Die aktuelle Hatchet-Dokumentation bestätigt für TypeScript Group Round Robin, mehrere Concurrency-Regeln, Scheduled Runs, Retries, Cancellation und Idempotency. Am 2026-08-02 war `@hatchet-dev/typescript-sdk` 1.28.0 aktuell; der Executor muss die Version erneut prüfen und exakt pinnen.

Baseline:

```text
b2990427ebcb00454cdf90db26c1b3839b126840e2cda5008df4028197177302  apps/worker/src/workflows.ts
579b98597a3207941a121ed8202a98c73db0945b666a94974a351403b1bf8f1d  apps/api/src/app.ts
2b3384e745ccacbe2c19b5548f5e3735679b3b2058b091f2f8f6d42214891c52  packages/contracts/src/index.ts
84e7e479cd81a647978952d3d5046f83bc6f888d07f2b7ea9680b264d05da355  packages/domain/src/index.ts
```

Primärquellen:

- https://docs.hatchet.run/v1/concurrency
- https://docs.hatchet.run/v1/scheduled-runs
- https://docs.hatchet.run/v1/retries
- https://docs.hatchet.run/v1/idempotency
- https://www.npmjs.com/package/@hatchet-dev/typescript-sdk

## Scope

- echtes Hatchet SDK und Client-/Worker-Factory
- ID-basierte Workflowverträge
- Supabase-Mapping für Runs, Zeitpläne und technische Fehler
- Workflows `process-submission`, `anonymize-media`, `render-content`, `apply-revision`, `publish-content`, `collect-analytics`
- Fairness, Concurrency, Retry-/Fehlerklassen, Cancellation/Reschedule
- lokale Integrationsumgebung, Tests, Telemetrie und Runbook

Nicht enthalten: Fachimplementierung der einzelnen Adapter (Pläne 003, 005, 006), Hatchet als fachliche Datenbank oder langlebiges Warten auf menschliche Freigaben.

## Umsetzung

### 1. Verbindlicher SDK-Spike

- Pinne eine konkrete SDK-Version in `apps/worker/package.json` und nutze dieselbe Version in API/Orchestrierungs-Paket, falls dort Triggercode liegt.
- Baue mit einer lokalen Hatchet-Instanz einen minimalen Workflow, der Zod-validierte IDs annimmt, eine Supabase-Testzeile liest und einen Status schreibt.
- Weise in automatisierten oder reproduzierbaren Tests nach: Retry, non-retryable Fehler, zukünftiger Zeitplan, Cancel/Reschedule, Neustart während Ausführung, doppelter idempotenter Trigger und Group Round Robin für mindestens drei Gruppen.
- Dokumentiere echte SDK-Aufrufe, Version und Resultate in `docs/evidence/hatchet-spike.md`; aktualisiere ADR-002 von „Spike“ auf „angenommen“ oder stoppe mit Alternativbewertung.

Exit-Kriterium: Die obigen Fälle funktionieren mit TypeScript. Fehlt eine Kernfunktion, darf sie nur durch Supabase-Outbox/Idempotenz ergänzt werden, nicht durch eine zweite Workflow-Engine.

### 2. Orchestrierungsgrenze

- Erzeuge `packages/orchestration/` mit `createHatchetClient`, Trigger-Use-Cases und einem Fake für Tests.
- Fastify darf Workflows triggern, aber nicht selbst lange Tasks ausführen. Der Worker registriert Workflows und Tasks.
- Alle Inputs werden vor Registrierung und am Handler-Eingang mit Zod geprüft:

```ts
type WorkflowPayload = {
  organizationId: string
  departmentId: string
  entityId: string
  sourceRevision: number
  correlationId: string
  idempotencyKey: string
}
```

- Keine Captions, Bilder, Provider-Tokens oder vollständigen Datensätze in Hatchet Input/Output. Jeder Task lädt aktuellen Zustand anhand der IDs und prüft Tenant plus Revision.
- Der Client ist über Dependency Injection austauschbar; Tests starten nicht implizit externe Worker.

### 3. Fachzustand, Outbox und Run-Mapping

- Ergänze additiv `workflow_runs` mit Tenant, Workflowname, Entity/Revision, Hatchet Run ID, technischem Status, Versuch, Fehlerklasse, Correlation ID und Zeitstempeln.
- Nutze eine transaktionale `workflow_outbox`: Fachänderung und auszulösender Event werden atomar gespeichert. Ein Dispatcher triggert Hatchet idempotent und markiert die Outbox erst nach bestätigter Annahme.
- Unique-Key: `(organization_id, workflow_name, entity_id, source_revision, purpose)`.
- Hatchet-Erfolg darf keinen veralteten Fachzustand überschreiben. Updates verwenden Compare-and-Set auf erwartete Revision/Status.
- Reconcile-Job findet steckengebliebene Outbox-/Run-Einträge und vergleicht sie mit Hatchet, ohne die Workflow-Historie zur fachlichen Wahrheit zu machen.

### 4. Workflow-DAGs

- `process-submission`: Payload/Revision prüfen → Grounded Brief → neue immutable Post-Version → Variantenaufträge.
- `anonymize-media`: Asset laden → normalisieren/detektieren → auf menschliche Entscheidung fachlich enden; nach Entscheidung separater Derivat-Trigger. Kein Hatchet-Task wartet tagelang auf Nutzer.
- `render-content`: freigegebene Inputs prüfen → Render starten/pollen → Output validieren → Derivat speichern.
- `apply-revision`: neue Post-Version atomar anlegen → nur betroffene Texte/Assets invalidieren → neue Freigabe.
- `publish-content`: zur Laufzeit Freigabe/Hashes/Verbindung erneut prüfen → Provider einmalig aufrufen/reconciliieren → Status speichern.
- `collect-analytics`: erst nach dem Pilot-Publishing aktivieren; Fenster idempotent messen.

Taskhandler sind dünn und rufen unabhängig testbare Use-Cases auf. Ein Workflow startet nicht automatisch den nächsten fachlichen Schritt, wenn Benutzeraktion/Freigabe fehlt.

### 5. Fairness und Ressourcenschutz

- Konfiguriere Group Round Robin mit dem Key aus Organisation und Abteilung; ergänze eine zweite Grenze pro Organisation und eine globale Grenze pro Ressourcenklasse.
- Überführe Startwerte aus `concurrency` in validierte Umgebungs-/Tenantkonfiguration.
- Separate Worker-/Task-Slots für `llm`, `image`, `video`, `publishing`; Publishing erhält zusätzlich providerbezogene Rate Limits.
- Priorität bleibt 10–100 im Fachmodell, wird aber auf Hatchets unterstützte Prioritätsstufen explizit gemappt. Dokumentiere Informationsverlust.
- Teste, dass eine volle Abteilung B und C nicht aushungert.

Beispiel, an die tatsächlich gepinnte SDK-Syntax anzupassen:

```ts
concurrency: [
  { expression: "input.organizationId + ':' + input.departmentId", maxRuns: 1,
    limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
  { expression: 'input.organizationId', maxRuns: 4,
    limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
]
```

### 6. Retry, Cancel und Zeitplanung

- Klassifiziere Fehler: validation/authorization/consent = non-retryable; Netzwerk/5xx = begrenzt exponentiell; 429 = `Retry-After`; unknown external result = reconcile statt publish-retry.
- Geplante Veröffentlichung besitzt eine `schedule_revision` und Hatchet Run ID. Umplanung storniert den alten Run, erhöht Revision und legt idempotent einen neuen an.
- Unmittelbar vor Provider-I/O prüft `publish-content` erneut Revision, Zeitpunkt, Freigabe und Cancellation-Flag. So ist ein Race beim Cancel sicher.
- Timeouts und maximale Versuche sind je Ressourcenklasse konfiguriert. Dead-letter bedeutet fachlich `action_required`, Audit-Event und Alarm, nicht stilles `failed`.

### 7. Betrieb und Beobachtbarkeit

- Strukturierte Logs enthalten correlation/run/entity/org/department IDs, aber keine Inhalte/Tokens.
- OpenTelemetry-Spans verbinden API → Outbox → Hatchet → Adapter; Fehlerklasse und Retryzahl werden als kontrollierte Attribute erfasst.
- Healthchecks unterscheiden Prozess lebt, Hatchet erreichbar und Supabase erreichbar.
- Schreibe Runbook für Worker-Neustart, Outbox-Stau, Run-Reconciliation, Safe Replay, Run-Cancel und Credential-Rotation.

## Verifikation

```bash
pnpm --filter @vereinsfunk/orchestration test
pnpm --filter @vereinsfunk/worker test
pnpm --filter @vereinsfunk/api test
pnpm db:reset
pnpm db:test
pnpm check
```

Integrationsszenario: 30 Jobs über drei Abteilungen triggern, Worker während eines Jobs beenden, einen Job umplanen, denselben Trigger zweimal senden und einen Provider-Timeout simulieren. Erwartung: faire Fortschritte, Recovery, genau eine Fachversion und keine zweite externe Aktion.

## Done-Kriterien

- Echter TypeScript-Hatchet-Worker läuft lokal reproduzierbar; Stub ist ersetzt.
- Supabase-Outbox und Run-Mapping verhindern verlorene/doppelte Trigger.
- Scheduling, Cancellation, Restart-Recovery, Retry und Fairness sind nachgewiesen.
- Payloads enthalten ausschließlich IDs/kleine Metadaten; Secrets und Medien bleiben außerhalb Hatchets.
- Runbook, ADR und Spike-Evidence sind aktuell; Workspace-/DB-/Integrationstests grün.

## STOP-Bedingungen

- TypeScript-SDK kann einen Kernfall nicht zuverlässig: Spike dokumentieren und Architekturentscheidung neu treffen, bevor Fachworkflows gebaut werden.
- Hatchet und Supabase schreiben konkurrierend denselben Fachstatus ohne Revision/CAS: Integration stoppen und Ownership korrigieren.
- Ein Replay kann eine externe Aktion wiederholen: Publishing-Workflow nicht aktivieren, bis Reconciliation greift.

## Pflegehinweis

SDK-Updates nur geplant und mit dem Spike-Testset. Monatlich Dead-letter, Queue-Latenz, Fairness und doppelte/idempotent abgefangene Trigger prüfen; Concurrency erst aus Messdaten ändern.
