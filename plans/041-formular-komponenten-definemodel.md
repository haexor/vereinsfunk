# Plan 041: Prop-Mutation in Formular-Komponenten durch `defineModel` ersetzen

> **Executor instructions**: Rein mechanischer Refaktor, keine Verhaltensänderung. Jeder Schritt ändert eine Komponente **und** alle ihre Aufrufstellen zusammen — ein halb migrierter Schritt bricht die Zwei-Wege-Bindung, weil `defineModel` `v-model:prop=` an der Aufrufstelle voraussetzt, nicht mehr `:prop=` mit späterer direkter Mutation.
>
> **Drift check (run first)**: `git diff --stat 28dce97c..HEAD -- apps/web/app/components apps/web/app/pages`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (mechanisch, keine Fachlogik betroffen; eine Komponente bewusst ausgeklammert, siehe unten)
- **Depends on**: none
- **Category**: refactor, code quality
- **Planned at**: commit `28dce97c`, 2026-08-13

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

**Form B — Record<string, X>-Prop, indiziert über eine zur Laufzeit wechselnde ID (braucht echte Umstrukturierung statt reinem API-Tausch):**

| Komponente | Props | Aufrufstelle |
|---|---|---|
| `components/ChannelCard.vue:4-17` | `purposeDraft`, `editorialImprintUrlDraft`, `editorialPrivacyUrlDraft`, `editorialResponsibleProfileIdDraft`, `editorialResponsibleNoteDraft` (je `Record<string, string>`, indiziert über `channel.id`) | `pages/kanaele.vue:45` |
| `components/MemberList.vue:5-27` | `roleDraft`, `expiryDraft`, `trustSubmitAllowedDraft`, `trustRequirementDraft`, `trustReasonDraft`, `trustExpiryDraft` (indiziert über `entry.membershipId`) | `pages/mitglieder.vue:433` |

Der Unterschied zwischen beiden ist entscheidend für dieses Vorhaben:

- `ChannelCard.vue` bekommt genau **eine** Karte pro `<ChannelCard>`-Aufruf — `pages/kanaele.vue:45` iteriert selbst per `v-for="channel in channelsState.channels"` und übergibt jeder Instanz das komplette Dictionary, nur um daraus intern den einen für sie relevanten Eintrag `purposeDraft[channel.id]` zu lesen/schreiben. Das lässt sich verlustfrei in fünf skalare `defineModel`-Felder auflösen: die Komponente bekommt statt `purposeDraft: Record<string,string>` nur noch `purpose: string`, und die Aufrufstelle bindet `v-model:purpose="channelsState.purposeDraft[channel.id]"` — Vue erlaubt `v-model` auf einen beliebigen Lvalue-Ausdruck, auch einen dynamischen Property-Zugriff. `useChannels.ts` selbst (die Dictionaries, ihre Initialisierung, `savePurpose`/`saveEditorialFields`) bleibt unverändert; nur die Bindungssyntax an der einen Aufrufstelle und die Prop-Signatur von `ChannelCard.vue` ändern sich.
- `MemberList.vue` ist dagegen selbst eine Listenkomponente: `pages/mitglieder.vue:433` erzeugt nur **eine** `<MemberList>`-Instanz, die intern per `v-for="member in members"` und einem verschachtelten, nach `expandedMembershipId` gefilterten `v-for` (Zeile 47) über beliebig viele Mitgliedschaften iteriert und für die aktuell aufgeklappte per dynamischem Schlüssel `entry.membershipId` in die sechs Dictionaries greift. Ein `defineModel` kann nicht durch einen zur Laufzeit wechselnden Schlüssel parametrisiert werden — ein einzelnes skalares Modell pro Feld gibt es hier nicht, weil die Komponente selbst entscheidet, für welchen Eintrag es gerade gilt. Eine echte Lösung bräuchte eine Restrukturierung von `pages/mitglieder.vue`: statt sechs flacher, für alle Mitglieder vorgehaltener Dictionaries ein einzelnes „aktueller Entwurf“-Objekt nach dem in `pages/stilprofile.vue` (`editDraft`/`startEdit`) bereits etablierten Muster, das bei jedem `toggleExpanded` neu befüllt wird. Das ist eine Zustands-Redesign-Entscheidung in `changeRole`/`setExpiry`/`saveTrust` und `toggleExpanded`, keine reine API-Fassaden-Änderung — **bewusst nicht Teil dieses Plans**, siehe „Out of scope“.

Randfund, keine Aktion nötig: `components/ProcessorAgreements.vue:15` hat ein `agreementForm`, das per `reactive()` **lokaler** Komponentenzustand ist, kein Prop — trotz `v-model="agreementForm.*"` kein Fall dieses Musters.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `cd apps/web && pnpm typecheck` | exit 0 |
| Web-Tests | `cd apps/web && pnpm test` | exit 0, inkl. `pages/channelComposition.test.ts` (prüft nur das Vorhandensein von `<ChannelCard`, bleibt bestehen) |
| Build | `pnpm build --filter=@vereinsfunk/web` | exit 0 |
| Voller Gate | `pnpm check` | exit 0 |
| Restmuster prüfen | `grep -rn 'v-model="\(draft\|profileDraft\|form\)\.' apps/web/app/components` | keine Treffer außer bereits auf `defineModel` umgestellten Komponenten (dort ist es dann kein Prop mehr, sondern der `defineModel`-Rückgabewert — Treffer erwartbar, aber `defineProps` in derselben Datei sollte das Feld nicht mehr enthalten) |

