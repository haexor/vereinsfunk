# ADR-001: Gemeinsame Supabase-Instanz

Status: angenommen · 2. August 2026

Alle Vereine teilen eine Produktionsinstanz. Tenant-Isolation wird durch `organization_id`, Memberships, zusammengesetzte Fremdschlüssel und RLS erzwungen. Dadurch bleibt der Betrieb beherrschbar; jede Schemaänderung trägt dafür eine hohe Sicherheitsverantwortung und benötigt negative Isolationstests.
