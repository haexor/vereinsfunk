# Plan 035 (Skizze): Von Hatchets Wiederholungsbudget unabhängiger Recovery-Trigger für hängende Textgenerierungs-Kandidaten

> **Status: Skizze, nicht ausgearbeitet.** Entstanden als Folge-Fund während der Umsetzung von Plan 034. Vor der Umsetzung vollständig ausplanen (Current state, Steps, Verify je Schritt) — dieses Dokument benennt nur Problem, Zielrichtung und die offenen Entscheidungen.

## Why this matters

Plan 034, Schritt 3, gibt `acquire_generation_candidate` einen Lease-Rückfall: ein Kandidat, der seit über 15 Minuten auf `generating` hängt, lässt sich erneut erobern. Dieser Rückfall kann in der Praxis nach einem echten Worker-Absturz nie greifen, weil er nur beim nächsten *Aufruf* der Funktion geprüft wird — und der einzige Aufrufer ist `TextGenerationExecutor.execute()`, ausgelöst durch einen Hatchet-Workflow-Versuch (`apps/worker/src/workflows.ts`).

Hatchets eigenes Wiederholungsbudget (`retries: 3`, `backoff: { factor: 2, maxSeconds: 60 }`, `executionTimeout: '10m'`) ist strukturell immer vor der 15-Minuten-Schwelle aufgebraucht: der erste Wiederholungsversuch kommt nach `executionTimeout` (10 Minuten), jeder weitere binnen Sekunden bis maximal 60 Sekunden Backoff — nicht nach einem weiteren vollen Timeout. Nach drei Versuchen gibt Hatchet den Workflow-Run endgültig auf (`technical_status = 'failed'` bzw. `'action_required'`), und nichts im System sendet einen so beendeten Run je erneut an Hatchet (bestätigt durch Code-Suche über `apps/worker/`, `apps/api/`, die Outbox-Dispatch-Migrationen und `docs/operations/hatchet.md`).

Ein höherer `executionTimeout`-Wert löst das nicht: die 15-Minuten-Schwelle muss aus Sicherheitsgründen über `executionTimeout` bleiben (sonst überschreibt ein neuer Versuch einen noch legitim laufenden), aber jeder Versuch nach dem ersten kommt strukturell viel früher als ein weiterer `executionTimeout`-Zyklus. Es gibt keine Kombination der vier Werte, die beide Anforderungen gleichzeitig erfüllt — der Fehler liegt im Design („Selbstheilung ausschließlich über den nächsten Hatchet-Versuch"), nicht in der Kalibrierung.

Ohne diesen Plan bleibt ein nach echtem Worker-Absturz hängender Kandidat für die betroffenen Vereinsmitglieder dauerhaft auf „wird generiert" stehen — das ursprünglich in Plan 034 („Why this matters") beschriebene Symptom ist nach Plan 034 zwar *sichtbarer* (der Workflow-Run landet ehrlich auf `failed` statt fälschlich `succeeded`), aber nicht *behoben*.

## Zielrichtung (nicht verbindlich, zur Diskussion)

Statt den bestehenden, endgültig aufgegebenen Workflow-Run wiederzubeleben (verworfen — siehe unten), folgt der naheliegende Weg dem bereits bestehenden Muster für einen nicht wiederholbaren Fehler, dokumentiert in `docs/operations/hatchet.md`: „einen neuen fachlich versionierten Auftrag auslösen". Das ist exakt der Weg, den eine manuelle Revision heute schon geht (`create_text_generation_session` mit neuem `generation_intent`, neuer `candidateId`, neuer `purpose`, neuem `idempotencyKey`).

Ein zeitgesteuerter Trigger (piggybacked auf den bestehenden 1s-Outbox-Poller in `apps/worker/src/index.ts`, `WorkflowOutboxDispatcher`, `packages/orchestration/src/index.ts`, oder ein eigener, ähnlich einfacher Intervall) könnte:

1. `generation_candidates`-Zeilen mit `status = 'generating' and updated_at < schwelle` finden.
2. Den alten Kandidaten sauber auf `failed` setzen (nicht einfach ignorieren — sonst zwei Kandidaten gleichzeitig für dieselbe Sitzung offen).
3. Für dieselbe `composition_session_id` einen frischen Generierungsversuch auslösen — vermutlich über denselben Weg wie `create_text_generation_session`, ggf. mit einem eigenen `generation_intent`-Wert oder einem Kennzeichen, dass es sich um eine automatische Wiederherstellung handelt (Provenienz/Auditierbarkeit: ein Mitglied sollte im Zweifel erkennen können, dass ein Ergebnis nach einem Absturz automatisch neu generiert wurde, nicht manuell angestoßen).

## Offene Entscheidungen (vor Ausarbeitung zu klären)

- **Wo lebt der Trigger?** Erweiterung des bestehenden Outbox-Pollers vs. ein eigener, unabhängiger Intervall. Der Poller läuft aktuell alle 1s und ist für Dispatch, nicht für Bestandsaufnahme über `generation_candidates` ausgelegt — eine zu häufige Prüfung wäre unnötige Last, eine zu seltene verzögert die Wiederherstellung unnötig.
- **Fencing gegen einen verspätet antwortenden alten Worker.** Sobald ein automatischer Trigger unabhängig von Hatchets Versuchszählung neue Versuche auslösen kann, wird die in Plan 034 als „bewusst zurückgestellt" markierte Fencing-Lücke (kein Schutz gegen einen veralteten Worker, der nach der Wiedereroberung noch ein Ergebnis schreibt) relevanter als zuvor — dieser Plan sollte sie mitlösen, nicht erneut zurückstellen. Ob das eine neue Spalte (Lease-Token auf `generation_candidates`) erfordert, ist eine explizite Entscheidung, keine stille Annahme.
- **Quoten-/Ratenlimit-Interaktion.** Ein automatisch ausgelöster Generierungsversuch verbraucht möglicherweise dasselbe Kontingent wie ein von einem Mitglied angestoßener (Paket 011). Ob ein automatischer Wiederherstellungsversuch gegen dasselbe Kontingent zählen soll, ist eine Produktentscheidung, keine rein technische.
- **Sichtbarkeit für Mitglieder.** Soll ein Mitglied erkennen können, dass eine Generierung nach einem Absturz automatisch neu versucht wurde (z. B. über `provider_parameter_hash`/Provenienz oder einen sichtbaren Hinweis in der Textwerkstatt-UI)?
- **Obergrenze für Wiederholungsversuche.** Ein automatischer Trigger ohne eigene Zählung könnte einen strukturell immer scheiternden Fall (z. B. dauerhaft falsch konfigurierter Provider — eigentlich schon durch Plan 034 als `provider_configuration`/nicht-wiederholbar abgefangen, aber zur Sicherheit gegenzuprüfen) endlos neu versuchen. Braucht es eine Gesamtzahl-Obergrenze pro `composition_session`?

## Verworfen

- **Denselben `workflow_outbox`/`workflow_runs`-Eintrag wiederbeleben** (z. B. `workflow_outbox.status` von `dispatched` zurück auf `pending` setzen). Verworfen, weil `dispatched` als einmaliger, dauerhafter Zustand konzipiert ist, und weil Hatchets eigene `idempotency`-Konfiguration (`strategy: 'status', expression: 'input.idempotencyKey', fallbackTtlMs: 86_400_000`) eine erneute Zustellung mit demselben `idempotencyKey` bis zu 24 Stunden lang unterdrücken würde, ohne tatsächlich neu auszuführen.

## Depends on

034 (muss vollständig umgesetzt sein — dieser Plan baut auf `acquire_generation_candidate`s Unterscheidung zwischen „noch in Arbeit" und „terminal" auf).
