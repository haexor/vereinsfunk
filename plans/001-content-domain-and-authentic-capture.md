# 001 – Inhaltsmodell und authentische Erfassung

## Ergebnis

Die Erstellung ist nicht mehr auf vier Spiel-/Terminarten begrenzt. Nutzer wählen einen Anlass, ein Kommunikationsziel und gewünschte Ausgabeformate, erfassen anschließend ausschließlich belastbares Quellmaterial. Ein generischer Freitext-Anlass deckt Vereinsleben ohne passende Vorlage ab.

## Ausgangslage und Evidenz

Geplant auf `unborn HEAD` am 2026-08-02.

- `packages/contracts/src/index.ts:12-17` definiert nur `match_result`, `match_announcement`, `member_recruitment`, `event`.
- `packages/content-engine/src/index.ts:11-16` verlangt Fakten ausschließlich für diese vier Typen.
- `apps/web/app/pages/erstellen.vue:12-26` verdrahtet dieselben vier Typen und deren Formulare hart.
- `supabase/migrations/202608020001_initial_tenant_foundation.sql:137` begrenzt `submissions.content_type` per CHECK auf diese Werte.
- Der Upload in `apps/web/app/pages/erstellen.vue:90` ist bisher nur Darstellung; die Umsetzung folgt in Plan 002.

Baseline-Hashes:

```text
2b3384e745ccacbe2c19b5548f5e3735679b3b2058b091f2f8f6d42214891c52  packages/contracts/src/index.ts
ca0d48bca628e56f411671236cbe090b2605c8e5d76be922eba107535f30c9ab  packages/content-engine/src/index.ts
28dc50f3bec1cc32a9e8925d82ff67c712ab15632ea28313c380264b5d082194  apps/web/app/pages/erstellen.vue
0e2b191a196ea146385d7cb4409f7f3669c2f98cd9b950afd2988d81e561db5b  supabase/migrations/202608020001_initial_tenant_foundation.sql
```

Vor Beginn die vollständigen Werte mit `sha256sum` prüfen (siehe `plans/README.md`). Bei Abweichung zuerst die betroffenen Abschnitte neu lesen und diesen Plan aktualisieren.

## Scope

Änderungen an:

- `packages/contracts/src/index.ts` und `packages/contracts/src/contracts.test.ts`
- `packages/content-engine/src/index.ts`, Tests und neue Preset-Module unter `packages/content-engine/src/`
- `apps/web/app/pages/erstellen.vue` sowie neue Komponenten unter `apps/web/app/components/content/`
- neue additive Supabase-Migration und `supabase/tests/tenant_rls.test.sql`
- `docs/product/implementation-plan.md` und ein ADR für das flexible Inhaltsmodell

Nicht enthalten: echtes LLM, Medienpersistenz, Bildbearbeitung, Rendering und Publishing.

## Fachliches Modell

Anlass, Kommunikationsziel und Format sind orthogonal:

```ts
type ContentPresetSlug = string // kebab/snake slug; kein DB-Enum
type CommunicationGoal =
  | 'inform' | 'inspire' | 'thank' | 'invite'
  | 'recruit' | 'educate' | 'strengthen_community'
type OutputFormat = 'feed_image' | 'carousel' | 'story' | 'reel'

interface SourceMaterial {
  facts: Record<string, string | number | boolean>
  observations: string[]
  quotes: Array<{ text: string; attribution?: string; approved: boolean }>
  doNotMention: string[]
}
```

System-Presets:

`training_insight`, `club_life`, `children_program`, `people_spotlight`, `volunteering`, `behind_the_scenes`, `new_offer`, `event`, `celebration`, `member_recruitment`, `sponsor`, `education_tip`, `match_announcement`, `match_result`, `freeform`.

Die Preset-Registry enthält Label, Hilfetext, vorgeschlagene Felder und Pflichtangaben. Die Datenbank speichert nur einen validierten Slug; neue Presets erfordern keine Migration. `freeform` verlangt mindestens eine bestätigte Beobachtung oder einen Fakt.

## Umsetzung

### 1. Verträge entkoppeln

- Ersetze `ContentTypeSchema` durch ein Slug-Schema und exportiere die fachlichen Schemas für Ziel, Format und Quellmaterial.
- Ändere `CreateSubmissionSchema` auf `presetSlug`, `communicationGoal`, `requestedFormats` und `sourceMaterial`.
- Begrenze Texte/Arrays und lehne leere oder unbekannt strukturierte Payloads ab. `quotes[].approved === false` darf nie in `verifiedFacts` gelangen.
- Behalte einen temporären Parser für alte vier Payloads nur dann, wenn bestehende persistierte Daten existieren; bei der aktuellen uncommitted Prototype-Datenbank ist eine klare Migration vorzuziehen.

Tests: alle System-Slugs, beliebiger gültiger Custom-Slug, ungültige Slugs, leeres Quellmaterial, nicht freigegebenes Zitat, Größenlimits und bisherige Workflow-Payloads.

