# Plan 033: Einen echten, versionssicheren Textgenerator als USP-Pilot ausliefern

> **Executor instructions**: Folge diesem Plan vollständig. Er aktiviert erstmals einen externen KI-Aufruf in einem Mandantenprodukt. Kein Schritt darf Faktenbindung, RLS, Geheimnistrennung, unveränderliche `post_versions` oder den Freigabeprozess umgehen. Führe jede Prüfung aus. Bei einer STOP-Bedingung anhalten und berichten, nicht mit einem synchronen API-Shortcut oder freiem Prompt improvisieren.
>
> **Drift check (run first)**: `git diff --stat 5f614e5b..HEAD -- apps/api/src apps/worker/src apps/web/app packages/content-engine/src packages/contracts/src packages/orchestration/src supabase/migrations supabase/tests docs/adr docs/product plans/README.md`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — externer Provider, verschlüsselte Zugangsdaten, neue Worker-Fachlogik und versionierte Beitragsdaten
- **Depends on**: `032-mobile-textwerkstatt-mit-stilprofilen.md` (Datenfundament); Paket 004 ist abgeschlossen und stellt den lokal nachgewiesenen Outbox-/Hatchet-Worker-Pfad einschließlich Run-Lebenszyklus bereit
- **Category**: direction, migration, security, tests
- **Planned at**: commit `5f614e5b`, 2026-08-11

## Why this matters

Vereinsfunk kann heute Beiträge erfassen und einen sicheren Fake-Entwurf anzeigen, aber die Plattform-Admin-Konfiguration ruft kein Modell auf. Der gewünschte USP ist erst erreicht, wenn ein Mitglied mit `post.create` aus Anlass, Tonalität/Persona und bestätigten Stichpunkten einen echten, nachvollziehbaren Textkandidaten erhält. Dieser Pilot liefert genau diesen Textfluss mit einem aktiv konfigurierten GPT-/OpenAI-kompatiblen Modell, ohne die nicht gelösten Risiken einer KI-Bild- oder KI-Videoerzeugung in denselben Release zu ziehen.

## Product decision and hard boundary

Dieses Paket liefert **Textgenerierung**. Die Plattformverwaltung erhält eine zukunftsfähige Aufgaben-Routing-Struktur, aber nur `text_generation` ist aktivierbar und hat einen produktiven Adapter.

- `image_generation` und `video_generation` werden als zukünftige Aufgaben benannt, aber weder auswählbar noch aufrufbar. Kein Eintrag für Veo, Seedance, Kling, Luma, PixVerse oder einen Bildanbieter darf ohne einen eigenen Provider-Spike und Adapter in eine Produkt-Generierung gelangen.
- Die schon angenommene ADR-010 bleibt gültig: keine Fotos/Videos zum Textmodell senden, keine Bild-/Videoanalyse und keine Bild-/Videoerzeugung in diesem Paket.
- Der konkrete Modellname ist freie Plattform-Admin-Eingabe (zum Beispiel ein freigegebenes GPT-Modell); der Code darf keinen angeblich aktuellen Modellnamen oder Endpoint fest verdrahten.
- Eine Generation erzeugt nur einen `generation_candidate`. Erst die bewusste Aktion **Übernehmen** erzeugt mit Provenienz eine neue immutable `post_version`. Ein Kandidat ist nie veröffentlichbar.
- Reine Textentwürfe dürfen nach Übernahme die vorhandene Freigabe nutzen, aber automatische Veröffentlichung ist nicht Teil dieses Pakets. Vor produktivem Publishing ist die in ADR-010 offene Kennzeichnungsfrage für KI-Text zu entscheiden und zu dokumentieren.

## Current state

