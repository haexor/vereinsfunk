# Arbeitsregeln fuer Codex und andere Entwicklungsagenten

## Architektur

- Lies vor Aenderungen `docs/product/implementation-plan.md` und relevante ADRs.
- `apps/*` darf `packages/*` importieren; Domain-Pakete kennen keine Frameworks.
- TypeScript ist strict. Alle Systemgrenzen werden mit Zod validiert.
- Supabase ist die fachliche Source of Truth; Workflow-Nachrichten enthalten nur IDs und kleine technische Metadaten.
- Provider werden ausschliesslich hinter Interfaces angesprochen.

## Sicherheit und Mandanten

- Jede mandantenbezogene Tabelle besitzt `organization_id`.
- Neue exponierte Tabellen brauchen RLS sowie positive und negative Isolationstests.
- Zusammengesetzte Fremdschluessel verhindern Cross-Tenant-Referenzen.
- Die Supabase Service Role darf nur in API und Workern verwendet werden, nie im Browser.
- Freigegebene Post-Versionen bleiben unveraenderlich; Aenderungen erzeugen eine neue Version.
- Externe Aktionen sind idempotent und werden auditiert.
- Medien sind standardmaessig privat. Keine Secrets oder vollstaendigen Medien-Payloads loggen.

## Definition of Done

- Relevante Tests, Typecheck, Lint und Build sind erfolgreich.
- Migrationen, RLS, Observability, Dokumentation und Wiederherstellung sind betrachtet.
- Bestehende Aenderungen anderer Personen bleiben erhalten.
