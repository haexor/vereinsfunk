# 005 – Kreative Plattformvarianten und Rendering

## Ergebnis

Aus echtem Quellmaterial entstehen pro Plattform eigenständige, authentische Texte und visuelle Formate: Feed-Bild, Carousel, Story und kurzer Reel-Entwurf. Training, Ballschule, Ehrenamt und Vereinsalltag erhalten ebenso gute Vorlagen wie Spiele. Bilder sind das Primärformat; Video ist optional, nicht der Produktkern.

## Ausgangslage und Evidenz

Geplant auf `unborn HEAD` am 2026-08-02.

- `GeneratedPostSchema` enthält nur eine Caption/ShortCaption und ein Template.
- `ClubPost.tsx:4-11` akzeptiert nur Verein, Eyebrow, Headline, Detail und Farben.
- `ClubPost.tsx:48-55` rendert eine sportlich-generische Textkarte mit festem Hashtag.
- `Root.tsx` registriert lediglich `ClubStory` und `ClubFeed`; aktuelle Defaults sind ergebnisorientiert.
- `post_versions` besitzt noch keine expliziten Plattform-/Formatvarianten.

Baseline:

```text
2b3384e745ccacbe2c19b5548f5e3735679b3b2058b091f2f8f6d42214891c52  packages/contracts/src/index.ts
ca0d48bca628e56f411671236cbe090b2605c8e5d76be922eba107535f30c9ab  packages/content-engine/src/index.ts
098441fb35aa51df178f30fe9fd39e99802c1dcebdbff84abb90d148adeafc87  apps/remotion/src/Root.tsx
```

## Scope

- Varianten-/Renderverträge und persistentes Modell
- LLM-Adaptergrenze mit Grounding, strukturierten Outputs und Fake
- Bild-/Carousel-/Story-Templates, optionale einfache Reels
- Brand-Profil, Layout-Sicherheit, Alt-Texte und Vorschau
- Hatchet-Renderworkflow und immutable Derivate

Nicht enthalten: autonome Recherche, erfundene Vereinsgeschichten, komplexe KI-Videogeneration, generative Veränderung realer Personen oder Provider-Publishing.

## Variantenmodell

Eine immutable `post_version` enthält die bestätigte Bedeutung. Darunter liegen ebenfalls immutable Varianten:

```ts
type PlatformVariant = {
  platform: 'instagram' | 'facebook'
  format: 'feed_image' | 'carousel' | 'story' | 'reel'
  headline: string
  caption: string
  callToAction: string
  hashtags: string[]
  altText: string
  slidePlan?: Array<{ role: string; headline?: string; body?: string; mediaAssetId?: string }>
  claimSourceIds: string[]
}
```

In der Datenbank `post_variants` mit Tenant, Post-Version, Plattform, Format, Schema-/Promptversion und Output; `render_requests`/`media_derivatives` referenzieren exakt Variante, Templateversion, Propshash und Eingangsderivate.

## Umsetzung

### 1. Generationsgrenze und belegte Aussagen

- Erweitere `ContentGenerator` um einen echten Provideradapter, ohne Provider-Typen in Domain/Contracts zu leaken.
- Provider erhält den `GroundedContentBrief` aus Plan 001, Brand-Ton und Plattformziel. Structured Output wird mit Zod validiert.
- Jede sachliche Aussage referenziert Source IDs; unbekannte Namen, Ergebnisse, Übungen, Zitate oder Emotionen werden abgelehnt bzw. zur Überarbeitung markiert.
- Authentizität entsteht aus Nutzerbeobachtungen: konkrete Übung, Stimmung, Lernmoment, Helferbeitrag, Zitat. Fehlt dies, fragt der Flow nach statt generische Jubeltexte zu produzieren.
- Speichere Modellname, Provider, Prompt-/Schema-Version, Token-/Kostenmetrik und Hash des Briefs, nicht versteckte Chain-of-Thought-Daten.

Tests: Halluzinations-/Injection-Fälle in Quellnotizen, deutsche Sonderzeichen, leere Beobachtungen, nicht genehmigte Zitate, lange Captions und plattformspezifische Varianten.

### 2. Kreativsystem statt Anlass-Templates

- Baue wiederverwendbare visuelle Bausteine: Vollbildfoto mit ruhiger Typografie, Zitatkarte, Fotocollage, Trainingsmoment, „3 Dinge heute“, Personenporträt, Einladung, Danke, Ergebnis.
- Anlass bestimmt Content-Struktur; Layoutfamilie bestimmt Gestaltung. So kann Ballschule Fotoessay, Carousel oder Story nutzen, ohne Spielschema.
- Brand-Profil erweitert um Logo-Varianten, Schriften mit Lizenz, Farbpaare, sichere Kontraste, Bildstil, wiederkehrende Formen und Tonbeispiele.
- Alle Templates haben feste Safe Areas und Text-Fit-Strategien; niemals ungeprüft Schrift abschneiden oder über Gesichter legen.
- Nur freigabefähige Derivate aus Plan 002/003 dürfen als Props eingehen.

