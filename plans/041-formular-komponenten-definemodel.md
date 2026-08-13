# Plan 041: Prop-Mutation in Formular-Komponenten durch `defineModel` ersetzen

> **Executor instructions**: Rein mechanischer Refaktor, keine Verhaltensänderung. Jeder Schritt ändert eine Komponente **und** alle ihre Aufrufstellen zusammen — ein halb migrierter Schritt bricht die Zwei-Wege-Bindung, weil `defineModel` `v-model:prop=` an der Aufrufstelle voraussetzt, nicht mehr `:prop=` mit späterer direkter Mutation.
>
> **Drift check (run first)**: `git diff --stat 28dce97c..HEAD -- apps/web/app/components apps/web/app/pages`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW für Schritt 1–4 (rein mechanisch); MEDIUM für Schritt 5 (`MemberList.vue`/`pages/mitglieder.vue`) — echte Zustandsänderung, deren Verhaltensäquivalenz durch Nachverfolgen aller Lese-/Schreibstellen begründet, aber nicht automatisch bewiesen ist
- **Depends on**: none
- **Category**: refactor, code quality
- **Planned at**: commit `28dce97c`, 2026-08-13
- **Implementation note (2026-08-14)**: Alle sechs Schritte inklusive Schritt 1 (`StyleProfileEditorForm.vue`) als **PR #69** umgesetzt und gemergt (nach Merge von PR #67 wurde `StyleProfileEditorForm.vue` per Merge-Commit in den Branch nachgezogen und in einem letzten Commit ebenfalls auf `defineModel` umgestellt). Manueller Test aus Schritt 5 (Mitgliedschaftswechsel ohne Speichern) nachträglich per Playwright verifiziert: kein Datendurchsickern zwischen zwei Mitgliedschaften.

## Why this matters

CodeRabbit bemängelte in PR #67, dass `StyleProfileEditorForm.vue` sein `draft`-Prop direkt über `v-model` mutiert — das bricht Vues Einwegfluss und wird von der Lint-Regel `vue/no-mutating-props` erfasst, sobald sie aktiv ist (aktuell ist im Projekt nur `eslint-plugin-vue`s `flat/base`-Konfiguration eingebunden, nicht `flat/recommended` — deshalb lief PR #67 bisher lintclean durch trotz dieses Musters). Eine Codebase-weite Prüfung zeigt: das ist kein Einzelfall. `defineModel` (stabil seit Vue 3.4, das Projekt läuft auf `vue@^3.5.18`) ist der dafür vorgesehene, saubere Ersatz — der Vorschlag stammt exakt aus dem CodeRabbit-Kommentar zu PR #67.

## Current state

Codebase-weite Prüfung (`grep -rl defineProps apps/web/app/{components,pages,layouts}`) findet 17 Komponenten mit Props; davon mutieren **7** ein Prop direkt über `v-model`. Zwei fachlich unterschiedliche Formen:

**Form A — einzelnes Objekt/Array-Prop (mechanischer `defineModel`-Tausch, keine Restrukturierung nötig):**

| Komponente | Prop | Aufrufstellen |
|---|---|---|
| `components/StyleProfileEditorForm.vue:6-22` | `draft: StyleProfileDraft` | `pages/plattform-admin/personas.vue:141`, `pages/stilprofile.vue:252` (Anlage), `pages/stilprofile.vue:269` (Bearbeitung) |
| `components/RetentionSettingsForm.vue:2-6` | `draft: {...}` | `pages/einstellungen/recht.vue:351` |
| `components/LegalOrganizationProfileForm.vue:4-15` | `profileDraft: {...}` | `pages/einstellungen/recht.vue:349` |
| `components/IntegrationSourceCreateForm.vue:5-13` | `form: {...}`, `mappingRows: MappingRow[]` | `pages/integrationen.vue:351` |
| `components/IntegrationSourceEditForm.vue:7-14` | `form: {...}`, `mappingRows: MappingRow[]` | `pages/integrationen.vue:375` |

`mappingRows` ist ein Array-Prop, dessen Elemente (`row.column`, `row.field`) im `v-for` der Komponente selbst mutiert werden — technisch dieselbe verschachtelte Mutation wie bei `draft.name`, nur eine Ebene tiefer. Ein einziges `defineModel<MappingRow[]>('mappingRows')` deckt das ab, keine Sonderbehandlung nötig.

**Form B — Record<string, X>-Prop, indiziert über eine zur Laufzeit wechselnde ID:**

