# Plan 044: Zielplattform-Vorgaben je Ebene und harte Längengrenze

> **Executor instructions**: Zwei PRs, inhaltlich unabhängig voneinander — die Reihenfolge ist eine Empfehlung, keine technische Abhängigkeit. PR 1 nimmt die Vorauswahl zurück und macht sie konfigurierbar, PR 2 setzt die Zeichengrenze tatsächlich durch.
>
> **Drift check (run first)**: `git log --oneline -3 -- packages/contracts/src/content.ts packages/contracts/src/policy.ts packages/content-engine/src/index.ts apps/worker/src/textGeneration.ts` — Stand bei Ausplanung ist der Merge von PR #76 (Paket 042 PR 3) samt dessen Review-Fixes (`4cac8c0c`).

## Status

- **Priority**: P1 für PR 2 (die Zusicherung ist heute unwahr), P2 für PR 1
- **Effort**: M (PR 1 M, PR 2 M)
- **Risk**: MEDIUM — PR 1 entfernt einen Vorgabewert aus einem veröffentlichten Contract; PR 2 kann Beiträge scheitern lassen, die heute stillschweigend durchgehen
- **Depends on**: 042 (Zielplattformen und Zeichengrenze), 011 (Richtlinien und Vererbung)
- **Category**: correctness, product
- **Planned at**: 2026-08-14, aus der Design-Sitzung nach dem Code-Review von PR #76

## Why this matters

Zwei Zusicherungen der Textwerkstatt stimmen heute nicht.

**Die Vorauswahl entscheidet ungefragt mit.** `erstellen.vue` hakt heute *jede* verfügbare Plattform automatisch an, und `CreateCompositionSessionSchema.targetPlatforms` trägt den Vorgabewert `['instagram','facebook']`. Beides sind Betreibervorgaben an einer Stelle, an der der Betreiber nichts vorzugeben hat: auf welchen Plattformen ein Verein veröffentlicht, ist seine Sache. Zusammen mit der min()-Regel ist die automatische Vorauswahl sogar gefährlich — sobald eine Kurzform-Plattform wie X (280 Zeichen) dazukommt, staucht ein Haken, den niemand gesetzt hat, jeden Beitrag auf 280 Zeichen. Und der Contract-Vorgabewert ist seit Paket 042 PR 3 ein garantierter Fehlschlag: ein Verein ohne Facebook-Kanal läuft damit in `422 platform_not_available`.

Was der Verein stattdessen braucht, ist die Möglichkeit, **selbst** Vorgaben zu setzen — je Verein und je Abteilung, mit derselben Vererbung wie jede andere Richtlinie.

**Die Zeichengrenze ist bislang nur eine Bitte.** `buildStructuredTextPrompt` schreibt „Der Beitragstext (caption) darf höchstens N Zeichen lang sein" in den System-Prompt. Mehr passiert nicht: Es gibt keine Prüfung nach der Generierung. Durchgesetzt wird global nur `GeneratedPostSchema.caption` (10000). Solange alle Plattformen bei 2200 lagen, fiel das nie auf. Mit einem Blog bei 5000 und X bei 280 wird daraus ein sichtbarer Fehler — und die Plattform ist gnadenlos: **ein Zeichen zu viel und der Beitrag wird abgelehnt** (Betreiberentscheidung vom 2026-08-14). Ein Beitrag, der die Freigabe durchläuft und erst beim Veröffentlichen scheitert, hat die Arbeit von Ersteller *und* Prüfer verbrannt.

## Current state

| Wo | Was |
|---|---|
| `CreateCompositionSessionSchema.targetPlatforms` | `.min(1).max(2)`, ohne Duplikate, **Vorgabewert `['instagram','facebook']`** (`packages/contracts/src/content.ts`) |
| `erstellen.vue` | `loadPlatformAvailability()` hakt **alle** verfügbaren Plattformen an: `selectedPlatforms.value = response.filter((e) => e.available).map((e) => e.platform)` |
| `policy_settings` | trägt die vererbten Richtlinien je Ebene; `POLICY_RULE_COLUMNS` in `apps/api/src/routes/shared.ts` listet die Spalten, `resolveEffectiveConfig`/`mergeEffectiveConfig` (`packages/domain`) die Kette Verein → Abteilung → Team. `null` heißt „geerbt" |
| Richtlinien-Oberfläche | `apps/web/app/components/PolicyFlagToggles.vue`, eingebunden auf `struktur.vue`/`einstellungen/index.vue` |
| `assertGroundedPost` | einziger Prüfschritt nach der Generierung (`packages/content-engine/src/index.ts:66`), wirft `ContentGenerationError('ungrounded', false)` — **nicht** wiederholbar |
| `maxCharacters` | erreicht den Generator bereits (`StructuredTextGeneratorInput.maxCharacters`) und steht im System-Prompt — wird aber nach der Antwort **nirgends geprüft** |
| `composition_sessions.candidate_count` | acht Versuche je Sitzung (Paket 035); jeder gescheiterte Kandidat verbraucht einen |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Voller Gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit 0 |
| DB-Tests | `pnpm db:start && pnpm db:reset && pnpm db:test` | exit 0, alle pgTAP-Dateien grün |
| Web-Teilgate | `cd apps/web && pnpm typecheck && pnpm test` | exit 0 |

