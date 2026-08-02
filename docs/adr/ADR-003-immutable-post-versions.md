# ADR-003: Unveränderliche Post-Versionen

Status: angenommen · 2. August 2026

Freigaben referenzieren eine konkrete `post_version_id`. Inhaltliche Änderungen erzeugen eine neue Version; Updates auf `post_versions` werden für Browserrollen nicht freigegeben. Damit bleiben Fakten- und Konfigurationssnapshots reproduzierbar.