| Komponente | Props | Aufrufstelle |
|---|---|---|
| `components/ChannelCard.vue:4-17` | `purposeDraft`, `editorialImprintUrlDraft`, `editorialPrivacyUrlDraft`, `editorialResponsibleProfileIdDraft`, `editorialResponsibleNoteDraft` (je `Record<string, string>`, indiziert über `channel.id`) | `pages/kanaele.vue:45` |
| `components/MemberList.vue:5-27` | `roleDraft`, `expiryDraft`, `trustSubmitAllowedDraft`, `trustRequirementDraft`, `trustReasonDraft`, `trustExpiryDraft` (indiziert über `entry.membershipId`) | `pages/mitglieder.vue:433` |

Der Unterschied zwischen beiden ist entscheidend für den Zuschnitt der Schritte:

- `ChannelCard.vue` bekommt genau **eine** Karte pro `<ChannelCard>`-Aufruf — `pages/kanaele.vue:45` iteriert selbst per `v-for="channel in channelsState.channels"` und übergibt jeder Instanz das komplette Dictionary, nur um daraus intern den einen für sie relevanten Eintrag `purposeDraft[channel.id]` zu lesen/schreiben. Das lässt sich verlustfrei in fünf skalare `defineModel`-Felder auflösen: die Komponente bekommt statt `purposeDraft: Record<string,string>` nur noch `purpose: string`, und die Aufrufstelle bindet `v-model:purpose="channelsState.purposeDraft[channel.id]"` — Vue erlaubt `v-model` auf einen beliebigen Lvalue-Ausdruck, auch einen dynamischen Property-Zugriff. `useChannels.ts` selbst (die Dictionaries, ihre Initialisierung, `savePurpose`/`saveEditorialFields`) bleibt unverändert; nur die Bindungssyntax an der einen Aufrufstelle und die Prop-Signatur von `ChannelCard.vue` ändern sich.
- `MemberList.vue` ist dagegen selbst eine Listenkomponente: `pages/mitglieder.vue:433` erzeugt nur **eine** `<MemberList>`-Instanz, die intern per `v-for="member in members"` und einem verschachtelten, nach `expandedMembershipId` gefilterten `v-for` (Zeile 47) über beliebig viele Mitgliedschaften iteriert. Ein `defineModel` kann nicht direkt durch einen zur Laufzeit wechselnden Schlüssel parametrisiert werden. Nachverfolgen aller Lese-/Schreibstellen in `pages/mitglieder.vue` zeigt aber: die sechs Dictionaries sind trotz ihres Typs faktisch **nie** Mehrfach-Register — `toggleExpanded` (Zeile 250) schreibt `roleDraft`/`expiryDraft` ausschließlich für die gerade aufklappende `entry.membershipId` (Zeile 256-257), `initTrustDraft` (Zeile 321, von `toggleExpanded` aus Zeile 259 gerufen) ebenso für die vier Trust-Felder; gelesen werden alle sechs ausschließlich in `changeRole`/`setExpiry`/`saveTrust` (Zeile 268, 289, 338-341), und die jeweils aufrufenden Buttons existieren im Template nur für den einen Eintrag, dessen `membershipId === expandedMembershipId` ist (Filter in `MemberList.vue:47`). Es gibt also faktisch nie einen zweiten „lebenden“ Schlüssel gleichzeitig — die sechs Dictionaries sind ein Umweg um einen einzelnen „aktueller Entwurf“-Wert je Feld, ähnlich dem in `pages/stilprofile.vue` bereits etablierten `editDraft`. Sie lassen sich 1:1 durch sechs skalare `ref`s ersetzen (kein Objekt/Dictionary mehr nötig), ohne das Verhalten zu ändern — siehe Schritt 5.

Randfund, keine Aktion nötig: `components/ProcessorAgreements.vue:15` hat ein `agreementForm`, das per `reactive()` **lokaler** Komponentenzustand ist, kein Prop — trotz `v-model="agreementForm.*"` kein Fall dieses Musters.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `cd apps/web && pnpm typecheck` | exit 0 |
| Web-Tests | `cd apps/web && pnpm test` | exit 0, inkl. `pages/channelComposition.test.ts` (prüft nur das Vorhandensein von `<ChannelCard`, bleibt bestehen) |
| Build | `pnpm build --filter=@vereinsfunk/web` | exit 0 |
| Voller Gate | `pnpm check` | exit 0 |
| Restmuster prüfen (Form A) | `grep -rn 'v-model="\(draft\|profileDraft\|form\)\.' apps/web/app/components` | Treffer nur noch in Komponenten, die diese Namen als `defineModel`-Rückgabewert führen (kein `defineProps`-Feld mehr desselben Namens in derselben Datei) |
| Restmuster prüfen (Form B) | `grep -rn 'Draft\[' apps/web/app/components/ChannelCard.vue apps/web/app/components/MemberList.vue` | keine Treffer mehr — nach Schritt 4/5 gibt es keinen `[channel.id]`/`[entry.membershipId]`-Zugriff mehr in diesen zwei Dateien |