### 2. Preset-Registry und Grounding-Regeln

- Lege `packages/content-engine/src/presets.ts` als zentrale Registry an.
- Implementiere `validateSourceMaterial(preset, material)`, das `missingFacts` liefert, ohne Inhalte zu erfinden.
- Formuliere einen `GroundedContentBrief`: `allowedClaims`, `approvedQuotes`, `missingFacts`, `prohibitedClaims`, Ziel und Formate.
- Passe `ContentGenerator` so an, dass jeder echte und der Fake-Adapter denselben Brief erhält. Der Fake-Generator muss Ballschule/Training und freie Vereinsgeschichten abbilden.

Invariante:

```ts
generatedClaims.every((claim) => brief.allowedClaims.includes(claim.sourceId))
```

Tests: Training ohne Wettbewerb, Ballschule mit Kinder-Hinweis, Ehrenamt, freier Anlass sowie fehlende Pflichtangaben. Ein Snapshot darf keine unbelegte Spielannahme enthalten.

### 3. Datenbank additiv migrieren

- Erstelle eine neue Migration; ändere die vorhandene Initialmigration nicht rückwirkend.
- Entferne den starren CHECK auf `content_type`, benenne die Spalte entweder additiv in `preset_slug` um oder führe sie mit Datenmigration ein.
- Ergänze `communication_goal`, `requested_formats jsonb` und `source_material jsonb` mit serverseitigen Form-/Größenchecks.
- Halte `facts` nur während einer nachvollziehbaren Datenmigration; entferne doppelte Source-of-Truth-Felder danach.
- Aktualisiere zusammengesetzte FKs und RLS nicht durch Lockerung. Ergänze Tests für organisationsfremdes Lesen/Schreiben der neuen Felder.

### 4. Erstellfluss in Nuxt

- Zerlege die monolithische Seite in Preset-Auswahl, Zielauswahl, dynamisches Quellenformular und Zusammenfassung.
- Zeige „Ballschule & Kinderangebote“, „Trainingseinblick“, „Vereinsleben“ und „Eigene Geschichte“ prominent vor Spielinhalten.
- Erfasse Beobachtungen in natürlicher Sprache (z. B. „Heute haben die Kinder Balancieren und Werfen geübt“), Fakten und nur explizit freigegebene Zitate.
- Fordere keine Ergebnisfelder für Training oder Ballschule. Zeige stets: „Die KI formuliert; sie ergänzt keine Ereignisse oder Aussagen.“
- Entferne feste Demo-UUIDs aus dem endgültigen Requestpfad; IDs kommen aus Sitzung/gewählter Abteilung. Lokale Demo-Daten dürfen nur hinter einem expliziten Dev-Flag existieren.

Komponententests: Tastaturbedienung, Preset-Wechsel ohne stille Datenverluste, Validierung, freier Anlass und Request-Payload.

### 5. Dokumentation

- Aktualisiere den Produktplan: Content-Werkstatt statt spielzentrierter Generator.
- Dokumentiere in einem ADR die Trennung von Anlass/Ziel/Format, das flexible Slug-Modell und das Grounding-Gebot.

## Verifikation

```bash
pnpm --filter @vereinsfunk/contracts test
pnpm --filter @vereinsfunk/content-engine test
pnpm --filter @vereinsfunk/web typecheck
pnpm db:reset
pnpm db:test
pnpm check
```

Manueller Test: Eine Person erstellt je einen Beitrag für Ballschultraining, Helfer-Dank, Sommerfest, Spielergebnis und einen freien Anlass. Keiner der Flows verlangt sachfremde Spielfelder; die Vorschau kennzeichnet offene Fakten.

## Done-Kriterien

- Alle 15 Presets plus freier Anlass sind verwendbar.
- Anlass, Ziel und Ausgabeformat sind getrennt gespeichert und validiert.
- Nicht bestätigte Angaben/Zitate gelangen nicht als verifizierte Aussage in den Entwurf.
- Datenbank und UI besitzen keine Vier-Typen-Begrenzung mehr.
- RLS- sowie Workspace-Checks sind grün und ADR/Produktplan aktuell.

## STOP-Bedingungen

- Es gibt bereits produktive `submissions`: Migration nicht ohne Backfill- und Rollback-Nachweis ausführen.
- Produktverantwortliche verlangen frei erfundene Ausschmückung: Entscheidung explizit eskalieren; Grounding nicht still lockern.
- Neue Mandantentabellen oder service-role-only UI-Zugriffe werden nötig: zunächst AGENTS.md/ADR-001 neu bewerten.

## Pflegehinweis

Neue Presets werden in Registry, UI-Katalog und Tests ergänzt, aber nicht als DB-CHECK. Alle sechs Monate anhand Pilotnutzung veraltete Presets aus der Auswahl ausblenden; gespeicherte Slugs bleiben lesbar.
