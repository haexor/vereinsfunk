# Übergabe: Agenten-Arbeitsplatz – nach Paket A

Stand: 24. August 2026

Branch-Ziel: `codex/agent-workspace-package-a`

## Erledigter Umfang

Paket A des [Agenten-Arbeitsplatz-Plans](agent-workspace-plan.md) ist umgesetzt:

- Private, mandantenisolierte Conversations und Messages mit RLS, Retention und
  positiven wie negativen pgTAP-Tests.
- Zod-Contracts für Scopes, Conversations, Nachrichten und den kompakten
  Workspace-Überblick.
- Read-only-Fastify-Endpunkte für Workspace, Conversations und Nachrichten.
- Serverseitiger Responses-Adapter mit `store: false`, kleiner berechtigter
  Kontextmenge und lokalem, read-only Fallback ohne OpenAI-Schlüssel.
- Nuxt-Arbeitsplatz unter `/assistent` mit Conversation, offenen Freigaben,
  Events und Beiträgen.
- ADR-012: interne Command-Plane zuerst; MCP erst später als dünner Adapter.
- Review-Härtung: Responses werden aus den rohen `output[].content[]`-Einträgen
  validiert, Scope-Wechsel können keine veralteten UI-Daten übernehmen und das
  Speichern eines Nachrichtenpaars erfolgt atomar.

Die Tabelle für Proposals und Tool-Runs ist bewusst schon angelegt, wird in Paket A
aber noch nicht benutzt. Die Nachrichtenroute liefert noch eine vollständige
Antwort statt SSE-Streaming. Es gibt noch keine schreibenden Agenten-Tools.

## Verifizierter Stand

Erfolgreich ausgeführt:

- `pnpm --filter @vereinsfunk/contracts typecheck`
- `pnpm --filter @vereinsfunk/api typecheck`
- `pnpm --filter @vereinsfunk/web typecheck`
- `pnpm --filter @vereinsfunk/contracts test` (115 Tests)
- `pnpm --filter @vereinsfunk/api test` (535 Tests)
- `pnpm lint`
- `pnpm --filter @vereinsfunk/api build`
- `pnpm --filter @vereinsfunk/web build`
- `pnpm exec supabase migration up --local`
- `pnpm exec supabase test db supabase/tests/agent_workspace.test.sql` (26 pgTAP-Tests)

`pnpm db:test` erreicht den neuen Agenten-Test erfolgreich, endet aber weiterhin
mit acht bereits vor dieser Änderung auftretenden Fehlern in
`supabase/tests/platform_administration.test.sql`. Diese betreffen den lokalen
Bootstrap-Plattform-Admin-Testzustand, nicht die Agenten-Migration.

## Nächster Umsetzungsschritt: Paket B

1. Den Proposal-Lifecycle in `agent_action_proposals` vollständig implementieren:
   kanonischer Input-Hash, Ablauf, Verwerfen, atomare Bestätigung, erneute
   Autorisierung und idempotente Ausführung.
2. Bestehende fachliche Use Cases zuerst aus den HTTP-Routen herauslösen oder
   wiederverwenden. Der Agent darf keine Routen per HTTP aufrufen und keine
   Fachdaten direkt mit der Service Role mutieren.
3. Zunächst nur `propose_event`/`create_event` und
   `propose_invitation`/`create_invitation` als enge Tool-Registry umsetzen.
4. Aktionskarten in `/assistent` um Wirkung, Scope, Ablauf, Deep Link sowie
   „Bestätigen“ und „Verwerfen“ ergänzen.
5. Für jede Aktion positive und negative Autorisierungs-, RLS-,
   Idempotenz- und Audit-Tests ergänzen. Insbesondere darf eine Bestätigung nie
   ohne erneute Permission- und Scope-Prüfung ausführen.

## Bewusst später

Content-Generierung, Approval-Entscheidungen, Scheduling und Publishing bleiben
Paket C/D. Ein externes MCP wird erst nach einem stabilen, evaluierten
Command-Plane-Pilot begonnen und erhält keine eigenen Fachfähigkeiten.