## Scope

**In scope**

- Form A: `StyleProfileEditorForm.vue`, `RetentionSettingsForm.vue`, `LegalOrganizationProfileForm.vue`, `IntegrationSourceCreateForm.vue`, `IntegrationSourceEditForm.vue` — je auf `defineModel` umgestellt, samt aller Aufrufstellen.
- Form B: `ChannelCard.vue` — fünf Record-Props durch fünf skalare `defineModel`-Felder ersetzt, `pages/kanaele.vue` entsprechend angepasst.
- Form B: `MemberList.vue` — sechs Record-Props durch sechs skalare `defineModel`-Felder ersetzt; dafür in `pages/mitglieder.vue` die sechs Dictionaries durch sechs einfache `ref`s ersetzt (siehe Schritt 5 für die genaue Begründung der Verhaltensäquivalenz).
- Neue ESLint-Regel `vue/no-mutating-props: 'error'` im `**/*.vue`-Block von `eslint.config.mjs`, als Regressionsschutz nach Abschluss der Migration.

**Out of scope**

- Aktivierung von `eslint-plugin-vue`s vollem `flat/recommended`-Regelsatz — würde unabhängig von diesem Vorhaben zusätzliche, hier nicht untersuchte Lint-Funde aufreißen.
- Jede darüber hinausgehende Verhaltens- oder UX-Änderung; `useChannels.ts` und alle API-Aufrufe bleiben identisch, nur Bindungssyntax und (in `pages/mitglieder.vue`) die Datenstruktur der sechs Drafts ändern sich.
- Die bereits in PR #67 gepushten Idempotency-/Race-Fixes an `stilprofile.vue`/`personas.vue` — unabhängig davon, hier nicht wiederholt.

## Steps

### Step 1: `StyleProfileEditorForm.vue` auf `defineModel` umstellen

Ersetze `draft: StyleProfileDraft` in den Props durch `const draft = defineModel<StyleProfileDraft>('draft', { required: true })`. Entferne `draft` aus `defineProps`, alle Templatestellen (`v-model="draft.name"` etc.) bleiben unverändert, weil `draft` weiterhin ein Ref auf dasselbe Objekt ist. Passe die drei Aufrufstellen an: `:draft="draft"` → `v-model:draft="draft"` in `pages/plattform-admin/personas.vue:141` sowie `v-model:draft="draft"` / `v-model:draft="editDraft"` in `pages/stilprofile.vue:252,269`.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0. Manuell: Persona-/Stilprofil-Formular tippen, Speichern prüft weiterhin denselben Wert.

### Step 2: `RetentionSettingsForm.vue` und `LegalOrganizationProfileForm.vue` auf `defineModel` umstellen

Beide leben in `pages/einstellungen/recht.vue`. `RetentionSettingsForm.vue`: `draft` → `defineModel<{...}>('draft', { required: true })`, Aufrufstelle Zeile 351 auf `v-model:draft="retentionDraft"`. `LegalOrganizationProfileForm.vue`: `profileDraft` → `defineModel<{...}>('profileDraft', { required: true })`, Aufrufstelle Zeile 349 auf `v-model:profile-draft="profileDraft"`.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0.

### Step 3: `IntegrationSourceCreateForm.vue` und `IntegrationSourceEditForm.vue` auf `defineModel` umstellen

Beide leben in `pages/integrationen.vue`. Je zwei Felder pro Komponente: `form` → `defineModel<{...}>('form', { required: true })`, `mappingRows` → `defineModel<MappingRow[]>('mappingRows', { required: true })`. Aufrufstellen Zeile 351 und 375 von `:form="createForm" :mapping-rows="mappingRows"` (bzw. `editForm`) auf `v-model:form="createForm" v-model:mapping-rows="mappingRows"`.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0. Manuell: Quelle anlegen/bearbeiten, Feldzuordnungszeile hinzufügen/entfernen prüft weiterhin denselben Ablauf.

