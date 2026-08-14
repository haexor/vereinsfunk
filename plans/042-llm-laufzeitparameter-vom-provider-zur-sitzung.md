# Plan 042: LLM-Laufzeitparameter vom Provider zur Sitzung verschieben

> **Executor instructions**: Drei PRs in dieser Reihenfolge. PR 1 ist umgesetzt und gemergt-bereit (**PR #74**) — dieser Plan wurde nachträglich geschrieben, nachdem beim Code-Review von PR #74 auffiel, dass er als einziges Paket keine committete Plandatei hatte. PR 2 und PR 3 setzen auf dem gemergten Stand von PR #74 auf.
>
> **Drift check (run first)**: `git log --oneline -3 -- packages/contracts/src/content.ts packages/contracts/src/platformAdmin.ts supabase/migrations` — der jüngste Commit an diesen Pfaden muss vom Branch `worktree-paket-042-llm-runtime-params` (PR #74) stammen. Ein einzelner Commit-Hash reicht dafür nicht als Referenz, weil der Branch nach dem Review-Fix noch mehrfach fortgeschrieben wurde (`67423ef7`, danach weitere Commits vom 14. August 2026) — gegen den PR-Branch bzw. dessen main-Stand nach dem Merge prüfen, nicht gegen eine einzelne Review-Fix-Revision.

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
- **Die Längengrenze** ist eine Eigenschaft der *Ziel-Plattform*: ein Instagram-Text darf höchstens 2200 Zeichen haben, ein Tweet 280. Das gehört einer plattformweiten, betreibergepflegten Vorgabe — nicht dem Provider, der für alle Plattformen derselbe ist. Und es ist eine **Zeichen**-Grenze: die Plattform weist einen zu langen Beitrag ab, ein Token-Budget lässt sich darauf nicht verlässlich umrechnen.

Weil ein Verein denselben Beitrag üblicherweise auf mehreren Plattformen veröffentlicht, wählt der Ersteller **mehrere** Ziel-Plattformen — und nur solche, auf die sein Scope tatsächlich veröffentlichen kann (PR 3, Step 3). Das ergibt genau **einen** Text, dessen Länge sich nach der **knappsten** Auswahl richtet, und dieser eine Text wird auf allen gewählten Plattformen gleich veröffentlicht. Das gilt unabhängig davon, wie weit die Grenzen auseinanderliegen: Blog und X zusammen ergeben einen Beitrag mit 280 Zeichen. Wer je Plattform einen eigenen Text will, erzeugt je Plattform eine eigene Sitzung mit nur dieser Plattform (Betreiberentscheidung vom 2026-08-14, siehe PR 3, Step 4).

Ein Provider bleibt danach reine Zugangs- und Routing-Konfiguration (Protokoll, Endpunkt, Modell, Priorität). Das ist die Voraussetzung dafür, dass ein Wechsel des Anbieters keine inhaltliche Änderung an den Beiträgen bedeutet.

## Current state (nach PR 1)

| Wo | Was |
|---|---|
| `llm_provider_configurations` | ohne `temperature`/`max_output_tokens` (Migration `2026081307`) |
| `text_generation_platform_defaults` | neue globale Tabelle, PK `platform` (CHECK `instagram`/`facebook`), `max_characters` 100–10000 (Seed je 2200), für jedes eingeloggte Mitglied lesbar, schreibbar nur über den Service-Role-Client hinter `requirePlatformAdmin` (Migration `2026081308`) |
| `composition_sessions` | neue Spalten `target_platforms` (`text[]`, Teilmenge von instagram/facebook, ohne Duplikate), `max_characters`, `temperature` — bei Anlage eingefroren wie `effective_config_snapshot` (Migration `2026081309`) |
| `create_text_generation_session` | drei neue Parameter, mittig eingefügt vor `p_source_revision`; deshalb `drop function` + `create function` statt `create or replace` |
| `POST /v1/text-workshop/sessions` | löst `max_characters` einmal auf: Request-Override > **kleinste** Vorgabe der gewählten Plattformen > `TEXT_GENERATION_DEFAULT_MAX_CHARACTERS` (2200). Ohne Angabe sind beide Plattformen vorausgewählt. Prüft noch **nicht**, ob der Scope auf die Plattform veröffentlichen kann (PR 3, Step 3) |
| `GET`/`PUT /v1/text-generation-platform-defaults` | vorhanden, aber ohne Konsument — die UI dafür ist PR 2 |
| `TEXT_GENERATION_TEMPERATURE_STEPS` | vier feste Stufen (0.3 Dezent / 0.6 Ausgewogen / 0.8 Ausgeprägt / 1.0 Vollgas) in `packages/contracts/src/content.ts`, Single Source of Truth für DB-CHECK, API-Validierung und den Regler aus PR 3 |
| `apps/web/app/pages/plattform-admin/llm.vue` | Temperatur-Select und Max.-Tokens-Feld entfernt (rein mechanisch, sonst hätte PR 1 nicht gebaut) |
| `apps/web/app/pages/erstellen.vue` | **unverändert** — schickt weder `temperature` noch `targetPlatforms`, bekommt also die Vorgaben 0.6 und beide Plattformen (Länge = min der beiden Vorgaben) |
| `buildStructuredTextPrompt` | nennt die Zeichengrenze im System-Prompt (`maxCharacters`, optional — der Preview-Pfad hat keine). Eine harte Prüfung nach der Generierung fehlt noch |

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

1. **`input_hash` umfasst jetzt `targetPlatforms`/`maxOutputTokens`/`temperature`.** Kritischer Fund: `create_text_generation_session` gibt für einen bereits bekannten Hash über den `if found`-Zweig die vorhandene Sitzung **samt Kandidat** zurück und ignoriert die übergebenen Laufzeitwerte. Ohne die drei Felder im Hash lieferte ein zweites Absenden desselben Materials mit anderer Regler-Stufe stillschweigend den alten Kandidaten — die neue Stufe war nirgends gespeichert und, weil die Sitzung ihre Werte einfriert, auch über `revise` nicht mehr erreichbar. Gehasht wird die *Anfrage*, nicht der serverseitig aufgelöste Token-Wert, damit ein echter Wiederholungsversuch idempotent bleibt. Die Plattformliste geht **sortiert** in den Hash, sonst erzeugte dieselbe Auswahl je nach Reihenfolge der Häkchen zwei Sitzungen. Regressionstest: `content.routes.test.ts` → „gives a session a distinct input hash per temperature step and platform selection".
2. **`PUT /…/:platform`** nutzt `maybeSingle()` + 404 statt `single()` (das auf einem UPDATE ohne Trefferzeile einen 500 aus PGRST116 erzeugt hätte).
3. **`TextGenerationPlatformSchema` ist exportiert** und wird in `platformAdmin.ts`, der Route und beiden Worker-Dateien benutzt. Vorher gab es vier Kopien von `instagram`/`facebook`, und das Schema der Plattform-Vorgaben hing an `SocialPlatformSchema` der **Kanal**-Domäne — deren Erweiterung um einen neuen Kanal hätte die Route Werte annehmen lassen, für die es in der Tabelle keine Zeile gibt.
4. **Token-Spanne (`MaxOutputTokensSchema`) und beide Vorgabewerte** stehen einmal in den Contracts; der Temperatur-Default wird aus der Stufenliste gelesen statt als zweites `0.6`-Literal geschrieben.
5. **`GET /v1/text-workshop/sessions/:id`** gibt die eingefrorenen Werte mit aus; sie waren sonst nur per direkter DB-Abfrage sichtbar.
6. **Routentests** für beide neuen Endpunkte und die vollständige `max_output_tokens`-Auflösung (beide Endpunkte hatten null Abdeckung).

### Nachjustierung nach Rückmeldung (2026-08-14, zweite Runde)

Zwei Entscheidungen aus dem Review-Fix wurden nach Rückmeldung des Betreibers korrigiert, noch vor dem Merge — beides an einer unveröffentlichten Migration, also ohne Folge-Migration:

1. **`max_output_tokens` → `max_characters`.** Das Token-Budget war als Plattform-Grenze der falsche Hebel (siehe „Maintenance notes"). `text_generation_platform_defaults` und `composition_sessions` tragen jetzt eine Zeichengrenze (100–10000, Seed 2200 = Instagrams echte Bildtext-Grenze), die Route bildet das Minimum über die gewählten Plattformen, und `buildStructuredTextPrompt` nennt die Grenze im System-Prompt. Das Modell-Budget ist eine globale Konstante geblieben. Nebenwirkung: `GeneratedPostSchema.caption` von 1800 auf 2200 angehoben, damit es nicht unter der Plattform-Vorgabe liegt (und damit zu `PlatformVariantSchema.caption` passt, das schon 2200 hatte).
2. **Eine Plattform-Menge statt zwei.** `TextGenerationPlatformSchema` wurde wieder entfernt; `SocialPlatformSchema` liegt jetzt in `primitives.ts` und wird von der Kanal-Domäne, den Contracts der Textwerkstatt, der API und dem Worker gemeinsam benutzt. Begründung im Detail unter „Maintenance notes".

### Bewusste Nicht-Entscheidung: keine Datenmigration der alten Provider-Werte

`2026081307` verwirft die konfigurierten Werte, `2026081309` befüllt bestehende Sitzungen mit `temperature = 0.6` und `max_characters = 2200`. Kein Backfill trägt die echten Werte weiter, und das bleibt so:

- **`temperature`**: der bisherige Vorgabewert 0.2 ist in der neuen Vier-Stufen-Skala **kein legaler Wert mehr** (CHECK `in (0.3, 0.6, 0.8, 1.0)`). Er ist nicht übertragbar, egal wie sorgfältig migriert wird.
- **`max_characters`**: der Seed 2200 ist Instagrams echte Bildtext-Grenze, nicht der bisherige `max_output_tokens`-Wert des Providers — seit der Nachjustierung oben sind das ohnehin verschiedene Einheiten. Ein vom Betreiber abweichend gesetzter `max_output_tokens`-Wert (z. B. 400 als Kostendeckel) geht ersatzlos verloren; `TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS` bleibt als globale Konstante bei 1200. Die Zeichengrenze je Plattform ist über die Vorgaben-UI aus PR 2 pflegbar — von genau der Person, die sie braucht.

Wer PR 1 in Produktion bringt, sollte einen von 1200 abweichenden `max_output_tokens`-Wert vorher notieren.

## PR 2: Plattform-Vorgaben verwalten (umgesetzt)

Die API-Hälften existieren seit PR 1 und haben keinen Konsumenten. PR 2 baut die UI dazu.

Umgesetzt wie unten beschrieben, vollständig grün verifiziert (lint/typecheck/test/build) und per Playwright manuell durchgespielt: Instagram-Zeichengrenze auf 1500 gesetzt, gespeichert, neu geladen (Wert blieb, `updatedAt` bewegte sich), danach auf 2200 zurückgesetzt, um keine Testdaten in der lokalen DB zu hinterlassen.

### Step 1: Vorgaben-Abschnitt in `plattform-admin/llm.vue`

Eigener Abschnitt unter der Provider-Tabelle: je Plattform (`instagram`, `facebook`) eine Zeile mit `max_characters` als Zahlenfeld (100–10000, aus `MaxCharactersSchema`) und Speichern-Knopf pro Zeile, plus Anzeige von `updatedAt`. Laden über `GET /v1/text-generation-platform-defaults`, schreiben über `PUT /v1/text-generation-platform-defaults/:platform`. Der 404-Fall aus dem Review-Fix braucht eine eigene Meldung („Für diese Plattform ist keine Vorgabe angelegt") — er tritt nur auf, wenn eine späte Migration die Plattform-Menge erweitert, ohne zu befüllen.

Der Abschnitt gehört bewusst neben die Provider und nicht in `plattform-admin/einstellungen.vue`: er hängt fachlich an der Textgenerierung, nicht an den globalen `platform_settings`.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0. Manuell: Wert auf 1500 ändern, neu laden, Wert steht; `updatedAt` hat sich bewegt. Als Nicht-Plattform-Admin ist die Seite ohnehin nicht erreichbar.

### Step 2: Formulierung ohne Anbieter-Jargon

Die Zeichengrenze ist bereits jargonfrei, braucht aber einen Satz, was der Wert bewirkt („Obergrenze für die Länge eines erzeugten Textes auf dieser Plattform; 2200 entspricht Instagrams Bildtext-Grenze"). Kundenseitige Grenzen bleiben von Tokens frei (siehe Paket 021).

**Verify**: `pnpm lint` → exit 0.

## PR 3: Regler am Beitrag (Steps 1/2/3/5 umgesetzt)

Steps 1, 2, 3 und 5 sind umgesetzt wie unten beschrieben, vollständig grün verifiziert (lint/typecheck/test/build sowie `db:reset`/`db:test`, 746 pgTAP-Tests — PR 3 selbst braucht keine Migration) und per Playwright manuell durchgespielt: ohne aktiven Provider/Kanal ist der Regler unsichtbar und beide Plattformen ausgegraut; mit einem aktiven `openai`-Provider erscheinen alle vier Stufen samt Hinweistext; nach Anlegen eines Instagram-Kanals ist Instagram anhakbar und vorausgewählt, Facebook bleibt ausgegraut; eine angelegte Sitzung trägt `target_platforms`/`temperature`/`max_characters` korrekt in der Datenbank. Step 4 bleibt wie geplant außerhalb von Paket 042.

**Reihenfolge der Prüfungen in `POST /v1/text-workshop/sessions`:** Die Plattform-Verfügbarkeitsprüfung sitzt bewusst NACH der Stilprofil-/Persona-Auflösung (nicht direkt nach `preset_not_allowed`), damit ein unbekannter `personaSlug` weiterhin sein eigenes 404 liefert, statt von der Plattformprüfung überdeckt zu werden.

**Ergänzung zum Plan:** `resolveTextGenerationPlatformAvailability` (routes/shared.ts) bündelt die Abfrage von `social_connections`/`channel_scopes`/`policy_settings`/`text_generation_platform_defaults` in einer Funktion und wird von `GET /v1/text-generation-platforms` UND von `POST /v1/text-workshop/sessions` (Durchsetzung) gemeinsam genutzt — dieselbe Abfrage liefert nebenbei `maxCharacters` je Plattform, wodurch die vorher separate `text_generation_platform_defaults`-Abfrage in der Sitzungs-Anlage entfällt.

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

### Step 3: Plattform-Auswahl am Beitrag, begrenzt auf das Veröffentlichbare

> **Die automatische Vorauswahl ist überholt.** Aufgehoben durch Betreiberentscheidung vom 2026-08-14, aus derselben Design-Sitzung nach dem Code-Review von PR #76 wie Step 4 — siehe `plans/044-zielplattformen-vorgaben-und-harte-laengengrenze.md`, PR 1. „Beide vorausgewählt“ war die zum Merge-Zeitpunkt umgesetzte und verifizierte Vorgabe (siehe unten), gilt aber nicht mehr als Ziel: keine Plattform ist ab Werk angehakt, Verein/Abteilung setzen stattdessen eigene Vorgaben, sonst startet die Auswahl leer.

**Entschieden (2026-08-14):** Der Ersteller wählt die Ziel-Plattformen direkt im Formular, Mehrfachauswahl, beide vorausgewählt. Angezeigt werden aber **nur Plattformen, auf die dieser Scope überhaupt veröffentlichen kann** — der Verein richtet Kanäle ein, eine Abteilung darf sie (wenn der Vereinsadmin es erlaubt) um eigene erweitern oder weiter einschränken. Eine Plattform anzubieten, für die kein Kanal existiert, erzeugt einen Beitrag, der nie veröffentlicht werden kann.

Das ist die „Plattform-Fähigkeitsprüfung vor Generierung", die Plan 032 als offen markiert hat.

Dafür fehlt eine Leseroute: die Kanäle liegen in `channels` (Paket 012), ihre Delegation/Einschränkung in den `policy_settings` des Scopes (Paket 011/023). Vorschlag, analog zur Fähigkeits-Route aus Step 1:

```
GET /v1/text-generation-platforms?organizationId&departmentId&teamId
  → [{ platform, available: boolean, maxCharacters, reason?: 'no_channel' | 'restricted_by_policy' }]
```

Eine Route statt zweier, weil das Formular beides zusammen braucht: was anhakbar ist **und** welche Länge daraus folgt. `available: false` wird ausgegraut angezeigt, nicht versteckt — sonst rätselt ein Mitglied, warum Facebook fehlt, und niemand merkt, dass ein Kanal fehlt.

Serverseitig durchsetzen, nicht nur anzeigen: `POST /v1/text-workshop/sessions` muss `targetPlatforms` gegen dieselbe Auflösung prüfen und mit 422 `platform_not_available` ablehnen. Die Anzeige ist Bequemlichkeit, die Prüfung ist die Regel (vgl. „Berechtigungen aus einer Quelle").

**Verify**: Routentests — ein Scope ohne Facebook-Kanal bekommt `available: false` für Facebook, und ein `POST` mit `targetPlatforms: ['facebook']` wird 422. Manuell in `/erstellen`: Kanal in `/kanaele` entfernen, Formular neu laden, Plattform ist ausgegraut.

### Step 4: ~~Getrennte Texte bei stark abweichender Länge~~ — verworfen

> **Aufgehoben durch Betreiberentscheidung vom 2026-08-14 (nach dem Code-Review von PR #76).** Der ursprüngliche Text steht unten zur Nachvollziehbarkeit; er ist **nicht mehr die Vorgabe**.

**Die min()-Regel ist die Absicht, nicht die Notlösung.** Wer mehrere Plattformen gemeinsam anhakt, will ausdrücklich **einen** Beitrag, der auf allen erscheint — dann gilt die Grenze des restriktivsten Mediums, und derselbe Text wird überall so veröffentlicht. Blog und X zusammen ergeben also einen Beitrag mit 280 Zeichen. Das ist kein Kompromiss, den man später reparieren müsste, sondern das gewünschte Verhalten.

Wer je Plattform einen eigenen Text will, **erzeugt je Plattform eine eigene Sitzung** mit nur dieser einen Plattform in der Auswahl. Das funktioniert heute schon vollständig: `target_platforms` steckt im `input_hash` (Review-Fix zu PR 1), dieselbe Materialbasis mit anderer Plattformauswahl ist deshalb eine **neue** Sitzung und kein Dedup-Treffer. Jede Sitzung führt zu ihrer eigenen `post_version` und damit zu ihrer eigenen Freigabe.

Damit lösen sich beide Folgefragen des alten Step 4 ersatzlos auf:

- **`GeneratedPostSchema.variants` bleibt leer.** Kein Kandidat mit mehreren Varianten aus einem Provider-Aufruf, keine Abhängigkeit auf Paket 005 an dieser Stelle.
- **Die Freigabekette bleibt unverändert.** Die offene Frage „eine gemeinsame Freigabe oder je eine eigene, und was gilt bei einer Ablehnung“ entfällt — es gibt nie zwei Texte an einer `post_version`.

**Was stattdessen gebraucht wird**, ist reine Bequemlichkeit: das erneute Laden der Einstellungen eines früheren Beitrags, damit derselbe Prompt schnell ein zweites Mal mit anderer Plattformauswahl laufen kann. Ausgeplant als **Paket 043**.

<details>
<summary>Ursprünglicher, verworfener Text</summary>

**Entschieden (2026-08-14):** Bei **deutlich** unterschiedlichen Zeichengrenzen der gewählten Plattformen wird nicht ein gemeinsam gekürzter Text erzeugt, sondern **je Plattform ein eigener Text**, und beide werden angezeigt. Das ist die Antwort auf das Problem der min()-Regel: wer Facebook und X anhakt, bekämpfte sonst einen Tweet als Facebook-Beitrag.

Damit hängen zwei Dinge zusammen, die dieser Plan nicht mehr allein lösen kann:

1. **Erzeugung**: `GeneratedPostSchema.variants` (`PlatformVariantSchema`, max 8, mit eigener `platform`/`caption`) ist dafür vorhanden und heute leer. Ein Kandidat mit mehreren Varianten aus einem Provider-Aufruf ist Paket 005.
2. **Freigabe**: zwei Texte können zwei Freigaben brauchen. Die Freigaberoute arbeitet heute auf **einer** `post_version` (Paket 011/024). Ob zwei Varianten eine gemeinsame Freigabe erhalten oder je eine eigene — und was gilt, wenn eine freigegeben und eine abgelehnt wird — ist eine fachliche Entscheidung mit Folgen für `post_versions`, die Freigabekette und die Veröffentlichung.

**Nicht Teil von Paket 042.** Gehört als eigenes Paket ausgeplant (Arbeitstitel: „Pro-Plattform-Varianten und ihre Freigabe", Abhängigkeit 005 + 011/024). Bis dahin gilt die min()-Regel, die für Instagram/Facebook (beide großzügig) unschädlich ist. **Schwelle:** sobald eine Plattform mit einer Grenze unter etwa der Hälfte der großzügigsten gewählten hinzukommt, ist min() nicht mehr vertretbar — praktisch also mit der ersten Kurzform-Plattform (X 280, Mastodon 500).

</details>

### Step 5: Provenienz nicht lügen lassen

`post_generation_provenance.provider_parameter_hash` soll die „tatsächlich benutzten" Parameter hashen. `parameterHash` in `apps/worker/src/textGeneration.ts` nimmt heute immer `session.temperature` auf — auch beim `anthropic`-Protokoll, das den Wert nie sendet. Das ist eine falsche Provenienz-Angabe.

Fix: `temperature` nur in den Hash aufnehmen, wenn der gewählte Adapter sie sendet (dieselbe Protokollprüfung wie in Step 1, im Worker direkt am `provider.protocol` verfügbar). Der Hash bleibt für OpenAI-kompatible Provider unverändert; für `anthropic`-Provider ändert er sich einmalig — das ist korrekt, weil er bisher etwas Falsches behauptete.

**Verify**: Worker-Test in `apps/worker/src/textGeneration.test.ts` — zwei Sitzungen mit unterschiedlicher `temperature` auf einem `anthropic`-Provider erzeugen denselben `provider_parameter_hash`, auf einem `openai`-Provider unterschiedliche.

## Done criteria

- [x] `llm_provider_configurations` trägt keine Laufzeitparameter mehr; ein Provider ist reine Zugangs-/Routing-Konfiguration (PR 1)
- [x] `composition_sessions` friert `target_platforms`/`max_characters`/`temperature` bei Anlage ein, und alle drei sind Teil des `input_hash` (PR 1 + Review-Fix)
- [x] `text_generation_platform_defaults` existiert, ist für jedes Mitglied lesbar und nur für Plattform-Admins schreibbar (PR 1)
- [x] Die Plattform-Grenze ist eine **Zeichen**-Grenze, keine Token-Zahl (PR 1, nachgezogen 2026-08-14)
- [x] Ein Plattform-Admin kann die Zeichengrenze je Plattform in der Oberfläche pflegen (PR 2)
- [x] Ein Mitglied wählt die Persona-Intensität am Beitrag; bei einem `anthropic`-Provider ist die Wahl nicht sichtbar statt wirkungslos bedienbar (PR 3)
- [x] Das Formular zeigt nur Plattformen an, auf die der Scope veröffentlichen kann, und die API lehnt andere mit 422 ab (PR 3)
- [x] `provider_parameter_hash` enthält `temperature` nur, wenn sie gesendet wurde (PR 3)
- [ ] Getrennte Texte je Plattform bei stark abweichender Länge — **eigenes Paket**, nicht 042
- [x] Voller Gate plus `db:test` grün nach jedem PR

## STOP conditions

- **Eine weitere eingefrorene Spalte auf `composition_sessions` landet, ohne in den `input_hash` zu wandern.** Dann wiederholt sich der Fund aus dem Review-Fix von PR 1: der Wiederverwendungszweig des RPC ignoriert die Parameter stumm, und die neue Nutzereingabe ist unerreichbar.
- **Die vier Stufen werden geändert oder erweitert**, ohne den CHECK in `2026081309` und `TEXT_GENERATION_TEMPERATURE_STEPS` gemeinsam anzufassen — die API akzeptiert sonst einen Wert, den die Datenbank mit 23514 zurückweist.
- **Eine neue Plattform kommt hinzu** (Twitter/X, LinkedIn und Mastodon sind vorgesehen), ohne dass `SocialPlatformSchema`, der CHECK von `text_generation_platform_defaults`, der CHECK auf `composition_sessions.target_platforms` **und** ein Seed mit deren echter Zeichengrenze mitgezogen werden. Ohne Seed-Zeile lässt sich für sie keine Länge bestimmen, und die Route rechnet sie stillschweigend aus dem Minimum heraus.
- **Der Vorgabewert von `targetPlatforms` wird aus `SocialPlatformSchema.options` abgeleitet.** Mit einer Kurzform-Plattform in der Menge würde „alles vorausgewählt“ jeden Beitrag stillschweigend auf deren Länge kürzen. Die min()-Regel selbst ist erwünscht (Step 4) — eine **Vorauswahl**, die sie unbemerkt auslöst, ist es nicht: der Ersteller muss die kurze Plattform bewusst angehakt haben (siehe Plan 044, das die heutige automatische Vorauswahl aus Step 3 dafür ganz zurücknimmt).
- **PR 3 rendert den Regler, ohne `temperatureSupported` auszuwerten** — das ist genau der irreführende Zustand, den Step 1 verhindert.

## Maintenance notes

**Warum die Labels bewusst wertend sind — und was daran riskant bleibt.** Die vier Stufen heißen „Dezent" bis „Vollgas" und versprechen Persona-Intensität. Technisch ist `temperature` aber Sampling-Entropie: höhere Werte machen die Wortwahl unvorhersehbarer, nicht die Persona treuer. Das hat eine messbare Nebenwirkung in diesem System, weil jeder erzeugte Beitrag hart gegen sein Quellmaterial geprüft wird: `assertGroundedPost` (`packages/content-engine/src/index.ts:67`) weist einen Kandidaten ab, sobald er eine `generatedClaims.sourceId` außerhalb von `brief.allowedClaims` trägt oder eine verbotene Formulierung enthält — als `ContentGenerationError('ungrounded', false)`, also **nicht wiederholbar**: der Kandidat geht direkt auf `failed`, ohne zweiten Versuch. Und jeder Versuch verbraucht einen der acht Slots aus `composition_sessions.candidate_count` (Paket 035). Ein Mitglied, das nach den Labels die attraktivste Stufe wählt, bekommt damit die höchste Fehlerrate und verliert am schnellsten sein Überarbeitungsbudget, ohne dass die Oberfläche einen Zusammenhang zur Reglerstellung herstellt.

Bewusst so belassen, weil die Alternative (nur „Ausgewogen"/„Ausgeprägt" anbieten) dem Mitglied eine echte Gestaltungsmöglichkeit nimmt. Wenn PR 3 in Betrieb ist, sollte die `failure_code = 'ungrounded'`-Rate je Stufe geprüft werden — steigt sie bei 1.0 auffällig, ist entweder die Stufe zu entfernen oder ein `ungrounded`-Fehlschlag darf den Slot nicht verbrauchen. Für diese Prüfung reicht `generation_candidates.failure_code` zusammen mit `composition_sessions.temperature`; beides ist seit PR 1 vorhanden.

**Namenswahl `text_generation_platform_defaults`.** Nicht `platform_...`: dieses Präfix bedeutet im Projekt durchgängig „Plattform-Administration/SaaS-Betreiber" (`platform_admins`, `platform_style_personas`), nie „Social-Media-Plattform".

**Eine Plattform-Menge, nicht zwei.** Der Review-Fix von PR 1 hatte zunächst eine eigene `TextGenerationPlatformSchema` neben `SocialPlatformSchema` der Kanal-Domäne eingeführt, mit der Begründung, ein neuer Kanal dürfe nicht automatisch eine Vorgabezeile voraussetzen. Mit der Entscheidung aus Step 3 ist das **umgekehrt richtig**: auf welchen Plattformen ein Beitrag entstehen darf, ist genau die Menge, auf die veröffentlicht werden kann — zwei getrennte Kopien würden bei jedem neuen Kanal auseinanderlaufen. Die Menge liegt deshalb in `packages/contracts/src/primitives.ts` (nicht in `channels.ts`: `channels.ts` importiert `UuidSchema` aus `content.ts`, ein Import in die andere Richtung wäre ein Zyklus), und eine fehlende Vorgabezeile ist ein Betreiberproblem, das die STOP conditions abdecken.

**Zeichen, nicht Tokens.** `max_output_tokens` war als Plattform-Grenze der falsche Hebel: die Plattform weist einen zu langen Beitrag ab, und ein Token-Budget lässt sich darauf nicht verlässlich umrechnen (Tokenisierung ist modell- und sprachabhängig). Die Vorgabe je Plattform ist deshalb `max_characters`; das Token-Budget bleibt als globale Konstante `TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS` bestehen und begrenzt nur den Aufruf. Die Zeichengrenze steht seit PR 1 im System-Prompt (`buildStructuredTextPrompt`) — das ist eine **Bitte an das Modell**, keine Durchsetzung. Eine harte Prüfung nach der Generierung (zu langer Text → Fehlschlag oder Nachkürzung statt stillem Durchlassen) fehlt noch; heute deckelt nur `GeneratedPostSchema.caption` bei 2200 global. Beim Anheben einer Plattform-Grenze über 2200 muss diese Schema-Grenze mitwachsen, sonst wird die Vorgabe wirkungslos.
