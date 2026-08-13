# 040 – Personas/Stilprofile: Charakter-Modell statt Dial-Formular

## Ergebnis

Das Plattform-Admin-Formular für Personas (`plattform-admin/personas.vue`, Paket 037) und ein neu
zu bauendes Vereins-Formular für eigene Stilprofile (`content_style_profiles`) bekommen ein
gemeinsames, konkreteres Datenmodell: Tonalitäts-Tags, Catchphrases, Do's/Don'ts und ein
Few-Shot-Beispielpaar (Input→Output) statt der bisherigen abstrakten Dial-Felder (Satzlänge,
Energie 1–5, Humor, Formalität, Perspektive). Ergänzt um einen Live-Preview-Endpunkt ("Persona
testen"), der den aktiven Text-Provider direkt und synchron aufruft.

## Ausgangslage und Evidenz

- Das Dial-Schema (`StyleProfileRulesSchema`, `packages/contracts/src/content.ts`) war für einen
  Nicht-Linguisten schwer zu befüllen: unklar, was "Energie 4" für eine Figur wie "Zlatan
  Ibrahimović" bedeutet. Nutzeranfrage 2026-08-13: ein Charakter-Modell mit konkreten Feldern.
- `buildStructuredTextPrompt` (`packages/content-engine/src/index.ts:93-114`) bettet
  `styleRules`/`avoidRules` generisch als JSON-String in den System-Prompt ein — kein Feld wird
  einzeln in Prompt-Text übersetzt. Ein Schema-Wechsel ist daher überwiegend ein Contracts-Wechsel
  mit Ausstrahlung, kein Prompt-Engineering-Umbau.
- Die DB-CHECKs auf `style_rules jsonb` (`2026081003_text_workshop_foundation.sql`,
  `2026081301_platform_style_personas.sql`) prüfen nur `jsonb_typeof = 'object'`, nie eine
  Feldform — das erleichtert den Wechsel, da keine Spalten-CHECKs angepasst werden müssen.
- `bannedPhrases` (im Dial-Schema) und die äußere Spalte `avoid_rules` waren zwei überlappende
  "was vermeiden"-Listen. Das Charakter-Modell löst das auf: `avoid_rules` wird die alleinige
  Don'ts-Liste, eine neue, symmetrische Spalte `do_rules` wird die Do's-Liste.
- Personas (`platform_style_personas`), Vereinsprofile (`content_style_profiles`) und die fünf
  hartkodierten Basismodi (`systemStyleProfiles`, `apps/api/src/routes/content.ts`) laufen ab dem
  eingefrorenen `composition_sessions.style_profile_snapshot` durch exakt denselben generischen
  Worker-Code (`apps/worker/src/textGeneration.ts`, `apps/worker/src/context.ts`) — ein
  Schema-Wechsel trifft alle drei Quellen gleichzeitig an derselben Stelle.
- Es gibt bislang **keine Vereins-UI** zum Anlegen eigener `content_style_profiles` (nur ein
  Auswahl-Picker in `erstellen.vue`) und **kein PATCH/DELETE** für diese Tabelle — beides fehlt
  komplett, nicht nur veraltet.
- Live-Preview ("Persona testen") erfordert einen neuen synchronen API-Endpunkt, der den
  LLM-Provider direkt aufruft — bislang ruft nur der Worker (`apps/worker/src/textGeneration.ts`)
  je einen Provider auf, nie die API.
- Recherche fand keinen Hinweis auf reale Produktionsdaten (Produktivbetrieb ist per
  `docs/operations/pilot-readiness.md` weiterhin gesperrt) — nur lokal/pilot angelegte
  Test-Personas und -Profile.

## Scope

In Scope:
- Charakter-Modell (`toneTags`, `catchphrases`, `exampleInput`, `exampleOutput`,
  `additionalInstructions`) ersetzt das Dial-Schema vollständig, für beide Tabellen gleich.
- Neue Spalte `do_rules text[]` auf beiden Tabellen, symmetrisch zu `avoid_rules`.
- Live-Preview-Endpunkt pro Ressource, ruft `generateText` direkt und synchron auf, kein DB-Write.
- Neue Vereins-Seite zum Anlegen/Bearbeiten/Löschen eigener Stilprofile (bislang nicht vorhanden),
  gemeinsame Editor-Komponente mit dem Plattform-Admin-Formular.
- Fehlende `PATCH`/`DELETE /v1/content-style-profiles/:id`.

Außerhalb des Scopes:
- **Avatar-Upload** für Personas — Storage-/Moderationsaufwand für den geringsten Nutzen, eigenes
  späteres Paket.
- **Rückwirkende Migration** historischer `style_rules`-Werte — Bestandszeilen werden auf
  `'{}'::jsonb` zurückgesetzt (siehe Datenmodell), kein Feld-Mapping-Backfill. Betrifft nur
  lokal/pilot angelegte Test-Personas.
- **Übergangs-Union** für offene `composition_sessions`/`generation_candidates` mit altem
  Snapshot-Format — schlägt im Worker klassifiziert (`generation_validation`, non-retryable) fehl
  statt den Worker zum Absturz zu bringen; bestehender Fehlerpfad
  (`apps/worker/src/textGeneration.ts`) fängt das bereits ab.

## Datenmodell

Migration `supabase/migrations/2026081304_style_profile_character_model.sql`: `do_rules text[]`
auf `content_style_profiles` und `platform_style_personas` (Default `'{}'`, gleiche
Kardinalitäts-/Längen-CHECKs wie `avoid_rules` über die wiederverwendete
`text_array_elements_within_length`-Funktion), sowie ein Reset aller Bestandszeilen auf
`style_rules = '{}'::jsonb`.

### Contracts (`packages/contracts/src/content.ts`)

```ts
export const StyleProfileRulesSchema = z.object({
  toneTags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  catchphrases: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  exampleInput: z.string().trim().max(300).default(''),
  exampleOutput: z.string().trim().max(1_500).default(''),
  additionalInstructions: StyleProfileInstructionSchema.default(''),
}).strict()
```

Alle Felder defaulted, kein `.min(1)` — ein zurückgesetztes `{}` bleibt gültig. Neue geteilte
Konstante `StyleProfileRuleListSchema` (ersetzt die 5-fach duplizierte `avoidRules`-Inline-Form,
jetzt auch für `doRules` verwendet). Neues `StyleProfileSnapshotSchema` (Name/Beschreibung/
StyleRules/AvoidRules/DoRules) als einzige Quelle für die Snapshot-Validierung, statt zwei
unabhängig gepflegter Kopien in `apps/worker/context.ts` und `textGeneration.ts`.

## Umsetzung (3 PRs)

### PR 1 — Migration & Contracts

Migration wie oben, Contracts-Umbau, Worker-Konsolidierung auf `StyleProfileSnapshotSchema`,
`content-engine` nimmt `doRules` in den Prompt auf ("Dos: ..." neben "No-Gos: ..."), die fünf
hartkodierten Basismodi (`systemStyleProfiles`) werden inhaltlich auf das Charakter-Modell
umgestellt. pgTAP- und Contracts-Tests erweitert.

### PR 2 — API

- `PATCH`/`DELETE /v1/content-style-profiles/:id` (fehlten bisher komplett), gleiches
  `post.create`-Scope-Gate wie `POST`, nach dem Muster von `platformPersonas.routes.ts`.
- `POST /v1/content-style-profiles/preview` (Scope-gated) und
  `POST /v1/platform-style-personas/preview` (`requirePlatformAdmin`-gated): Request
  `{ name, description, styleRules, avoidRules, doRules, sampleInput }`; baut den
  `GroundedContentBrief` von Hand (kein `createTextGroundedContentBrief`/`getPreset`, das einen
  echten registrierten Preset voraussetzt), lädt den aktiven Text-Provider, ruft
  `generator.generateText(...)` synchron auf. Kein DB-Write, keine Session/Kandidat-Zeile.

### PR 3 — Frontend

- Geteilte Komponente `StyleProfileEditorForm.vue` (Draft-Objekt als Prop, ein `save`-Emit,
  State/API bleibt auf der Seite, nach dem Muster von `LegalOrganizationProfileForm.vue`): Name,
  Beschreibung, Tags, Catchphrases, Do's, Don'ts, Beispiel-Input/-Output,
  `additionalInstructions`, "Persona testen"-Button.
- `plattform-admin/personas.vue` auf die neue Komponente umstellen.
- Neue Seite `apps/web/app/pages/stilprofile.vue` (Top-Level-Route `/stilprofile`, analog
  `marke.vue`/`kanaele.vue`) für Vereinsmitglieder: Liste + Anlage/Bearbeitung/Löschen eigener
  Profile, Scope-Auswahl, Gating über `useCan('post.create', scope)`.
- Nav-Eintrag in `layouts/default.vue`s `organizationNav`, Komfort-Link aus `erstellen.vue`.

## Verifikation

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- `pnpm db:start && pnpm db:reset && pnpm db:test`.
- Manueller Smoke-Test (Playwright, echter lokaler Stack, nach PR 3): Plattform-Admin legt eine
  Test-Persona mit Tags/Catchphrases/Few-Shot an, "Persona testen" liefert ein Ergebnis oder einen
  ehrlichen Fehler ohne lokalen Provider-Key; Persona erscheint in `/erstellen`. Ein
  Vereinsmitglied mit `post.create` legt über `/stilprofile` ein eigenes Profil an, bearbeitet und
  löscht es; ein Mitglied ohne `post.create` sieht die Seite gesperrt/leer.

## Umsetzung: Ergebnis und Abweichungen vom Plan (PR 1)

PR 1 vollständig umgesetzt und verifiziert (Migration `2026081304_style_profile_character_model.sql`,
Contracts-Umbau, Worker-Konsolidierung, `content-engine`-Prompt-Erweiterung). Eine bewusste
Abweichung: die inhaltliche Neubefüllung der fünf hartkodierten Basismodi
(`systemStyleProfiles` in `apps/api/src/routes/content.ts`) war ursprünglich PR 2 zugeordnet,
musste aber in PR 1 vorgezogen werden — sonst hätte `apps/api` nach PR 1 allein nicht mehr
getypecheckt, da die Konstante direkt gegen den geänderten `StyleProfileRules`-Typ gebaut ist.
Damit zieht PR 1 auch `do_rules` durch alle bestehenden Lese-/Schreibpfade
(`GET/POST /v1/content-style-profiles`, `POST /v1/text-workshop/sessions`,
`platformPersonas.routes.ts`), ohne neue Routen zu öffnen — das bleibt PR 2.

`pnpm lint/typecheck/test/build` (alle 20 Pakete) und `pnpm db:reset && pnpm db:test`
(23 Testdateien, 728 pgTAP-Assertions) grün.