- `apps/web/app/pages/plattform-admin/llm.vue:18-95` und `apps/api/src/app.ts:1724-1823` erlauben Plattform-Admins CRUD für `llm_provider_configurations`. Die Tabelle speichert `protocol` (`openai|anthropic`), Basis-URL, Modell, `purpose`, Priorität und einen verschlüsselten Key in `llm_provider_secrets`. Die vorhandene UI erlaubt nur Anlegen, Aktivieren und Entfernen; `purpose`, Priorität und System-Prompt-Override sind dort nicht editierbar.
- `packages/content-engine/src/index.ts:7-50` definiert `GroundedContentBrief`, `ContentGenerator`, `FakeContentGenerator` und `assertGroundedPost`. `FakeContentGenerator` ist der einzige Generator.
- `apps/api/src/app.ts:1183-1407` implementiert den alten synchronen `POST /v1/submissions`-Pfad. Er prüft `post.create`, schreibt eine `submission` und ruft in Zeile 1308 den Fake-Generator auf; bei vollständigen Fakten wird sofort eine `post_version` erzeugt. Dieser Pfad darf nicht als echter KI-Pfad weiterverwendet werden.
- `supabase/migrations/2026081003_text_workshop_foundation.sql` enthält bereits RLS-gesicherte `content_style_profiles`, `composition_sessions`, `generation_candidates` und `post_generation_provenance`. `packages/contracts/src/index.ts:64-138` enthält die Stilprofil- und Kommandoschemas. Es gibt dazu jedoch noch keine API- oder Web-Routen.
- Die fünf System-Stilprofile sind Registry-Daten: `klar_erklaerend`, `warm_gemeinschaftlich`, `lebendig_sportlich`, `leicht_humorvoll`, `feierlich_wertschaetzend`. Eigene, scope-gebundene Stilprofile sind erlaubt; Benutzer mit `post.create` dürfen sie an ihrem Scope anlegen. ADR-010 legt die Prompt-Reihenfolge fest: harte Fakten-/Sicherheitsgrenzen, Stilprofil, bestätigte Quellen, dann begrenzte Änderungsanweisung.
- `apps/worker/src/index.ts`, `apps/worker/src/hatchet.ts` und `packages/orchestration/src/index.ts` dispatchen Outbox-Zeilen an Hatchet. Paket 004 registriert alle allow-gelisteten technischen Workflows mit striktem Zod-ID-Payload, Lease-/Status-CAS und Fairness; der fachliche `generate-text-post`-Executor wird erst in diesem Paket injiziert. Hatchet-Payloads sind IDs und kleine Metadaten, nie Text, Prompt oder Secret.
- Rollen gewähren `post.create` bereits an `contributor`, `editor`, `team_manager` und die Verwaltungsrollen (`packages/authorization/src/index.ts:39-98`). RLS- und negative Isolationstests sind für die Textwerkstatttabellen vorhanden (`supabase/tests/text_workshop_foundation.test.sql`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Contracts and content engine | `pnpm --filter @vereinsfunk/contracts test && pnpm --filter @vereinsfunk/content-engine test` | exit 0 |
| API and worker | `pnpm --filter @vereinsfunk/api test && pnpm --filter @vereinsfunk/worker test` | exit 0 |
| Web | `pnpm --filter @vereinsfunk/web test && pnpm --filter @vereinsfunk/web typecheck` | exit 0 |
| Database isolation | `pnpm db:start && pnpm db:reset && pnpm db:test` | all pgTAP tests pass |
| Full gate | `pnpm check` | lint, typecheck, test and build exit 0 |

## Scope

**In scope**

- `apps/api/src/app.ts` or the corresponding extracted content route, API tests and `apps/api/src/llmProviders.ts`
- `apps/worker/src/{index,workflows,hatchet}.ts` and focused worker tests
- `apps/web/app/pages/{plattform-admin/llm,erstellen,beitraege}.vue`, focused content components/composables and web tests
- `packages/contracts/src/index.ts`, `packages/content-engine/src/*`, `packages/orchestration/src/*` and their tests
- additive Supabase migration(s), `supabase/tests/*`, a new ADR and `docs/product/implementation-plan.md`
- `plans/README.md`

**Out of scope**

- KI-Bild- oder KI-Videoerzeugung, Bild-/Videoverständnis, Video-Rendering, Gesichtserkennung oder das Senden von Medien an einen Provider
- Anbindung konkreter Video-/Bildanbieter oder eine bloße Konfigurationsmaske ohne dazugehörigen sicheren Adapter
- private Medien-Upload-/Normalisierung; das bleibt Plan 002
- automatisches Veröffentlichen oder eine Änderung der Reviewer-Auswahl
- freie, organisationsgesteuerte Systemprompts und das Speichern von Rohprompts, Rohantworten, Zugangsdaten oder vollständigem Beitragstext in Logs/Workflow-Payloads

## Git workflow

- Branch: `codex/plan-033-real-text-generation`
- Commit pro logischem Schritt nach bestehendem Muster, z. B. `Paket 032: Textwerkstatt-Fundament absichern`
- Nicht pushen und keinen PR öffnen, sofern der Operator dies nicht ausdrücklich beauftragt.

## Steps

### Step 1: Provider-Konfiguration in Aufgaben statt in einen impliziten Default überführen

Erweitere die Plattform-Provider-Konfiguration additiv um einen validierten `task_kind`-Wert und explizite, nicht geheime Laufzeitparameter (Temperatur, Tokenlimit, strukturierte Ausgabe erforderlich). Für den Release ist nur `text_generation` aktivierbar; die Verträge dürfen zukünftige `image_generation` und `video_generation` benennen, aber die API weist deren Anlage/Aktivierung ohne implementierten Adapter mit einem maschinenlesbaren Fehler zurück. Ein Resolver wählt genau die aktive Textkonfiguration mit der niedrigsten Priorität; bei keiner oder mehreren gleichrangigen Konfigurationen schlägt die Anfrage kontrolliert fehl.

Erweitere die Admin-Oberfläche um Aufgabe, Priorität, Laufzeitgrenzen, vollständiges Bearbeiten und einen nicht geheimnisoffenlegenden Verbindungstest. Der Test ruft ausschließlich einen serverseitigen, begrenzten Provider-Health-/Capability-Endpunkt auf, speichert keinen Prompt/Antworttext und kann nie den API-Key zurückgeben. Das Entfernen einer von akzeptierter Provenienz referenzierten Konfiguration muss weiterhin durch die FK-Restriktion abgelehnt werden und in der UI verständlich erscheinen.

**Verify**: `pnpm --filter @vereinsfunk/contracts test && pnpm --filter @vereinsfunk/api test && pnpm db:test` → alle bestehenden und neuen Schema-, Admin-, Berechtigungs-, Geheimnis- und Restriktionsfälle bestehen.

### Step 2: Einen fail-closed Structured-Text-Adapter und synthetische Evaluation bauen

Ersetze `FakeContentGenerator` nicht. Ergänze eine injizierbare `StructuredContentGenerator`-Grenze für `text_generation`, zunächst mit einem OpenAI-kompatiblen Adapter. Der Adapter entschlüsselt die gewählte Provider-Konfiguration ausschließlich im Worker, erzwingt eine strukturierte Antwort und parst sie zusätzlich mit den bestehenden Zod-Schemas. Baue die harte Prompt-Schicht in Code in ADR-010-Reihenfolge. Sie enthält nur `GroundedContentBrief`, Stilprofil-Snapshot und maximal 500 Zeichen Änderungsanweisung; sie enthält keine Medien, Secrets oder nicht bestätigten Fakten.

Der Adapter muss vor dem Schreiben `assertGroundedPost` ausführen. Netzwerk-/5xx-/429-Fehler sind klassifiziert und retrybar, Validierungs-/Schema-/ungegroundete Antworten nicht. Logs und Traces enthalten nur Provider-ID, Modell-ID, Session-/Candidate-/Tenant-ID, Latenz, Token-/Kostenzähler und Fehlerklasse. Niemals Caption, Stichpunkte, Prompt, Antwort oder Secret loggen.

Lege synthetische Evaluation-Fixtures an: knappe Stichpunkte, vollständiger Text, fehlende Fakten, verbotener Gegenstand, erforderlicher Hashtag, zwei Systemprofile, ein eigenes Profil und eine Injection-artige Anweisung in Quellmaterial. Prüfe Schema, Quellenreferenzen, No-Go-Phrasen, Qualitätsflags, Kostenobergrenze sowie das fail-closed Verhalten.

**Verify**: `pnpm --filter @vereinsfunk/content-engine test && pnpm --filter @vereinsfunk/api test` → ein ungegroundeter, kaputter oder injektionsbehafteter Provider-Output erzeugt keinen Kandidaten und keine Version.

### Step 3: API für Stilprofile, Kompositionssitzungen und Kandidaten implementieren

Implementiere Zod-validierte API-Routen für:

1. sichtbare System- und passend scope-gebundene Custom-Profile;
2. Erstellen/Aktualisieren eigener Custom-Profile durch einen Benutzer mit `post.create` im Zielscope;
3. Anlegen einer Text-Kompositionssitzung aus Kategorie (`presetSlug`), Kommunikationsziel, Stilprofil/Persona und bestätigtem Material;
4. Start einer Erstgenerierung oder Revision;
5. Laden/Abbrechen eines Kandidaten;
6. bewusste Kandidatenübernahme und manuelles Speichern.

Die API löst und speichert beim Erstellen der Sitzung den Stilprofil- und Quellen-Snapshot sowie den deterministischen Eingabehash. Sie authorisiert Scope-IDs serverseitig, bestätigt `post.create`, prüft die Content-Policy und legt Session plus Outbox-Eintrag in **einer** DB-Transaktion/RPC an. Der alte `POST /v1/submissions` bleibt als historischer Prototyp-Vertrag lesbar, darf für neue Textwerkstattaufrufe aber weder einen Fake-Text noch eine sofortige `post_version` erzeugen.

Die Übernahme eines Kandidaten bzw. ein manueller Save wird als eine RPC-Transaktion implementiert: Versionnummer belegen, neue `post_version` schreiben, `posts.current_version_id` umstellen, `post_generation_provenance` für KI-Kandidaten atomar schreiben, vorherige Freigaben invalidieren und auditieren. Verwende CAS auf Candidate-/Session-Status; zwei gleichzeitige Übernahmen dürfen genau eine neue Version erzeugen.

**Verify**: `pnpm --filter @vereinsfunk/api test && pnpm db:test` → Tests decken `contributor`-Erfolg, `viewer`-Verbot, Scope-/Tenant-Verbot, doppelte Auslösung, konkurrierende Übernahme, Kandidatenabbruch, manuelle Version und die 1:1-Provenienz ab.

### Step 4: Den ID-only `generate-text-post`-Worker registrieren und Betrieb beweisen

Ergänze den Workflownamen/Vertrag nur um `generate-text-post` und optional `revise-text-post`. Der Outbox-Payload enthält Session-ID als `entityId`, Scope-IDs, Quellenrevision, Correlation-ID und Idempotenzschlüssel – keine generierten Inhalte. Registriere im Hatchet-Worker einen dünnen Handler mit der bestehenden LLM-Fairness. Er lädt Session, Snapshot und Provider-Config im Worker, wechselt Session/Candidate per CAS `queued → generating → candidate_ready|failed`, ruft den strukturierten Adapter auf und schreibt ausschließlich den Kandidaten.

Der Handler muss bei wiederholter Zustellung und nach Prozessneustart idempotent sein. Er darf nie als Nebeneffekt eine `post_version` erzeugen. Nutze den in Paket 004 eingeführten `workflow_runs`-Lebenszyklus mit kontrolliertem Status und Fehlerklasse; ergänze den lokalen Nachweis um Kandidat, Retry ohne zweiten Kandidaten und nicht retrybaren Schemafehler.

**Verify**: `pnpm --filter @vereinsfunk/worker test && pnpm --filter @vereinsfunk/api test && pnpm db:test` → ein lokales Integrationsszenario beweist Outbox → Hatchet → Kandidat, Retry ohne zweiten Kandidaten und einen nicht-retrybaren Schemafehler ohne Teilzustand.

### Step 5: Die Textwerkstatt als Mitgliederfluss liefern

Baue `/erstellen` vom alten Drei-Schritt-Fake-Wizard zu einem mobil nutzbaren Textfluss um. Ein Mitglied wählt Anlass/Kategorie, Kommunikationsziel und eines der fünf sichtbaren Stilprofile oder ein passendes eigenes Persona-Profil. Es gibt Stichpunkte, Rohtext oder Fakten/Beobachtungen/Zitate ein. Die UI sendet über den vorhandenen API-Client, zeigt den dauerhaften Sessionstatus und bietet bei einem fertigen Kandidaten Qualitätskarte, Texteditor, „erneut anweisen“, „manuell bearbeiten“, „übernehmen“ und „zur Freigabe“.

Der Client darf keinen Prompt zusammensetzen und nie Providerdaten sehen. Er muss unsent Input lokal, gebunden an Benutzer und Scope, begrenzt speichern und auf Logout/Scopewechsel/Sessionablauf löschen. Ersetze den Leerzustand in `beitraege.vue` durch eine echte Entwurfs-/Wiederaufnahme-Liste mit Deep Link. Medienauswahl bleibt bis zu Plan 002 sichtbar als nicht verfügbar oder wird aus diesem Pilotfluss entfernt – niemals scheinbar erfolgreich hochladen.

**Verify**: `pnpm --filter @vereinsfunk/web test && pnpm --filter @vereinsfunk/web typecheck` → Komponententests beweisen Auswahl, Draft-Recovery/-Löschung, Lade-/Fehler-/Retryzustände, direkte Bearbeitung und dass kein API-Key/Prompt im Browserstate erscheint.

### Step 6: Architekturentscheidung, Produktdokumentation und Pilotbetrieb abschließen

Ergänze eine ADR zur Aufgaben-Routing-Grenze: Text ist der einzige aktivierte Task; künftige Bild-/Videokonfigurationen brauchen vor Aktivierung einen provider-spezifischen Adapter-Spike, Preis-/Rate-Limits, asynchrone Ergebnisabholung, Rechte-/Inhaltsprüfung, Kennzeichnung und Freigabekette. Aktualisiere Produktplan, README und Plan-032-Status so, dass der Textpilot nicht fälschlich Bild-/Videoerzeugung verspricht.

Dokumentiere ein Pilot-Runbook: Provider-Key rotieren, Konfiguration deaktivieren, Provider-Ausfall, Ausgabekostenlimit, Auswertung der Kandidatenqualität und den expliziten Release-Blocker zur rechtlichen KI-Kennzeichnung. Schreibe einen manuellen Abnahmeskript für einen `contributor`: Text aus Stichpunkten → Kandidat → Revision → Übernahme → Freigabe. Nutze ausschließlich synthetische oder ausdrücklich freigegebene Testdaten.

**Verify**: `pnpm check` und `pnpm db:start && pnpm db:reset && pnpm db:test` → exit 0; der Abnahmeskript ist ohne ungeschützte Secrets oder reale Mitgliedsdaten durchführbar.

## Test plan

- Contracts: Aufgabenart, Laufzeitparameter, erlaubte/abgelehnte Provider-Protokolle und Kommandos.
- Content engine: strukturierte Ausgabe, Faktenbindung, Verbote, Stilprofilpriorität, Injection-Resistenz, Fehlerklassifikation und Log-Redaktion.
- API: Plattform-Admin versus Mitglied, sichere Secret-Rotation, aktiver Provider-Resolver, Session/Candidate/CAS, Übernahme und Provenienz.
- Worker: IDs-only Payload, ausgelieferter Hatchet-Handler, Retry, Idempotenz und Stale-Write-Blockade.
- Database: positive und negative RLS-/Scope-/Cross-Tenant-Tests für alle neuen Tabellen/FKs/RPCs; atomare Version plus Provenienz.
- Web: Mobilbreite, Stil-/Persona-Auswahl, Status, Retry, Bearbeitung, Draft-Retention und Scopewechsel.

## Done criteria

- [ ] Ein Plattform-Admin kann einen aktiven `text_generation`-Provider mit Modell, Priorität, Grenzwerten und verschlüsseltem Key verwalten; keine nicht implementierte Bild-/Videoaufgabe lässt sich aktivieren.
- [ ] Ein `contributor` kann aus Kategorie, Stilprofil/Persona und bestätigten Stichpunkten einen echten, strukturierten Textkandidaten erhalten.
- [ ] Der Provider erhält ausschließlich den gespeicherten, bestätigten Textbrief und keine Medien/Secrets; Logs enthalten keine Inhalte.
- [ ] Jede KI-Antwort wird Zod-validiert und faktengebunden; ein Fehler oder ungegroundeter Text kann keinen Kandidaten/keine Version erzeugen.
- [ ] Eine Candidate-Übernahme erzeugt genau eine neue immutable Version mitsamt Provenienz; keine bestehende/freigegebene Version wird verändert.
- [ ] Outbox und Worker transportieren nur IDs/technische Metadaten und überstehen Retry/Doppelzustellung.
- [ ] `pnpm check` sowie Datenbank-RLS-Tests bestehen.
- [ ] Dokumentation benennt KI-Bild/-Video als ausdrücklich nicht geliefert und dokumentiert den Kennzeichnungs-Release-Blocker.

## STOP conditions

- Der lokale Hatchet-Test kann die `generate-text-post`-Ausführung nicht zuverlässig zustellen oder wiederholen. Keine externe Textgenerierung synchron aus Fastify aufrufen; den konkreten Worker-/Executor-Integrationsfehler beheben.
- Der gewählte Provider kann keine strukturierte Ausgabe liefern, die vor Speicherung mit Zod und `assertGroundedPost` fail-closed validiert wird.
- Eine Umsetzung erfordert Medien, vollständige Beiträge oder Secrets im Hatchet-Payload, Browser oder Log.
- Die neue Versions-/Provenienz-Schreibung kann nicht atomar mit einer DB-RPC/Transaktion erfolgen.
- Die rechtliche Entscheidung zur Kennzeichnung verhindert das vereinbarte Freigeben/Veröffentlichen. Kandidatenfluss fertigstellen, aber Publishing-Release blockieren und Entscheidung einholen.
- Eine Bild-/Videoanbieter-Anbindung wird als notwendige Voraussetzung behauptet. Sie ist ein separates Vorhaben mit eigener ADR und eigenem Spike.

## Maintenance notes

- Provider-Konfigurationen sind Plattformressourcen, nie Mandantenkonfigurationen. Der Resolver wählt auf Basis der Aufgabe, Aktivität und Priorität; er darf nicht aus Nutzereingabe oder einem Posttext gesteuert werden.
- Künftige Bild-/Videoaufgaben brauchen eine eigene Adapter-Schnittstelle statt einer Ausweitung des Textadapters. Sie müssen asynchrone Providerjobs, Kostenlimits, Kennzeichnung, Output-Storage und eine neue Freigabeentscheidung behandeln.
- Monitoriere monatlich Kandidatenübernahme, manuelle Editdistanz, Regenerationen, faktengebundene Fehler, Providerlatenz, Kosten und Freigabeablehnungen. Diese Daten verbessern Stilprofile und Evaluationen, nicht die Faktenbindung.
