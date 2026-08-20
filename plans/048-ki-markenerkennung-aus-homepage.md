# Paket 048: KI-gestützte Markenerkennung aus der Vereins-Homepage

Stand: 2026-08-20. PR 1 (Datenmodell + LLM-Task-Kind-Vokabular) fertig. PR 2 (Worker: Screenshot, Extraktion, Vision-Adapter, API-Routen) und PR 3 (Frontend-Integration in `marke.vue`) offen.

## Ausgangslage

`marke.vue` verlangt bisher, dass jeder Verein Farben, Logos und Schriften vollständig von Hand einträgt (Paket 013). Ziel: der Verein gibt nur den Link zu seiner Homepage an, eine KI leitet daraus per Screenshot + Vision-LLM ein Farbschema, ein Logo-Bild und eine Font-Empfehlung ab und füllt damit das bestehende Formular vor — gespeichert wird weiterhin erst über den bestehenden „Änderungen speichern“-Button.

Die App hatte dafür bislang **keine** multimodale LLM-Infrastruktur, **keine** Screenshot-Fähigkeit und **keinen** passenden `task_kind`. Die bestehende Anti-Google-Fonts-Datenschutzpolicy (`packages/domain/src/fonts.ts`) bleibt unangetastet: bei einer erkannten Fremdschrift schlägt die KI nur das ähnlichste der zwei kuratierten, selbst gehosteten Font-Paare vor **und** nennt den erkannten Namen als Hinweis für einen lizenzkonformen Eigen-Upload — sie lädt nie selbst eine Fremdschrift nach.

## Entschiedene Fragen

1. **Analyse-Methode**: echter Screenshot (Playwright) + Vision-LLM, nicht nur HTML/CSS-Text-Analyse.
2. **Übernahme**: die KI füllt `marke.vue` nur vor (Farben, Font-Auswahl, Logo-Vorschau); Persistenz läuft unverändert über den bestehenden Speichern-Button.
3. **Aufgabenteilung Determinismus vs. KI**: Font-Erkennung und Logo-Kandidaten-Suche laufen deterministisch per Playwright-DOM-Auswertung (`getComputedStyle`, `<link rel=icon>`, `og:image`, `<header> img`); die Vision-KI liefert nur die fünf Farbrollen und eine Wahl zwischen den zwei kuratierten Font-Paaren (Enum, kein Freitext-Raten).
4. **Ein Job pro Verein, keine Historie**: jeder neue „Analyse starten“-Klick überschreibt den letzten Analyse-Lauf für diesen Verein.

## Architektur — PR 1 (Datenmodell)

- **Vokabular-Erweiterung ohne Aktivierung**: `llm_provider_configurations.task_kind`-CHECK um `vision_analysis` erweitert (Migration `2026082007_brand_website_analysis.sql`), analog zu `image_generation`/`video_generation` seit Paket 046 — der Wert existiert im Vokabular, aber `llm_provider_configurations_active_implemented_adapter_check` bleibt auf `text_generation` beschränkt, bis der Vision-Adapter in PR 2 tatsächlich existiert. `LlmTaskKindSchema` (`packages/contracts/src/platformAdmin.ts`) entsprechend erweitert.
- **Neue Tabelle `brand_website_analysis_jobs`** (ein Job pro Verein, `organization_id unique`): `website_url`, `status` (`pending`/`running`/`succeeded`/`failed`), `revision`, `requested_by`, `result` (jsonb), `error_reason`. RLS: SELECT nur für `authz.has_organization_permission(organization_id, 'organization.manage')` (dieselbe Berechtigung wie `brand_profiles_update`, nicht die breitere vereinsweite Lesbarkeit von `brand_assets`) — ein Analyse-Zwischenstand ist Arbeitszustand für die Markenpflege, keine öffentliche Markeninformation. Keine Schreib-Grants für `authenticated`.
- **RPC `start_brand_website_analysis(organization_id, website_url, requested_by)`**, nur für `service_role` ausführbar (Prinzip „RPC traut Client nicht“ — die aufrufende API-Route hat `brand.manage` bereits geprüft). Legt den Job an/überschreibt ihn und erzeugt eine `workflow_outbox`-Zeile für den neuen Workflow-Namen `analyze-website-branding` (`WorkflowNameSchema`, `packages/contracts/src/workflow.ts`). Lehnt einen zweiten Trigger ab (`analysis_in_progress`), solange der bestehende Job `pending`/`running` ist.
- **Wichtiger Fund während der Umsetzung**: `workflow_outbox.department_id` ist `not null` mit echtem FK auf `departments` — die generische Workflow-Hülle (`WorkflowPayloadSchema`, `.strict()`) erzwingt für **jeden** Workflow eine reale Abteilung, obwohl diese Funktion rein vereinsbezogen ist und keinen fachlichen Abteilungsbezug hat. Statt die geteilte, produktiv genutzte Hülle aufzuweichen, nimmt die RPC die **älteste Abteilung des Vereins** als rein technischen Träger für Dispatch/Concurrency-Gruppierung — das ist sicher, weil `DELETE /v1/departments/:id` die letzte Abteilung eines Vereins bereits blockiert (`apps/api/src/routes/structure.ts`, `last_department_cannot_be_deleted`), also jeder Verein garantiert immer mindestens eine Abteilung hat. Die eigentliche Berechtigungsprüfung (`brand.manage`) und die RLS auf `organization_brand_profiles` bleiben davon unberührt vereinsbezogen.
- **`curatedFontPairings`** (`packages/domain/src/fonts.ts`) um `styleDescription` je Paar ergänzt, damit die Vision-KI in PR 2 einen Text hat, auf den sie ihre Wahl stützen kann.
- **pgTAP-Test** `supabase/tests/brand_website_analysis.test.sql`: FORCE ROW LEVEL SECURITY, RPC-Verhalten (Job-Anlage, Abteilungs-Herleitung, Ablehnung eines zweiten Triggers während der Job noch läuft, Überschreiben statt Historie bei einem erneuten Lauf, Ablehnung eines `requested_by` ohne Mitgliedschaft im Zielverein), keine Direktschreibrechte für `authenticated`, Mandantentrennung. Der Test ruft die RPC sequenziell zweimal auf (kein echter Zwei-Transaktionen-Test — dasselbe bewusst vermiedene dblink-Muster wie bei `claim_stalled_generation_candidates`); die Race bei zwei tatsächlich gleichzeitigen Erst-Triggern schließt stattdessen der Advisory-Lock in der RPC selbst.

