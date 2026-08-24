# Übergabe: Agenten-Arbeitsplatz – nach Agenten-LLM-Konfiguration

Stand: 24. August 2026

Branch-Ziel: `codex/agent-runtime-configuration`

## Erledigter Umfang

Pakete A–C des [Agenten-Arbeitsplatz-Plans](agent-workspace-plan.md) sowie die
bestätigte Scheduling-Teilstufe von Paket D sind umgesetzt:

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

- Strikte Responses-Tool-Registry für `create_event` und `create_invitation`;
  ein Tool-Aufruf erzeugt nur ein Proposal, nie eine direkte externe Aktion.
- Proposal-Lifecycle mit kanonischem Hash, 15-Minuten-Ablauf, Verwerfen,
  atomarer Execution-Reservation, Re-Autorisierung, Audit und Tool-Run-Diagnose.
- Bestätigte Events über den gemeinsamen Event-Use-Case sowie bestätigte
  Einladungen über den nun aus der HTTP-Route wiederverwendeten
  Einladungs-Use-Case. Ein fehlgeschlagener E-Mail-Versand macht die angelegte
  Einladung sichtbar, statt sie doppelt auszuführen.
- Aktionskarten unter `/assistent` mit Vorschau, Ablauf, Bestätigen und Verwerfen.

- Bestätigte Freigabeanforderungen ausschließlich über die vorhandene
  `request_approval`-Fach-RPC mit Scope- und Permission-Recheck.
- Faktengebundene Content-Briefs als persönliche Textwerkstatt-Entwürfe sowie ein
  Deep Link zurück in die Fachseite.
- Bestätigte Textgenerierung über den aus der Textwerkstatt extrahierten gemeinsamen
  API-Use-Case. Der Agent löst keinen Provider direkt aus; die vorhandene
  Session-/Outbox-/Worker-Kette bleibt zuständig.
- Bereite Textkandidaten im begrenzten Workspace-Kontext und ihre bestätigte
  Übernahme als immutable Post-Version. Kandidaten mit Medien bleiben absichtlich
  in der Textwerkstatt, weil deren Medien- und Einwilligungsprüfungen dort gelten.
- Resultatreferenzen auf Proposals und Tool-Runs, damit bestätigte Content-Aktionen
  zur passenden Textwerkstatt-Sitzung oder zum Draft zurückführen.

- `schedule_publication` plant ausschließlich eine aktuelle, freigegebene
  Post-Version auf genau einem erlaubten Instagram- oder Facebook-Kanal. Die
  vorhandene idempotente Scheduling-RPC bleibt die fachliche Ausführungsgrenze.
- Die Plattformadministration kann unter „Einstellungen“ eine aktive,
  OpenAI-kompatible Text-Provider-Konfiguration für den Agenten auswählen. Modell,
  Base-URL und verschlüsseltes Secret werden pro Nachricht ausschließlich auf dem
  Server aufgelöst; ohne Auswahl bleibt der Deployment-Fallback erhalten.
- Die Textkandidaten-Kachel ist vom Kern-Workspace entkoppelt: ein Fehler in ihrer
  optionalen Abfrage verhindert nicht mehr, dass `/assistent` geladen wird.

Die Nachrichtenroute liefert weiterhin eine vollständige Antwort statt SSE-Streaming.

## Verifizierter Stand

Erfolgreich ausgeführt:

- `pnpm --filter @vereinsfunk/api typecheck`
- `pnpm --filter @vereinsfunk/web typecheck`
- `pnpm --filter @vereinsfunk/contracts test -- platformAdmin.test.ts` (116 Tests)
- `pnpm --filter @vereinsfunk/api test -- agent.test.ts agent.routes.test.ts platformAdmin.routes.test.ts` (547 Tests)
- `pnpm lint`
- `pnpm build`

Die neue Migration fügt ausschließlich einen deny-all-RLS-geschützten,
service-role-gelesenen Schlüssel in `platform_settings` ein; sie benötigt keine
neue Tabelle oder Policy.

## Nächster Umsetzungsschritt: Paket D abschließen

1. Direkte Veröffentlichung als von Scheduling getrennte, final bestätigte Aktion
   an die bestehende Outbox-/Hatchet-/Publisher-Kette anbinden.
2. Reconciliation, Provider-Fehler und Zustandsänderungen als sichere
   Fortschrittsmeldungen in die Conversation zurückspielen.
3. Vor einem Pilot Evals für Toolwahl, Scope-Wechsel, gestoppte Freigaben und
   Wiederholungen ergänzen.

## Bewusst später

Scheduling und Publishing bleiben Paket D. Approval-Entscheidungen bleiben auf der
etablierten Freigabeseite, bis eine eigene Policy- und Self-Approval-Eval dafür
vorliegt. Ein externes MCP wird erst nach einem stabilen, evaluierten
Command-Plane-Pilot begonnen und erhält keine eigenen Fachfähigkeiten.
