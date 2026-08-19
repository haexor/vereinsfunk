# Paket 046: Mehrere LLMs gleichzeitig in der Textwerkstatt

Stand: 2026-08-19. PR 1 fertig (Backend: Datenmodell, RPCs, Worker, API, Plattform-Admin-Einstellung). PR 2 (Mehrfachauswahl-UI in `erstellen.vue`) noch nicht begonnen.

## Ausgangslage

Die Textwerkstatt erzeugte pro Klick auf „Generieren“/„Überarbeiten“ genau einen Textvorschlag von dem einen aktiven LLM-Provider (`llm_provider_configurations`, Auflösung: höchste Priorität, `is_active`, je `task_kind`). Ziel dieses Pakets: der SaaS-Betreiber legt fest, wie viele verschiedene LLMs **gleichzeitig** einen Vorschlag liefern. Ein Mitglied bekommt dann bei jedem Generieren/Überarbeiten mehrere Vorschläge nebeneinander, wählt einen aus oder lässt neu generieren.

Das Datenmodell (`composition_sessions` (1) → `generation_candidates` (n)) unterstützte „mehrere Kandidaten je Sitzung“ bereits strukturell, aber ausschließlich nacheinander (eine Revision ersetzt die vorige). Die eigentliche Arbeit war ein echter paralleler Fan-out mit fester Zuordnung „ein Kandidat = ein bestimmter Provider“, ohne die bestehende Recovery- und Idempotenz-Logik zu brechen.

## Entschiedene Fragen

1. **Modellauswahl**: explizite Einstellung „Ensemble-Größe“ (SaaS-Betreiber, `platform_settings.text_generation_ensemble_size`, 1–5, Default 1), nicht implizit über die Zahl aktiver Provider. Ausgewählt werden die Top-N aktiven Provider je Priorität für `task_kind='text_generation'`.
2. **Bestehendes 8er-Versuchslimit** (`composition_sessions.candidate_count`): bleibt unverändert als Zähler einzelner Kandidatenzeilen (nicht „Runden“). Bei Ensemble-Größe 3 sind die 8 Versuche also nach 2–3 Klicks aufgebraucht statt nach 8 — bewusst in Kauf genommen. Reicht das Kontingent nicht für eine volle Runde, wird die **gesamte** Anfrage abgelehnt (`composition_session_candidate_limit_reached`), nie eine stillschweigend verkleinerte Teilrunde.
3. **„Neu generieren“** stößt immer alle konfigurierten Modelle erneut an (kompletter neuer Satz), kein Einzel-Retrigger je Modell.
4. **Keine Modellnamen an Mitglieder**: die Vorschläge werden anonym behandelt (kein Provider-/Modellname in der an Mitglieder ausgelieferten API-Antwort), konsistent mit `post_generation_provenance` („enthält nie Rohprompt/Providerdaten“).

## Architektur