## Scope

**In scope**

- Form A: `StyleProfileEditorForm.vue`, `RetentionSettingsForm.vue`, `LegalOrganizationProfileForm.vue`, `IntegrationSourceCreateForm.vue`, `IntegrationSourceEditForm.vue` — je auf `defineModel` umgestellt, samt aller Aufrufstellen.
- Form B, nur `ChannelCard.vue` — fünf Record-Props durch fünf skalare `defineModel`-Felder ersetzt, `pages/kanaele.vue` entsprechend angepasst.
- Neue ESLint-Regel `vue/no-mutating-props: 'error'` im `**/*.vue`-Block von `eslint.config.mjs`, als Regressionsschutz nach Abschluss der Migration.

**Out of scope**

- `MemberList.vue` / `pages/mitglieder.vue` — braucht ein Zustands-Redesign (Dictionary → aktueller Entwurf), keine reine API-Umstellung; verdient einen eigenen Plan, falls gewünscht.
- Aktivierung von `eslint-plugin-vue`s vollem `flat/recommended`-Regelsatz — würde unabhängig von diesem Vorhaben zusätzliche, hier nicht untersuchte Lint-Funde aufreißen.
- Jede Verhaltens- oder UX-Änderung; die Zustandsformen in `useChannels.ts` und den betroffenen Seiten bleiben identisch, nur die Bindungssyntax ändert sich.
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

### Step 5: Regressionsschutz und Gesamtabnahme

Ergänze in `eslint.config.mjs` im `files: ['**/*.vue']`-Block `rules: { 'vue/no-mutating-props': 'error' }`. Lauf `pnpm lint` — er darf ausschließlich in `MemberList.vue` (bewusst ausgeklammert, siehe „Out of scope“) neue Funde zeigen; jeder andere neue Fund bedeutet, dass Schritt 1–4 unvollständig war oder die Codebase-Prüfung oben eine achte Stelle übersehen hat.

**Verify**: `pnpm check` → exit 0 bis auf den erwarteten `MemberList.vue`-Fund. Falls `MemberList.vue` zu einem harten Lint-Fehler wird statt einer Warnung: entweder gezielt per `// eslint-disable-next-line vue/no-mutating-props` mit Verweis auf diesen Plan kommentieren, oder die Regel vorerst als `'warn'` statt `'error'` setzen — Entscheidung dem Ausführenden überlassen, mit Begründung im PR.

## Done criteria

- [ ] Keine der fünf Form-A-Komponenten und `ChannelCard.vue` mutiert ihr Prop mehr direkt; alle nutzen `defineModel`.
- [ ] Alle sechs betroffenen Aufrufstellen (`personas.vue`, `stilprofile.vue` ×2, `einstellungen/recht.vue` ×2, `integrationen.vue` ×2, `kanaele.vue`) nutzen `v-model:feld=`.
- [ ] `vue/no-mutating-props` ist aktiv; einziger verbleibender Fund ist `MemberList.vue`, mit Begründung im PR benannt.
- [ ] `pnpm check` grün (abgesehen vom erwarteten Lint-Fund).
- [ ] Keine Änderung an `useChannels.ts`, `IntegrationSource*`-Fachlogik oder sonstigem Nicht-Template-Code außer den Prop-Deklarationen selbst.

## STOP conditions

- Eine der Form-A-Komponenten liest oder schreibt ihr Draft-Prop noch an einer weiteren Stelle außerhalb des Templates (z. B. ein `watch` auf die Objektidentität) — dann prüfen, ob `defineModel`s Ref-Semantik das noch erfüllt, bevor umgestellt wird.
- `vue/no-mutating-props` findet einen achten, hier nicht erfassten Fall — Scope bewusst erweitern, nicht stillschweigend mitziehen.
- Der Ausführende ist geneigt, `MemberList.vue` "schnell mit" zu migrieren — nicht ohne die in „Current state“ beschriebene Zustands-Restrukturierung von `pages/mitglieder.vue` einzuplanen und separat zu entscheiden.

## Maintenance notes

`defineModel<T>('name')` macht das Feld standardmäßig **optional**, auch wenn die ursprüngliche `defineProps<{...}>()`-Deklaration es implizit als Pflichtfeld typisierte. Jedes hier migrierte Feld wird an jeder bestehenden Aufrufstelle immer übergeben — deshalb überall `{ required: true }` setzen, sonst verschlechtert sich die Typsicherheit stillschweigend gegenüber dem Ist-Zustand.

`ChannelCard.vue` und `MemberList.vue` sehen im Diff ähnlich aus (beide Record-Props über eine Item-ID), sind aber strukturell verschieden: der entscheidende Unterschied ist, ob die Elternseite pro Zeile eine eigene Komponenteninstanz erzeugt (`kanaele.vue`, ja) oder die Komponente selbst über alle Zeilen iteriert (`mitglieder.vue`, nein). Bei jeder künftigen ähnlichen Komponente zuerst diese Frage klären, bevor `defineModel` als Lösung angenommen wird.