## PR 1: Keine Vorauswahl, außer der Verein will eine

### Step 1 — Vorgabewert aus dem Contract entfernen

`targetPlatforms` verliert `.default(['instagram','facebook'])` und wird damit ein **Pflichtfeld**. `.min(1)` bleibt: abgeschickt wird weiterhin nur mit mindestens einer Plattform — leer ist der Zustand *vor* dem Absenden, kein zulässiger Beitrag.

Das ist ein Breaking Change am veröffentlichten Contract, aber der einzige ehrliche: es gibt keinen Vorgabewert, der für jeden Verein funktioniert. `['instagram','facebook']` scheitert bei jedem Verein ohne beide Kanäle, und jede aus `SocialPlatformSchema.options` abgeleitete Variante staucht mit der ersten Kurzform-Plattform stillschweigend jeden Beitrag. Einziger Aufrufer ist heute `erstellen.vue`, das den Wert ohnehin explizit setzt.

**Verifizieren**: Vitest in `packages/contracts` — ein Aufruf ohne `targetPlatforms` schlägt fehl statt still `['instagram','facebook']` einzusetzen. Bestehender Contract-Test (`content.test.ts`, Zeile mit dem Vorgabewert) ist entsprechend umzuschreiben.

### Step 2 — `defaultTargetPlatforms` als vererbte Richtlinie

Neue Spalte `policy_settings.default_target_platforms text[] null`, mit demselben CHECK-Muster wie `composition_sessions.target_platforms` (Teilmenge der bekannten Plattformen, ohne Duplikate). Aufnahme in `POLICY_RULE_COLUMNS`, `PolicyRuleRow`, `resolveEffectiveConfig`/`mergeEffectiveConfig` und `PolicySettingsSchema`.

**Die Unterscheidung `null` ↔ `{}` trägt hier Bedeutung und darf nicht eingeebnet werden:**

- `null` = **geerbt**. Die Abteilung übernimmt, was der Verein gesetzt hat.
- `{}` (leeres Array) = **ausdrücklich keine Vorauswahl**. Eine Abteilung kann damit die Vorgabe des Vereins abbestellen, ohne dass eine andere an ihre Stelle tritt.

Ohne diese Unterscheidung könnte eine Abteilung eine Vereinsvorgabe nur ersetzen, nie abwählen. `mergeEffectiveConfig` muss `{}` deshalb als gesetzten Wert behandeln, nicht als „nichts angegeben" — das ist der klassische Fehler an dieser Stelle.

**Verifizieren**: Vitest in `packages/domain` — Verein `['instagram']`, Abteilung `null` erbt `['instagram']`; Abteilung `{}` ergibt `{}`; Abteilung `['facebook']` ersetzt. pgTAP für den CHECK.

### Step 3 — Vorauswahl aus der Vorgabe statt aus der Verfügbarkeit

`GET /v1/text-generation-platforms` liefert zusätzlich `isDefault` je Plattform, aufgelöst aus der effektiven Vorgabe des angefragten Scopes. `erstellen.vue` hakt genau diese an — nicht mehr „alles Verfügbare".

**Die Vorgabe wird mit der Verfügbarkeit geschnitten.** Steht in der Vorgabe eine Plattform, für die dieser Scope keinen Kanal (mehr) hat, wird sie **nicht** angehakt: sonst liefe das Formular vorausgewählt in ein `422`. Das ist derselbe Schnitt, den `restoreDraft` bereits für gespeicherte Entwürfe macht.

Ist keine Vorgabe gesetzt, startet die Auswahl **leer**, und der vorhandene Hinweis „Bitte wähle mindestens eine Zielplattform." greift beim Absenden.

**Verifizieren**: Vitest für die Route (Vorgabe `['instagram','facebook']` bei nur verfügbarem Instagram ergibt `isDefault` nur für Instagram). Playwright-Smoke: ohne Vorgabe ist nichts angehakt; nach dem Setzen einer Abteilungsvorgabe ist genau diese angehakt.

### Step 4 — Bedienoberfläche für die Vorgabe

Die Vorgabe gehört zu den Richtlinien, also zu `PolicyFlagToggles.vue` bzw. daneben — Mehrfachauswahl der Plattformen, mit einem sichtbaren dritten Zustand „von der übergeordneten Ebene geerbt". Berechtigung wie die übrigen Richtlinien (`POLICY_MANAGE_PERMISSION` je Ebene).

