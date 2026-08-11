# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git log --oneline main..HEAD` und dem PR-Status des aktuellen Branches. Bewahre vorhandene Änderungen; erst nach ausdrücklicher Aufforderung committen oder pushen.

## Historischer Stand vor Umsetzung von Plan 033

Lies vor Änderungen vollständig:

- `AGENTS.md`
- `docs/product/implementation-plan.md`
- `docs/adr/ADR-002-hatchet-boundary.md`
- `docs/adr/ADR-010-text-workshop-style-profiles-and-generation-provenance.md`
- `docs/operations/hatchet.md`
- `plans/032-mobile-textwerkstatt-mit-stilprofilen.md`
- `plans/033-echter-textgenerator-und-provider-routing.md`
- `plans/README.md`

### Erreichter Ausgangsstand

- Paket 004 ist fertig: `2026081102_workflow_run_lifecycle.sql` ergänzt die transaktionale Outbox-/Run-Lebenszyklusgrenze, ID-only-Payload-CHECK, Lease/CAS sowie Service-Role-only-RPCs. `apps/worker` registriert alle erlaubten Workflownamen mit striktem Zod-Payload, Retry-Klassifikation und gestaffelter Fairness.
- Der lokale Nachweis ist erbracht: Outbox → Hatchet-SDK → registrierter Worker-Handler → `workflow_runs.succeeded`; Doppelzustellung, Restart/Lease, nicht retrybare Fehler und Mandantentrennung sind getestet. Das lokale Runbook steht in `docs/operations/hatchet.md`.
- Paket 032 Teilphase 1 ist fertig: Verträge, tenant-sichere Textwerkstatt-Tabellen, RLS-/Negativtests und ADR-010. Es gibt absichtlich noch keine Session-API, keinen produktiven Provideradapter und keine Textwerkstatt-UI.
- Paket 002 bleibt ausschließlich für private Foto-/Video-Anhänge Voraussetzung. Der Text-only USP-Pilot aus 033 darf und soll ohne Medien starten.

### Nicht verhandelbare Grenzen

- Nur `text_generation` ist aktiv. Keine Bild-/Video-KI, keine Medien an das LLM, keine freien Systemprompts.
- Providerzugriff ausschließlich hinter einer injizierbaren Schnittstelle und nur im Worker; Fastify führt keine synchronen LLM-Calls aus.
- Outbox-/Hatchet-Payloads, Logs und Browserstate enthalten keine Secrets, Prompts, Antworten oder vollständigen Beiträge.
- Zod an jeder Systemgrenze; tenantbezogene Tabellen mit `organization_id`, Composite-FKs, RLS sowie positiven und negativen Isolationstests.
- Kandidaten bleiben getrennt von akzeptierten Versionen. Erst **Übernehmen** erzeugt atomar eine neue immutable `post_version` samt Provenienz.
- Wenn eine STOP-Bedingung aus Plan 033 greift, nicht improvisieren: Ursache, betroffene Dateien und den kleinsten nächsten Schritt berichten.

### Verifikation

Nach jedem Planabschnitt passende fokussierte Tests ausführen. Vor Abschluss mindestens:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:reset
pnpm db:test
```

Stand 2026-08-11: Nach Paket 004 bestanden `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` und `pnpm db:test` mit 602 Assertions in 20 Dateien.
