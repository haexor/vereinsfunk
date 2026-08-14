# Plan 042: LLM-Laufzeitparameter vom Provider zur Sitzung verschieben

> **Executor instructions**: Drei PRs in dieser Reihenfolge. PR 1 ist umgesetzt und gemergt-bereit (**PR #74**) — dieser Plan wurde nachträglich geschrieben, nachdem beim Code-Review von PR #74 auffiel, dass er als einziges Paket keine committete Plandatei hatte. PR 2 und PR 3 setzen auf dem gemergten Stand von PR #74 auf.
>
> **Drift check (run first)**: `git log --oneline -3 -- packages/contracts/src/content.ts packages/contracts/src/platformAdmin.ts supabase/migrations` — der jüngste Commit an diesen Pfaden muss PR #74 (bzw. dessen Review-Fix `6c932e1d`) sein.

## Status

- **Priority**: P2
- **Effort**: M (PR 1 L, PR 2 S, PR 3 M)
- **Risk**: MEDIUM — PR 1 ist ein Breaking Change an den Contracts (`runtimeParameters` entfällt) plus drei Migrationen, davon eine mit `drop function`
- **Depends on**: 033 (Provider-Routing), 040 (Charakter-Modell der Personas), 022 (Plattform-Administration)
- **Category**: architecture, product
- **Planned at**: nachträglich verschriftlicht am 2026-08-14, Stand Commit `6c932e1d`

## Why this matters

`temperature` und `max_output_tokens` standen in `llm_provider_configurations` — also an derselben Zeile wie Endpunkt, Modell und Schlüssel. Damit galt für jeden Beitrag jedes Vereins derselbe Wert, und ihn zu ändern hieß, die Provider-Zeile des SaaS-Betreibers anzufassen. Beides sind aber keine Zugangsmerkmale:

- **`temperature`** ist eine Gestaltungsentscheidung *am einzelnen Beitrag*: wie stark die gewählte Persona-Stimme durchschlagen soll. Das gehört dem Mitglied, das den Beitrag schreibt, nicht dem Betreiber.
- **`max_output_tokens`** ist eine Eigenschaft der *Ziel-Plattform*: ein Instagram-Text darf kürzer ausfallen als ein Facebook-Text. Das gehört einer plattformweiten, betreibergepflegten Vorgabe — nicht dem Provider, der für alle Plattformen derselbe ist.

Ein Provider bleibt danach reine Zugangs- und Routing-Konfiguration (Protokoll, Endpunkt, Modell, Priorität). Das ist die Voraussetzung dafür, dass ein Wechsel des Anbieters keine inhaltliche Änderung an den Beiträgen bedeutet.

## Current state (nach PR 1)

| Wo | Was |
|---|---|
| `llm_provider_configurations` | ohne `temperature`/`max_output_tokens` (Migration `2026081307`) |
| `text_generation_platform_defaults` | neue globale Tabelle, PK `platform` (CHECK `instagram`/`facebook`), `max_output_tokens` 128–4000, für jedes eingeloggte Mitglied lesbar, schreibbar nur über den Service-Role-Client hinter `requirePlatformAdmin` (Migration `2026081308`) |
| `composition_sessions` | neue Spalten `target_platform`, `max_output_tokens`, `temperature` — bei Anlage eingefroren wie `effective_config_snapshot` (Migration `2026081309`) |
| `create_text_generation_session` | drei neue Parameter, mittig eingefügt vor `p_source_revision`; deshalb `drop function` + `create function` statt `create or replace` |
| `POST /v1/text-workshop/sessions` | löst `max_output_tokens` einmal auf: Request-Override > Plattform-Vorgabe > `TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS` (1200) |
| `GET`/`PUT /v1/text-generation-platform-defaults` | vorhanden, aber ohne Konsument — die UI dafür ist PR 2 |
| `TEXT_GENERATION_TEMPERATURE_STEPS` | vier feste Stufen (0.3 Dezent / 0.6 Ausgewogen / 0.8 Ausgeprägt / 1.0 Vollgas) in `packages/contracts/src/content.ts`, Single Source of Truth für DB-CHECK, API-Validierung und den Regler aus PR 3 |
| `apps/web/app/pages/plattform-admin/llm.vue` | Temperatur-Select und Max.-Tokens-Feld entfernt (rein mechanisch, sonst hätte PR 1 nicht gebaut) |
| `apps/web/app/pages/erstellen.vue` | **unverändert** — schickt weder `temperature` noch `targetPlatform`, bekommt also überall den Vorgabewert 0.6 und 1200 |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |
| DB-Tests | `pnpm db:start && pnpm db:reset && pnpm db:test` | exit 0, alle pgTAP-Dateien grün |
| Web-Teilgate | `cd apps/web && pnpm typecheck && pnpm test` | exit 0 |

## PR 1: Migration, Contracts, API und Worker (umgesetzt, PR #74)

Umfang wie unter „Current state" beschrieben. Vollständig grün verifiziert (lint/typecheck/test/build sowie `db:reset`/`db:test`, 744 pgTAP-Tests).

### Abweichungen von der ursprünglichen Ausplanung

1. **`drop function` statt `create or replace`.** Die drei neuen Parameter werden mittig eingefügt (vor `p_source_revision`), nicht angehängt. Postgres erkennt das nicht als Ersatz — ohne vorheriges `drop` wäre eine zweite, überladene Funktion mit der alten Signatur stehen geblieben. Dasselbe Muster verwendet `2026081204_generation_candidate_triggered_by.sql` bereits für denselben Fall.
2. **`llm.vue` musste in PR 1 mit.** Der Plan ordnete diese Datei PR 3 zu; da `runtimeParameters` aber aus den Contracts verschwindet, hätte `pnpm typecheck`/`build` schon in PR 1 gebrochen. Nur Entfernen des Nicht-mehr-Vorhandenen, keine neue Funktionalität.

### Nachträge aus dem Code-Review (Commit `6c932e1d`)

1. **`input_hash` umfasst jetzt `targetPlatform`/`maxOutputTokens`/`temperature`.** Kritischer Fund: `create_text_generation_session` gibt für einen bereits bekannten Hash über den `if found`-Zweig die vorhandene Sitzung **samt Kandidat** zurück und ignoriert die übergebenen Laufzeitwerte. Ohne die drei Felder im Hash lieferte ein zweites Absenden desselben Materials mit anderer Regler-Stufe stillschweigend den alten Kandidaten — die neue Stufe war nirgends gespeichert und, weil die Sitzung ihre Werte einfriert, auch über `revise` nicht mehr erreichbar. Gehasht wird die *Anfrage*, nicht der serverseitig aufgelöste Token-Wert, damit ein echter Wiederholungsversuch idempotent bleibt. Regressionstest: `content.routes.test.ts` → „gives a session a distinct input hash per temperature step and target platform".
2. **`PUT /…/:platform`** nutzt `maybeSingle()` + 404 statt `single()` (das auf einem UPDATE ohne Trefferzeile einen 500 aus PGRST116 erzeugt hätte).
3. **`TextGenerationPlatformSchema` ist exportiert** und wird in `platformAdmin.ts`, der Route und beiden Worker-Dateien benutzt. Vorher gab es vier Kopien von `instagram`/`facebook`, und das Schema der Plattform-Vorgaben hing an `SocialPlatformSchema` der **Kanal**-Domäne — deren Erweiterung um einen neuen Kanal hätte die Route Werte annehmen lassen, für die es in der Tabelle keine Zeile gibt.
4. **Token-Spanne (`MaxOutputTokensSchema`) und beide Vorgabewerte** stehen einmal in den Contracts; der Temperatur-Default wird aus der Stufenliste gelesen statt als zweites `0.6`-Literal geschrieben.
5. **`GET /v1/text-workshop/sessions/:id`** gibt die eingefrorenen Werte mit aus; sie waren sonst nur per direkter DB-Abfrage sichtbar.
6. **Routentests** für beide neuen Endpunkte und die vollständige `max_output_tokens`-Auflösung (beide Endpunkte hatten null Abdeckung).

### Bewusste Nicht-Entscheidung: keine Datenmigration der alten Provider-Werte

`2026081307` verwirft die konfigurierten Werte, `2026081309` befüllt bestehende Sitzungen mit 0.6/1200. Kein Backfill trägt die echten Werte weiter, und das bleibt so:

- **`temperature`**: der bisherige Vorgabewert 0.2 ist in der neuen Vier-Stufen-Skala **kein legaler Wert mehr** (CHECK `in (0.3, 0.6, 0.8, 1.0)`). Er ist nicht übertragbar, egal wie sorgfältig migriert wird.
- **`max_output_tokens`**: der Seed 1200 entspricht dem bisherigen Vorgabewert. Ein davon abweichender, vom Betreiber gesetzter Wert (z. B. 400 als Kostendeckel) geht verloren, ist aber über die Vorgaben-UI aus PR 2 wieder eintragbar — von genau der Person, die ihn gesetzt hat.

Wer PR 1 in Produktion bringt, sollte den alten Wert vorher notieren, wenn er von 1200 abwich.

## PR 2: Plattform-Vorgaben verwalten

Die API-Hälften existieren seit PR 1 und haben keinen Konsumenten. PR 2 baut die UI dazu.

### Step 1: Vorgaben-Abschnitt in `plattform-admin/llm.vue`

Eigener Abschnitt unter der Provider-Tabelle: je Plattform (`instagram`, `facebook`) eine Zeile mit `max_output_tokens` als Zahlenfeld (min 128, max 4000, aus `MaxOutputTokensSchema`) und Speichern-Knopf pro Zeile, plus Anzeige von `updatedAt`. Laden über `GET /v1/text-generation-platform-defaults`, schreiben über `PUT /v1/text-generation-platform-defaults/:platform`. Der 404-Fall aus dem Review-Fix braucht eine eigene Meldung („Für diese Plattform ist keine Vorgabe angelegt") — er tritt nur auf, wenn eine späte Migration die Plattform-Menge erweitert, ohne zu befüllen.

Der Abschnitt gehört bewusst neben die Provider und nicht in `plattform-admin/einstellungen.vue`: er hängt fachlich an der Textgenerierung, nicht an den globalen `platform_settings`.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0. Manuell: Wert auf 800 ändern, neu laden, Wert steht; `updatedAt` hat sich bewegt. Als Nicht-Plattform-Admin ist die Seite ohnehin nicht erreichbar.

### Step 2: Formulierung ohne Anbieter-Jargon

„Max. Ausgabe-Tokens" ist Betreiber-UI, darf also technisch bleiben — aber mit einem Satz, was der Wert bewirkt („Obergrenze für die Länge eines erzeugten Textes je Ziel-Plattform; unkalibrierter Platzhalter, 1200 entspricht dem bisherigen globalen Wert"). Kundenseitige Grenzen bleiben von Tokens frei (siehe Paket 021).

**Verify**: `pnpm lint` → exit 0.

## PR 3: Regler am Beitrag

### Step 1: Sichtbarkeit der Temperatur klären — `GET /v1/text-generation-capabilities`

**Entscheidung des Betreibers (2026-08-14):** Wenn für die Textgenerierung ein Anbieter mit dem `anthropic`-Protokoll aktiv ist, wird der Regler **ausgegraut oder gar nicht angezeigt**. Der Adapter sendet `temperature` bewusst nicht (aktuelle Claude-Modelle lehnen den Parameter mit 400 ab, und im Abo-Modus des Proxys gäbe es ohnehin keinen Regler dafür — siehe `AnthropicStructuredContentGenerator` in `packages/content-engine/src/index.ts`). Ein bedienbarer Regler ohne Wirkung wäre irreführend; genau dieser Hinweis existierte in der alten Provider-UI (`usesTemperature`) und ist mit ihr verschwunden.

Das Frontend kann das Protokoll heute nicht sehen: `GET /v1/llm-providers` steht hinter `requirePlatformAdmin`, und die Textwerkstatt benutzt ein normales Mitglied. Deshalb eine neue, schmale Leseroute analog zu `GET /v1/text-generation-platform-defaults` (nur `requireAuth`):

```
GET /v1/text-generation-capabilities → { temperatureSupported: boolean }
```

Serverseitig abgeleitet aus dem Protokoll des aktiven `text_generation`-Providers (`is_active`, kleinste `priority`) — dieselbe Auswahl, die der Worker in `loadActiveTextProvider` trifft. Bewusst **nur ein Boolean**: die Antwort verrät weder Anbieter noch Endpunkt noch Modell, nur ob die Stufenwahl etwas bewirkt. Ist kein Provider aktiv, ist `temperatureSupported` `false` — dann lässt sich ohnehin kein Beitrag erzeugen.

Nicht über die Plattform-Vorgaben-Route mitliefern: die trägt Zeilen je Plattform, die Fähigkeit ist global.

**Verify**: Routentest in `apps/api` — `temperatureSupported: false` für einen `anthropic`-Provider, `true` für `openai`, `false` bei leerer Providerliste; erreichbar für ein einfaches Mitglied ohne Plattform-Admin-Rechte.

### Step 2: Regler in `erstellen.vue`

Vier Stufen aus `TEXT_GENERATION_TEMPERATURE_STEPS` (Label + `hint` als Erklärtext), Vorauswahl `TEXT_GENERATION_DEFAULT_TEMPERATURE`. `temperature` wandert in den Body von `POST /v1/text-workshop/sessions` (Zeile 69). Ist `temperatureSupported` `false`, wird der Regler nicht gerendert und **kein** `temperature` mitgeschickt — dann greift der Vorgabewert im Schema, und die Sitzung friert einen Wert ein, den der Adapter nicht benutzt (siehe Step 4).

Die Stufen sind bewusst benannt, nicht als Zahl gezeigt: die Zahl ist ein Anbieter-Detail (vgl. Paket 021, „kundenseitige Grenzen ohne Jargon").

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0. Manuell: zweimal denselben Entwurf mit unterschiedlicher Stufe absenden — es entstehen **zwei** Sitzungen mit unterschiedlichem Text (das ist der Fund aus dem Review-Fix von PR 1; ohne ihn hätte der zweite Versuch stumm den ersten Kandidaten geliefert).

### Step 3: `targetPlatform` am Beitrag

Offen und bewusst noch nicht entschieden: `targetPlatform` dient heute ausschließlich der `max_output_tokens`-Auflösung, echtes Pro-Plattform-Rendering ist Paket 005. Zwei Möglichkeiten:

- **(a) Nicht anzeigen**, `targetPlatform` bleibt `null`, jeder Beitrag läuft auf dem Fallback 1200. Die Plattform-Vorgaben aus PR 2 wären dann bis Paket 005 wirkungslos.
- **(b) Auswahl anzeigen** („Wofür schreibst du?" Instagram/Facebook), damit die Vorgabe greift. Kostet ein zusätzliches Feld in einem Formular, das bewusst kurz ist, und verspricht mehr Plattform-Spezifik als das System liefert (der Text unterscheidet sich nur in der Länge).

**Empfehlung: (b)**, aber ohne Plattform-Versprechen formuliert — die Auswahl steuert die Textlänge, nicht das Format. Sonst hat PR 2 keinen wirksamen Effekt und niemand merkt, wenn die Vorgabe falsch gepflegt ist. Entscheidung vor Beginn von PR 3 einholen.

**Verify**: hängt von der Entscheidung ab. Bei (b): eine Sitzung je Plattform erzeugen und in `composition_sessions.max_output_tokens` prüfen, dass die Vorgabe der jeweiligen Plattform eingefroren wurde.

### Step 4: Provenienz nicht lügen lassen

`post_generation_provenance.provider_parameter_hash` soll die „tatsächlich benutzten" Parameter hashen. `parameterHash` in `apps/worker/src/textGeneration.ts` nimmt heute immer `session.temperature` auf — auch beim `anthropic`-Protokoll, das den Wert nie sendet. Das ist eine falsche Provenienz-Angabe.

Fix: `temperature` nur in den Hash aufnehmen, wenn der gewählte Adapter sie sendet (dieselbe Protokollprüfung wie in Step 1, im Worker direkt am `provider.protocol` verfügbar). Der Hash bleibt für OpenAI-kompatible Provider unverändert; für `anthropic`-Provider ändert er sich einmalig — das ist korrekt, weil er bisher etwas Falsches behauptete.

**Verify**: Worker-Test in `apps/worker/src/textGeneration.test.ts` — zwei Sitzungen mit unterschiedlicher `temperature` auf einem `anthropic`-Provider erzeugen denselben `provider_parameter_hash`, auf einem `openai`-Provider unterschiedliche.

## Done criteria

- [x] `llm_provider_configurations` trägt keine Laufzeitparameter mehr; ein Provider ist reine Zugangs-/Routing-Konfiguration (PR 1)
- [x] `composition_sessions` friert `target_platform`/`max_output_tokens`/`temperature` bei Anlage ein, und alle drei sind Teil des `input_hash` (PR 1 + Review-Fix)
- [x] `text_generation_platform_defaults` existiert, ist für jedes Mitglied lesbar und nur für Plattform-Admins schreibbar (PR 1)
- [ ] Ein Plattform-Admin kann die Vorgabe je Plattform in der Oberfläche pflegen (PR 2)
- [ ] Ein Mitglied wählt die Persona-Intensität am Beitrag; bei einem `anthropic`-Provider ist die Wahl nicht sichtbar statt wirkungslos bedienbar (PR 3)
- [ ] `provider_parameter_hash` enthält `temperature` nur, wenn sie gesendet wurde (PR 3)
- [ ] Voller Gate plus `db:test` grün nach jedem PR

## STOP conditions

- **Eine weitere eingefrorene Spalte auf `composition_sessions` landet, ohne in den `input_hash` zu wandern.** Dann wiederholt sich der Fund aus dem Review-Fix von PR 1: der Wiederverwendungszweig des RPC ignoriert die Parameter stumm, und die neue Nutzereingabe ist unerreichbar.
- **Die vier Stufen werden geändert oder erweitert**, ohne den CHECK in `2026081309` und `TEXT_GENERATION_TEMPERATURE_STEPS` gemeinsam anzufassen — die API akzeptiert sonst einen Wert, den die Datenbank mit 23514 zurückweist.
- **`text_generation_platform_defaults` bekommt eine dritte Plattform**, ohne dass `TextGenerationPlatformSchema`, der CHECK der Tabelle, der CHECK auf `composition_sessions.target_platform` **und** ein Seed für die neue Zeile mitgezogen werden.
- **PR 3 rendert den Regler, ohne `temperatureSupported` auszuwerten** — das ist genau der irreführende Zustand, den Step 1 verhindert.

## Maintenance notes

**Warum die Labels bewusst wertend sind — und was daran riskant bleibt.** Die vier Stufen heißen „Dezent" bis „Vollgas" und versprechen Persona-Intensität. Technisch ist `temperature` aber Sampling-Entropie: höhere Werte machen die Wortwahl unvorhersehbarer, nicht die Persona treuer. Das hat eine messbare Nebenwirkung in diesem System, weil jeder erzeugte Beitrag hart gegen sein Quellmaterial geprüft wird: `assertGroundedPost` (`packages/content-engine/src/index.ts:67`) weist einen Kandidaten ab, sobald er eine `generatedClaims.sourceId` außerhalb von `brief.allowedClaims` trägt oder eine verbotene Formulierung enthält — als `ContentGenerationError('ungrounded', false)`, also **nicht wiederholbar**: der Kandidat geht direkt auf `failed`, ohne zweiten Versuch. Und jeder Versuch verbraucht einen der acht Slots aus `composition_sessions.candidate_count` (Paket 035). Ein Mitglied, das nach den Labels die attraktivste Stufe wählt, bekommt damit die höchste Fehlerrate und verliert am schnellsten sein Überarbeitungsbudget, ohne dass die Oberfläche einen Zusammenhang zur Reglerstellung herstellt.

Bewusst so belassen, weil die Alternative (nur „Ausgewogen"/„Ausgeprägt" anbieten) dem Mitglied eine echte Gestaltungsmöglichkeit nimmt. Wenn PR 3 in Betrieb ist, sollte die `failure_code = 'ungrounded'`-Rate je Stufe geprüft werden — steigt sie bei 1.0 auffällig, ist entweder die Stufe zu entfernen oder ein `ungrounded`-Fehlschlag darf den Slot nicht verbrauchen. Für diese Prüfung reicht `generation_candidates.failure_code` zusammen mit `composition_sessions.temperature`; beides ist seit PR 1 vorhanden.

**Namenswahl `text_generation_platform_defaults`.** Nicht `platform_...`: dieses Präfix bedeutet im Projekt durchgängig „Plattform-Administration/SaaS-Betreiber" (`platform_admins`, `platform_style_personas`), nie „Social-Media-Plattform".

**`TextGenerationPlatformSchema` vs. `SocialPlatformSchema`.** Zwei identische Wertemengen, absichtlich getrennt: die eine beschreibt, wofür die Textwerkstatt Vorgaben kennt, die andere, welche Kanäle der Verein anbinden kann. Ein neuer Kanal in der Kanal-Domäne darf nicht automatisch eine Vorgabezeile voraussetzen. `channels.ts` importiert `UuidSchema` aus `content.ts`, ein Import in die andere Richtung wäre außerdem ein Zyklus.