- **Provider-Zuweisung passiert bei Anlage, nicht bei Ausführung.** Vorher lud der Worker beim Ausführen `loadActiveTextProvider()` und bekam „den gerade aktiven Top-1“. Bei mehreren gleichzeitigen Kandidaten würden alle N Worker-Läufe denselben Provider laden, wenn die Auswahl weiterhin erst zur Laufzeit passiert. Jetzt löst `apps/api/src/routes/shared.ts` (`resolveTextGenerationProviderConfigurationIds`) beim Anlegen die Top-N aktiven Provider auf und übergibt sie an `create_text_generation_session`, die jedem neuen `generation_candidates`-Datensatz einen festen `provider_configuration_id` zuweist. Der Worker (`apps/worker/src/context.ts`, `loadProvider(id)`) lädt danach genau diesen zugewiesenen Provider.
- **Automatische Recovery bekommt keinen Ensemble-Fan-out.** `apps/worker/src/generationRecovery.ts` ersetzt weiterhin genau einen festgefahrenen Kandidaten durch genau einen frischen Versuch (Top-1-Provider, unabhängig von der Ensemble-Einstellung) — sonst würde ein hängender Kandidat plötzlich N neue erzeugen und zusätzlich das 8er-Limit sprengen.
- **„Runde“ als neue Gruppierung**: neue Spalte `generation_candidates.round_input_hash` (Migration `2026081902`, Default per Trigger = `input_hash`, damit jede bestehende Fixture/jeder bestehende Test unverändert bleibt). Ein Klick erzeugt N Zeilen mit gemeinsamem `round_input_hash`; `input_hash` je Zeile bleibt eindeutig (`sha256(round_hash || ':' || provider_configuration_id)`).
- **Provider-Zuweisung in `create_text_generation_session`** (Migration `2026081903`): neuer Pflichtparameter `p_provider_configuration_ids uuid[]`, ein Kandidat je Element. Recovery hat einen eigenen, separaten Zweig (statt der round-weiten Idempotenzprüfung): sie prüft/inseriert genau eine Zeile über deren eigenen, per Kandidaten-ID abgeleiteten Hash und reiht sie über den explizit mitgegebenen `p_round_input_hash` in die bestehende Runde des festgefahrenen Kandidaten ein — sonst hätte eine Wiederholung dieselbe Runde als „schon vollständig“ erkannt und nichts hinzugefügt (per pgTAP gefunden, siehe Testdatei).
- **Nebenbei gefundener, unabhängiger Bug mitbehoben**: Recovery reichte `stale.generation_intent` unverändert durch; für einen festgefahrenen `initial`-Kandidaten löste das auf der schon bestehenden Sitzung die Bedingung „`initial`-Runde ohne Treffer ist ein Widerspruch“ aus (`composition_session_generation_conflict`) — die Recovery dieses einen Kandidaten scheiterte dauerhaft und wurde alle 5 Minuten wiederholt, ohne je zu greifen. Die Bedingung gilt jetzt nur noch für `p_triggered_by = 'member'`.
- **Sitzungsstatus als Aggregat statt Einzelvorbedingung** (Migration `2026081904`): `mark_generation_candidate_ready`/`_failed`, `release_generation_candidate` und `finalize_stalled_generation_recovery` setzten `composition_sessions.status` bisher mit der Vorbedingung „nur wenn aktuell `generating`“ und warfen sonst eine Exception. Bei mehreren gleichzeitigen Kandidaten hätte das den zweiten fertigen Geschwister-Kandidaten mit `..._update_lost` abgewürgt (samt Rollback seines eigenen `generated_content`). Neue Funktion `recompute_composition_session_status(session_id, round_hash)` leitet den Status stattdessen aus allen Kandidaten derselben Runde her (`generating` solange einer läuft, `queued` solange einer wartet, `candidate_ready` sobald alle fertig und mindestens einer bereit ist, sonst `failed`) und wird von allen vier Funktionen aufgerufen.
- **API** (`apps/api/src/routes/content.ts`): `/v1/text-workshop/sessions` und `.../sessions/:id/generations` lösen die Provider vor dem RPC-Aufruf auf (422 `no_active_text_provider`, falls keiner aktiv ist) und liefern `candidateIds` (Array) statt `candidateId`. `respondWithCompositionSession` ermittelt erst die jüngste Runde (`round_input_hash` der neuesten Zeile), dann alle ihre Kandidaten, statt nur die eine letzte Zeile.
- **Plattform-Admin-UI** (`apps/web/app/pages/plattform-admin/llm.vue`): neue Sektion „Gleichzeitige Modelle“, liest/schreibt `platform_settings.text_generation_ensemble_size` über das bestehende `GET/PUT /v1/platform-settings`-Muster.
- **`erstellen.vue`** (PR 1, minimal): auf `candidateIds`-Array umgestellt, zeigt bis PR 2 weiterhin nur den ersten Kandidaten — bei Ensemble-Größe 1 (Default) unverändertes Verhalten.

## Nicht Teil dieses Pakets (PR 2)

- Mehrfachauswahl-UI in `erstellen.vue`: Kandidaten als Karten-Grid, Auswahl per Klick, „Übernehmen“ erst nach Auswahl.
- Browser-Verifikation mit Ensemble-Größe > 1 gegen die echte App.

## Verifikation

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: grün.
- `pnpm db:reset && pnpm db:test`: 34 Dateien, 893 Assertions, alle grün — inklusive neuer Datei `text_generation_ensemble.test.sql` (Fan-out, rundenweites Alles-oder-nichts-Limit, Status-Aggregat-Race-Fix, Recovery-Rundenzugehörigkeit, Konflikt-Regression für Mitglieder-Anfragen).
- Noch offen: echter Playwright-/Browser-Lauf mit Ensemble-Größe > 1 (folgt mit PR 2).