### Step 4: `ChannelCard.vue` von fünf Record-Props auf fünf skalare `defineModel`-Felder umstellen

Ersetze die fünf `Record<string, string>`-Props durch fünf skalare Modelle: `purpose`, `editorialImprintUrl`, `editorialPrivacyUrl`, `editorialResponsibleProfileId`, `editorialResponsibleNote` (je `defineModel<string>('name', { required: true })`). Im Template entfällt der `[channel.id]`-Zugriff, z. B. `v-model="purposeDraft[channel.id]"` → `v-model="purpose"`. `pages/kanaele.vue:45` bindet jetzt `v-model:purpose="channelsState.purposeDraft[channel.id]"` usw. für alle fünf Felder statt der fünf `:x-draft="channelsState.xDraft"`-Props. `useChannels.ts` bleibt vollständig unverändert.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0, `pages/channelComposition.test.ts` bleibt grün (prüft nur String-Vorhandensein von `<ChannelCard`). Manuell: Kanal-Zweck und Impressumsfelder in `/kanaele` bearbeiten und speichern, Werte kommen unverändert in `savePurpose`/`saveEditorialFields` an.

### Step 5: `MemberList.vue` und `pages/mitglieder.vue` — Dictionaries durch skalare Refs ersetzen, dann `defineModel`

Anders als Schritt 1–4 ist das ein Zwei-Ebenen-Schritt: zuerst die Datenstruktur im Parent vereinfachen, dann erst die Prop-Schnittstelle umstellen — beides zusammen in einem Schritt, weil eine Zwischenstufe (Dictionary bleibt, nur Komponente auf `defineModel` umgestellt) syntaktisch nicht geht.

1. In `pages/mitglieder.vue`: `roleDraft`/`expiryDraft` (Zeile 244-245, `reactive<Record<...>>({})`) durch `const roleDraft = ref<AssignableRole | ''>('')` und `const expiryDraft = ref('')` ersetzen. Ebenso `trustSubmitAllowedDraft`/`trustRequirementDraft`/`trustReasonDraft`/`trustExpiryDraft` (Zeile 314-317) durch vier einfache `ref`s mit denselben Default-Werten wie bisher in `initTrustDraft` (`true`, `'inherit'`, `''`, `''`).
2. In `toggleExpanded` (Zeile 250-260): `roleDraft[entry.membershipId] = ...` → `roleDraft.value = ...`, ebenso `expiryDraft`. In `initTrustDraft` (Zeile 321-328): `xDraft[key] = ...` → `xDraft.value = ...` für alle vier Felder; der Parameter `key`/`entry.membershipId` entfällt dort ersatzlos.
3. In `changeRole` (Zeile 267-269): `roleDraft[entry.membershipId]` → `roleDraft.value`. In `setExpiry` (Zeile 285-289): `expiryDraft[entry.membershipId]` → `expiryDraft.value`. In `saveTrust` (Zeile 330-342): alle vier `xDraft[entry.membershipId]` → `xDraft.value`; `trustReasonDraft.value.trim()` braucht kein `?.` mehr, weil der Ref nie `undefined` ist.
4. In `MemberList.vue`: die sechs `Record<string, X>`-Props aus `defineProps` entfernen, durch sechs `defineModel`-Aufrufe ersetzen: `roleDraft` (`AssignableRole | ''`), `expiryDraft` (`string`), `trustSubmitAllowedDraft` (`boolean`), `trustRequirementDraft` (`ReviewRequirement`), `trustReasonDraft` (`string`), `trustExpiryDraft` (`string`) — je `{ required: true }`. Im Template jedes `xDraft[entry.membershipId]` durch `xDraft` ersetzen (Zeilen 50, 51, 56, 63-66) — das schließt den Button-Vergleich `roleDraft[entry.membershipId] === entry.role` (Zeile 51) ein.
5. In `pages/mitglieder.vue:433-455`: alle sechs `:x-draft="xDraft"`-Bindungen auf `v-model:x-draft="xDraft"` umstellen.