## Architektur — PR 2 (Worker) und PR 3 (Frontend), noch offen

Siehe Recherche-Ergebnisse im Umsetzungsverlauf; Kernpunkte:

- Neuer Hatchet-Workflow-Executor im Worker: SSRF-Prüfung der Ziel-URL (`@vereinsfunk/outbound-fetch`) **vor** jeder Playwright-Navigation (Playwrights eigenes Networking läuft nicht durch `fetchPublicUrl`/`createGuardedFetch`, braucht eigene Guards inkl. `page.route()` für Redirects/Subrequests), Screenshot + deterministische DOM-Auswertung, Vision-LLM-Aufruf, optionaler Logo-Download/-Verarbeitung (Wiederverwendung von `processBrandLogoUpload` aus `apps/api/src/brandLogo.ts`, dafür nach `packages/domain` verschoben, weil `apps/worker` nicht aus `apps/api/src` importieren kann).
- Neue, eigenständige `VisionAnalysisGenerator`-Adapter in `packages/content-engine` (Anthropic Image-Content-Block + erzwungener Tool-Use, OpenAI-kompatibel mit `image_url`).
- Neue API-Routen `POST`/`GET /v1/organizations/:id/brand/website-analysis` (`brand.manage`-geschützt), erst dort werden `llmProviders.routes.ts`-Aktivierungs-Whitelist und `GET /v1/vision-analysis-capabilities` ergänzt (bewusst erst, wenn der Adapter existiert).
- `apps/worker/Dockerfile` (eigenständige Datei, `node:24-bookworm-slim`) braucht Chromium-Systempakete — das unsicherste, zuerst isoliert zu verifizierende Detail des gesamten Pakets.
- Frontend: eigenes, lokales URL-Feld auf `marke.vue` (Vereinsebene), neues Poll-Composable `useBrandWebsiteAnalysis.ts`, kleine Refaktorierung in `useBrandAssets.ts` (`applyLogoFile(file, variant)`), damit ein KI-gelieferter Logo-Kandidat denselben Vorschau-/Speichern-Pfad nutzt wie ein manueller Datei-Upload.

## Verifikation

- PR 1: `pnpm lint && pnpm typecheck && pnpm test` grün (36/36 Pakete). `pnpm db:reset && pnpm db:test` grün: 37 Testdateien, 969 Assertions, keine Regression in den bestehenden Tests, inklusive der neuen Datei `brand_website_analysis.test.sql` (15 Assertions). Bewusst mit Rücksprache ausgeführt, weil dieselbe lokale Supabase-Instanz zum Zeitpunkt des Laufs von mehreren anderen Worktree-Sessions mitbenutzt wurde.
- PR 2: SSRF-Test gegen private/interne Test-URLs (inkl. Redirect-Fall), Adapter-Unit-Tests gegen einen gemockten HTTP-Server, End-to-End-Lauf des Workers gegen eine echte öffentliche Test-URL.
- PR 3: Browser-Smoke-Test auf `marke.vue` (URL eingeben, Analyse starten, Vorschau prüfen, Speichern, Reload prüfen).
