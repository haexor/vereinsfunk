# Prompt für die nächste Session

Arbeite im Repository-Root (dieses Checkout).

Prüfe zuerst `git status --short --branch`, `git log --oneline main..HEAD` und den PR-Status des aktuellen Branches. Bewahre alle vorhandenen Änderungen. Keine Commits oder Pushes ohne ausdrückliche Aufforderung.

## Schritt 1: Paket 032 fortsetzen

Lies vor Änderungen vollständig:

- `AGENTS.md`
- `docs/product/implementation-plan.md`
- `docs/adr/ADR-001-multi-tenant-supabase.md` bis `ADR-006-media-approval-snapshots.md`
- `docs/adr/ADR-010-text-workshop-style-profiles-and-generation-provenance.md`
- `plans/002-private-media-consent-and-approval-gate.md`
- `plans/004-hatchet-production-orchestration.md`
- `plans/025-inhalts-pipeline-entwurf-und-veroeffentlichung.md`
- `plans/030-reviewer-snapshot-ohne-autor.md`
- `plans/032-mobile-textwerkstatt-mit-stilprofilen.md`
- `plans/README.md`

### Erreichter Stand von Paket 032

- Teilphase 1 ist fertig und geprüft: Zod-Verträge für `text_post|photo_post|video_post`, Stilprofile, Kompositionssitzungen, getrennte Kandidaten und kontrollierte Video-Kompressionsprovenienz.
- Migration `2026081003_text_workshop_foundation.sql` enthält `content_style_profiles`, `composition_sessions`, `composition_session_media`, `generation_candidates` und `post_generation_provenance`; alle tenantbezogen, mit Composite-FKs, RLS und Service-Role-only Writes.
- `supabase/tests/text_workshop_foundation.test.sql` deckt positives Lesen sowie negative Cross-Tenant- und Direkt-Write-Fälle ab, dazu einen positiven Fall für einen benannten, imitierenden Custom-Stilprofil (Betreiberentscheidung 2026-08-11, siehe unten).
- ADR-010 schreibt text-only Generierung, erlaubte benannte/imitierende Stilprofile (organisatorisch statt technisch abgesichert), feste Prompt-Priorität und datensparsame, unveränderliche Provenienz fest.
- Es gibt absichtlich noch keine API-Route, keinen Upload, keine Web-UI und keinen LLM-Aufruf.

### Zwingende Reihenfolge

1. **Paket 004 zuerst vervollständigen.** Baue und belege eine transaktionale Supabase-Outbox, einen real startenden Hatchet-Worker und einen echten SDK-Dispatcher. Nachrichten enthalten ausschließlich IDs, Revision, Correlation-ID, Priorität und Idempotenzschlüssel. Verifiziere mindestens Retry, Nicht-Retry, Duplicate Trigger, Restart, Cancel/Reschedule und Fairness. Kein externer LLM-Aufruf vor diesem Nachweis.
2. **Danach Paket 002 vervollständigen.** Baue den privaten Upload-, Scan-/Normalisierungs-, Derivat- und Freigabegate-Pfad. Originale dürfen nie über `post_media` veröffentlicht werden. `evaluateMediaGate` und `assertApprovalSnapshot` müssen bei Freigabe und Publishing tatsächlich blockieren.
3. **Erst danach Paket 032 fortsetzen.** Implementiere zunächst Stilprofil-CRUD und die Kompositionssitzungs-API mit Zod, Autorisierung, Audit und der bereits vorhandenen Outbox. Danach den Worker-gebundenen, strukturierten Textgenerator und getrennte Kandidaten. Jede Übernahme oder manuelle Änderung legt atomar eine neue `post_version` an; keine bestehende Version aktualisieren.
4. Medien erst nach 002 aktivieren. Beim Video zuerst den dokumentierten Browser-Kompressionsspike durchführen. Ohne sicheren lokalen Encoder nur explizite private Quarantäne + serverseitigen Fallback anbieten; niemals still das Original hochladen. Medien niemals ans LLM senden.
5. Den mobilen Editor erst auf die reale Session-/Kandidaten-API aufsetzen. Der Freigabe-CTA ruft die echte Request-Approval-Route auf und navigiert nicht nur.

### Nicht verhandelbare Grenzen

- Supabase ist die fachliche Source of Truth; Hatchet ist nur technische Ausführung.
- Zod an jeder Systemgrenze, RLS plus positive und negative Tenant-Tests für jede neue Tabelle.
- Service Role nur API/Worker, nie Browser; Hatchet-Payloads enthalten keine Texte, Medien oder Secrets.
- LLM generiert Text, niemals Videos; keine Bild-/Videoanalyse durch das LLM, keine Gesichtserkennung oder Face-Tracking.
- Stilprofile enthalten überprüfbare redaktionelle Attribute plus optional einen benannten, imitierenden Personenbezug (Betreiberentscheidung 2026-08-11, ADR-010) — kein freier Systemprompt: `additionalInstructions` bleibt begrenzt und niedrig priorisiert und kann Faktenbindung, Sicherheits- oder Plattformgrenzen nie überschreiben.
- Freigegebene `post_versions` und fertige Derivate sind unveränderlich.

### Verifikation

Nach jeder Teilphase passende Pakettests ausführen; vor Abschluss mindestens:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:reset
pnpm db:test
```

Stand 2026-08-11: der vollständige `pnpm db:test`-Lauf ist sauber grün (582/582 Assertions, 18 Dateien) — die früher hier dokumentierte Fixture-Kollision in `consent_management.test.sql`/`metrics.test.sql` tritt nicht mehr auf.