**Verify**: `cd apps/web && pnpm typecheck && pnpm test` → exit 0. Manuell in `/mitglieder`: eine Mitgliedschaft aufklappen, Rolle ändern **ohne zu speichern**, zuklappen, eine **andere** Mitgliedschaft aufklappen — deren Rolle/Befristung/Vertrauenseinstellungen müssen die eigenen sein, nicht die zuvor eingetragenen (das ist exakt das Szenario, das die Verhaltensäquivalenz aus „Current state“ beweist oder widerlegt). Danach Rolle ändern und speichern, Befristung setzen, Vertrauen speichern — je einmal, Ergebnis wie vor der Umstellung.

### Step 6: Regressionsschutz und Gesamtabnahme

Ergänze in `eslint.config.mjs` im `files: ['**/*.vue']`-Block `rules: { 'vue/no-mutating-props': 'error' }`. Lauf `pnpm lint` — jeder Fund bedeutet, dass ein vorheriger Schritt unvollständig war oder die Codebase-Prüfung oben eine achte Stelle übersehen hat.

**Verify**: `pnpm check` → exit 0.

## Done criteria

- [x] Keine der fünf Form-A-Komponenten, `ChannelCard.vue` oder `MemberList.vue` mutiert ihr Prop mehr direkt; alle nutzen `defineModel`.
- [x] Alle sieben betroffenen Aufrufstellen (`personas.vue`, `stilprofile.vue` ×2, `einstellungen/recht.vue` ×2, `integrationen.vue` ×2, `kanaele.vue`, `mitglieder.vue`) nutzen `v-model:feld=`.
- [x] `pages/mitglieder.vue` verwendet für die sechs Membership-Drafts einfache `ref`s statt `Record<string, X>`.
- [x] `vue/no-mutating-props` ist aktiv und findet keine Funde mehr.
- [x] `pnpm check` grün.
- [x] Manueller Test aus Schritt 5 (Zeilenwechsel ohne Speichern) bestätigt: kein Datendurchsickern zwischen zwei Mitgliedschaften.
- [x] Keine Änderung an `useChannels.ts`, `IntegrationSource*`-Fachlogik, API-Aufrufen oder sonstigem Nicht-Template-/Nicht-Draft-Code.

## STOP conditions

- Eine der Form-A-Komponenten liest oder schreibt ihr Draft-Prop noch an einer weiteren Stelle außerhalb des Templates (z. B. ein `watch` auf die Objektidentität) — dann prüfen, ob `defineModel`s Ref-Semantik das noch erfüllt, bevor umgestellt wird.
- Der manuelle Test in Schritt 5 zeigt Datendurchsickern zwischen zwei Mitgliedschaften — die in „Current state“ behauptete Verhaltensäquivalenz war falsch; nicht weitermachen, Ursache klären (evtl. gibt es doch einen Pfad, der zwei Einträge gleichzeitig referenziert, etwa durch schnelles Doppel-Klicken).
- `vue/no-mutating-props` findet einen achten, hier nicht erfassten Fall — Scope bewusst erweitern, nicht stillschweigend mitziehen.

## Maintenance notes

`defineModel<T>('name')` macht das Feld standardmäßig **optional**, auch wenn die ursprüngliche `defineProps<{...}>()`-Deklaration es implizit als Pflichtfeld typisierte. Jedes hier migrierte Feld wird an jeder bestehenden Aufrufstelle immer übergeben — deshalb überall `{ required: true }` setzen, sonst verschlechtert sich die Typsicherheit stillschweigend gegenüber dem Ist-Zustand.

`ChannelCard.vue` und `MemberList.vue` sahen im Diff ähnlich aus (beide Record-Props über eine Item-ID), sind aber strukturell verschieden: der entscheidende Unterschied ist, ob die Elternseite pro Zeile eine eigene Komponenteninstanz erzeugt (`kanaele.vue`, ja) oder die Komponente selbst über alle Zeilen iteriert (`mitglieder.vue`, nein). Bei `MemberList.vue` ging die Umstellung trotzdem, weil eine dritte Bedingung erfüllt war: die Liste zeigt ohnehin nur je eine Zeile gleichzeitig im Bearbeitungsmodus (`expandedMembershipId`), wodurch das Dictionary in Wahrheit nie mehr als einen lebenden Eintrag hatte. Bei jeder künftigen ähnlichen Komponente vor der `defineModel`-Entscheidung klären: (1) Eine Komponenteninstanz pro Zeile, oder (2) eine Instanz mit interner Iteration, aber nachweislich nur ein gleichzeitig editierbarer Eintrag. Nur wenn weder (1) noch (2) zutrifft, bleibt tatsächlich nur eine State-Redesign-Entscheidung außerhalb einer reinen `defineModel`-Umstellung.