**Verifizieren**: Playwright-Smoke — Vereinsvorgabe setzen, in einer Abteilung „geerbt" sehen, dort abwählen, Vererbung greift nicht mehr.

## PR 2: Die Zeichengrenze hart durchsetzen

### Step 5 — Prüfung nach der Generierung

Die Längenprüfung gehört neben `assertGroundedPost` in `packages/content-engine` — dieselbe Stelle, dieselbe Fehlerklasse-Mechanik, und damit greift sie für jeden Aufrufer statt nur für den Worker. Geprüft wird `caption` gegen die eingefrorene `maxCharacters` der Sitzung.

**`caption`, nicht der ganze Beitrag.** Der System-Prompt nennt ausdrücklich den Beitragstext; `headline` (80), `shortCaption` (500) und `altText` (500) haben eigene, unabhängige Grenzen und gehören nicht in dieselbe Summe.

### Step 6 — Wiederholbarkeit und wer sie bezahlt

**Zu entscheiden vor der Umsetzung, mit einer Empfehlung:**

Ein zu langer Text ist — anders als ein ungegroundeter — mit hoher Wahrscheinlichkeit beim zweiten Versuch in Ordnung, weil er kein Regelverstoß ist, sondern ein Ziel knapp verfehlt. Empfehlung: **ein** interner Wiederholversuch mit einer verschärften Anweisung („der vorige Entwurf war N Zeichen zu lang, kürze auf höchstens M"), danach echter Fehlschlag mit einer Fehlerklasse, die das Mitglied versteht.

**Dieser interne Versuch darf keinen Kandidaten-Slot verbrauchen.** `composition_sessions.candidate_count` deckelt bei acht, und diese acht gehören den Überarbeitungen des Mitglieds — nicht dem Modell, das seine eigene Vorgabe verfehlt hat. Dieselbe Regel wie bei Infrastruktur-Wiederholungen: die Zählstelle so legen, dass interne Versuche sie nicht erreichen.

**Kürzen ist keine Option.** Einen zu langen Text automatisch abzuschneiden hieße, dem Mitglied einen Text zur Freigabe vorzulegen, den das Modell so nie geschrieben hat — mitten im Satz endend, womöglich ohne den Aufruf am Ende. Lieber ein ehrlicher Fehlschlag.

**Verifizieren**: Vitest im Worker — eine Antwort mit `caption.length === maxCharacters` geht durch, `maxCharacters + 1` löst genau einen Wiederholversuch aus, ein zweites Mal zu lang schlägt fehl; `candidate_count` ist danach um **eins** gestiegen, nicht um zwei.

### Step 7 — Die Grenze im Schema mitziehen

`GeneratedPostSchema.caption` steht bei 10000 und ist damit die stille Obergrenze über allem. Sie muss mindestens so groß bleiben wie die größte Plattform-Vorgabe, sonst wird ein zulässiger Blogbeitrag vom eigenen Schema abgewiesen, bevor die Prüfung aus Step 5 überhaupt greift. `MaxCharactersSchema` (100–10000) und diese Grenze gehören sichtbar aneinandergekoppelt, statt zufällig übereinzustimmen.

**Verifizieren**: Vitest in `packages/contracts` — eine Plattform-Vorgabe am oberen Rand von `MaxCharactersSchema` erzeugt eine `caption`, die `GeneratedPostSchema` noch annimmt.

## Offene Punkte

1. **Was ist „ein Zeichen"?** `String.length` zählt UTF-16-Code-Units: ein Emoji zählt dort 2, ein „ä" je nach Normalform 1 oder 2. Plattformen zählen anders — X gewichtet Zeichenbereiche unterschiedlich und rechnet jede URL pauschal als 23. Solange nur Instagram, Facebook und der eigene Blog im Spiel sind (alle großzügig, alle unkritisch), fällt der Unterschied nicht auf. **Mit X wird er entscheidend**: eine Prüfung, die anders zählt als die Plattform, lehnt entweder zulässige Beiträge ab oder lässt abgelehnte durch — und Letzteres ist genau der Fehler, den dieses Paket beheben soll. Vor dem Anlegen der ersten Kurzform-Plattform ist zu entscheiden, ob die Zählweise je Plattform hinterlegt wird.
2. **Rückwirkung auf bestehende Sitzungen.** Beiträge, die heute über ihrer Grenze liegen, sind bereits erzeugt und teils freigegeben. Step 5 wirkt nur auf neue Generierungen — ob bestehende nachträglich markiert werden sollen, ist eine Produktentscheidung. Empfehlung: nein, aber einmal zählen, wie viele es überhaupt sind.