MVP-Matrix:

| Familie | Feed 4:5 | Carousel | Story 9:16 | Reel 9:16 |
|---|---:|---:|---:|---:|
| Foto + Moment | ja | ja | ja | einfache Bewegung |
| Training/Ballschule | ja | ja | ja | einfache Clip-/Foto-Sequenz |
| Menschen/Ehrenamt | ja | ja | ja | später/pilotabhängig |
| Einladung/Angebot | ja | ja | ja | nein |
| Spiel/Ergebnis | ja | ja | ja | ja |

### 3. Remotion- und Still-Rendering

- Versioniere Zod-Props je Template und Composition. Rendering verwendet ausschließlich validierte Props und eingebettete/lizenzierte Assets.
- Nutze Remotion für deterministische Stills und einfache Videos; abstrahiere `Renderer`, sodass lokal und später Lambda/ECS denselben Vertrag erfüllen.
- Feed 1080×1350, Story/Reel 1080×1920; optionale 1080×1080-Ausgabe nur bei Pilotbedarf.
- Carousel-Slides teilen eine konsistente visuelle Hierarchie und Reihenfolge; letzte Folie darf CTA sein, wenn Quell-/Zielkontext passt.
- Rendere serverseitig, validiere tatsächliche Maße/MIME/Dateigröße und schreibe Hash in `media_derivatives`.

Tests: Props, Textüberlauf, Farbkontrast, fehlende Assets, deterministischer Propshash, Dimensions-/Codecprüfung und visuelle Snapshots zentraler Fixtures.

### 4. Varianteneditor und Vorschau

- Nuxt zeigt Instagram/Facebook und Formate getrennt; Nutzer kann Text bearbeiten, Slides umordnen und Layoutfamilie wechseln.
- Jede Bearbeitung erstellt eine neue Post-/Variantenrevision; alte Freigabe wird invalidiert.
- Zeige mobile Plattformvorschau, Alt-Text, Crop/Safe-Area und Kennzeichnung verdeckter Gesichter.
- Biete „authentischer machen“ als strukturierte Rückfrage (konkreter Moment/Zitat/Lernschritt), nicht als unkontrollierte Neuformulierung.
- Story/Reel können im MVP heruntergeladen werden, falls der direkte Providerweg das Format im geprüften API-Stand nicht unterstützt.

### 5. Hatchet-Integration und Kosten

- `process-submission` erzeugt Varianten idempotent; `render-content` rendert nur geänderte Props/Assets.
- Separate Fairness-/Concurrency-Klassen für Bild und Video. Stills haben Vorrang für den MVP; Videoarbeit darf Bildposts nicht blockieren.
- Usage Ledger misst LLM-Tokens, Rendersekunden, Outputbytes und fehlgeschlagene Versuche.
- Caching-Key: `postVariantId:templateVersion:propsHash:inputDerivativeHashes`.

## Verifikation

```bash
pnpm --filter @vereinsfunk/content-engine test
pnpm --filter @vereinsfunk/remotion test
pnpm --filter @vereinsfunk/worker test
pnpm --filter @vereinsfunk/web test
pnpm check
```

Inhaltliche Abnahme mit festen Fixtures: Ballschultraining, Arbeitseinsatz, Trainerporträt, Sommerfest, Sponsor-Dank und Spielergebnis. Je Fixture mindestens Instagram Feed und Story; drei Fixtures zusätzlich Carousel; ein Foto-Reel. Jede Aussage gegen Source IDs prüfen.

## Done-Kriterien

- Mindestens fünf Layoutfamilien decken nicht-spielbezogene Inhalte überzeugend ab.
- Feed, Carousel und Story funktionieren bildzentriert; Reel ist optionaler Zusatz.
- Texte sind strukturiert, plattformspezifisch und auf Nutzerquellen zurückführbar.
- Nur geprüfte Derivate erreichen Renderer; Renderoutput ist hashgebunden und reproduzierbar.
- Editoränderungen invalidieren Freigaben korrekt; visuelle/Unit/Workspace-Tests sind grün.

## STOP-Bedingungen

- Das gewählte LLM kann Structured Output/Grounding nicht stabil liefern: Provider nicht produktiv aktivieren, Fake und manuellen Editor behalten.
- Schrift-/Assetlizenz ist nicht dokumentiert: Asset nicht in Templates übernehmen.
- Ein Format erzwingt Veröffentlichung ungeprüfter Originalmedien: Format blockieren.

## Pflegehinweis

Prompt-, Schema- und Templateversionen gemeinsam erfassen. Monatlich Layoutnutzung, manuelle Textänderungsrate, Overflow-Fehler und Renderkosten auswerten; neue Templates nur bei wiederholtem Vereinsbedarf hinzufügen.
