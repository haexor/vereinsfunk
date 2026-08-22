# 050 – Marke-Logo automatisch im Bildstil, Presets erstmals in Beiträgen einsetzbar

> **Executor instructions**: Zwei PRs. **PR 0 ist Voraussetzung für PR 1**; PR 1 wird erst nach PR 0 rebased, integriert und gemergt. Nach jedem Schritt die angegebene Prüfung ausführen. Bei einer STOP-Bedingung anhalten und berichten, nicht improvisieren.
>
> **Drift check (run first)**: `git log --oneline -8 -- apps/api/src/routes/imageStyle.ts apps/api/src/imageStyle.ts packages/contracts/src/imageStyle.ts apps/web/app/pages/erstellen.vue apps/api/src/routes/content.ts packages/domain/src/brand.ts` und `git log --all --oneline -8 -- supabase/migrations` (Migrations-Timestamp-Kollisionen sind in diesem Repo wiederholt aufgetreten, siehe [[project_migrations_timestamp_kollision_ausfall]]). Falls sich `resolveBrand`, `loadResolvedBrandColors`, `image_style_presets` oder der `erstellen.vue`-Foto-Block seit Planung geändert haben, „Ausgangslage" neu verifizieren. Außerdem prüfen, ob dieser Worktree bereits `main` inkl. PR #131 (`197f858a`, Live-Vorschau/Logo-Entfernen) enthält — falls nicht, vor PR 0 rebasen, da die dortige `DELETE .../brand/logo`-Route für Schritt 2 dieses Pakets relevant ist.

## Ergebnis

Ein auf `/marke` (Verein/Abteilung/Mannschaft) hinterlegtes Logo landet **automatisch** in jedem gestylten Beitragsfoto — ohne dass beim Anlegen eines Bildstil-Presets ein Logo-Asset manuell ausgewählt werden muss. Presets steuern nur noch *ob* (`logo_enabled`), *wo* (Position) und *wie groß* (Größe/Abstand) das Logo erscheint; *welches* Logo, das entscheidet ausschließlich die Marke-Vererbungskette, genau wie bei Rahmen-/Duotonfarben schon heute. Zusätzlich wird die in Plan 045 geplante, aber nie umgesetzte PR 3 fertiggestellt: Beim Beitragserstellen kann eine Person ein oder mehrere Fotos anhängen, ein Bildstil-Preset wählen (oder bewusst keinen), und das System rendert das gewählte Preset serverseitig auf jedes veröffentlichte Foto.

## Ausgangslage und Evidenz

Geplant am 2026-08-22 auf `worktree-marke-verdrahtung` (Basis `3ba35b0b`), direkt gegen den Code verifiziert (nicht gegen `plans/*.md`-Statustexte, siehe [[feedback_plan_status_vor_umsetzung_gegen_code_pruefen]]).

**Farben fließen technisch, aber ohne echten Aufrufer im Beitragsfluss:**

- `loadResolvedBrandColors` (`apps/api/src/routes/imageStyle.ts:82-103`) löst über `resolveBrand` (`packages/domain/src/brand.ts:95-134`) die Vererbungskette Verein→Abteilung→Mannschaft zu `{ primaryColor, accentColor }` auf und wird von `POST /v1/post-media/:postMediaId/style-render` (`imageStyle.ts:262`) genutzt — Rahmenfarbe (`resolveFrameColorHex`) und Duoton-Filter (`applyDuotone`) funktionieren nachweislich (12 Pixelproben-Tests, Plan 045 PR 2).
- Diese Route hat aber **keinen Aufrufer in `apps/web`**. `apps/web/app/pages/erstellen.vue` enthält keine Referenz auf „Preset", „Bildstil" oder „style-render". Das ist die in Plan 045 selbst dokumentierte, offene PR 3 (`plans/045-bildstil-rahmen-logo-und-filter-fuer-beitragsfotos.md:296`: „Nicht in `erstellen.vue` verdrahtet … das ist PR 3s Aufgabe", `plans/README.md` Zeile 114: „PR 3 … noch nicht begonnen").

**Logo fließt gar nicht automatisch, und es gibt keinen belegten Grund für eine freie Auswahl:**

- `image_style_presets.logo_brand_asset_id` (Migration `2026081916_image_style_presets.sql:137-160`) ist eine rein manuelle Pro-Preset-Auswahl. `POST /v1/image-style-presets` (`apps/api/src/routes/imageStyle.ts:124-179`) übernimmt sie 1:1 aus dem Request, ohne Default aus der Marke. `apps/web/app/utils/imageStylePresetDraft.ts:24` initialisiert sie mit `null`.
- Auswählbar sind laut `LOGO_ASSET_KINDS` (`apps/api/src/routes/brand.ts:62`) nur `logo_primary`, `logo_light`, `logo_dark`, `logo_mark`, `wordmark`, `watermark` — laut `marke.vue:663-666` ausdrücklich „Formatvarianten desselben Vereinslogos" (Symbol, Wortmarke, Wasserzeichen), kein Fremd-/Sponsorlogo-Konzept. Eine repoweite Suche nach „sponsor" trifft nur eine unabhängige Beitrags-Kategorie (`packages/content-engine/src/presets.ts:10`), nicht das Brand-Asset-Modell. Es gibt also keinen legitimen Fall, in dem ein Preset ein *anderes* Logo als das Marke-Logo zeigen sollte.
- `resolveBrand` kennt `logoAssetId` bereits als `BRAND_LOCKABLE_FIELDS`-Eintrag (`packages/domain/src/brand.ts:25-31`) und würde ihn technisch mit auflösen — **aber** `loadResolvedBrandColors` verwirft das Ergebnis (Rückgabetyp nur `{ primaryColor, accentColor }`, `imageStyle.ts:101-102`), und `organization_brand_profiles` hat gar kein `logo_asset_id`-Feld, nur `logo_path`/`logo_dark_path` (Migration `2026080501_organization_profile_and_onboarding.sql`). Diese beiden Spalten sind laut Kommentar in `apps/api/src/routes/brand.ts:150-154` ein **denormalisierter Cache** auf die eigentliche Quelle: eine `brand_assets`-Zeile mit `kind='logo_primary'`/`'logo_dark'`, angelegt in derselben Route (`POST /v1/organizations/:id/brand/logo`, `brand.ts:104-207`, insbesondere Zeile 155-191). Nur `department_brand_profiles`/`team_brand_profiles` führen bereits eine echte `logo_asset_id`-FK (Migration `2026080702_brand_assets_and_fonts.sql:196,221`; Mapper `apiMappers.ts:88-104`).
- Es gibt aktuell **kein** Muster für eine kontextabhängige Hell/Dunkel-Logo-Auswahl (weder in `apps/remotion/src/ClubPost.tsx` noch in `apps/web`) — jede bestehende Stelle nutzt immer `logo_path` (die helle/primäre Variante). Dieses Paket erfindet dafür bewusst **kein** neues Kontrast-Heuristik: die Foto-Pipeline löst immer die primäre Logo-Variante auf (siehe Datenmodell unten). Eine automatische Hell/Dunkel-Wahl wäre eine Erweiterung ohne aktuellen Bedarf (Einfachheit zuerst) und bleibt bewusst zurückgestellt.

**Video/Remotion ist explizit außerhalb des Umfangs** (Nutzerentscheidung 2026-08-22): `apps/remotion/src/ClubPost.tsx` wendet Farbe/Schrift/Logo korrekt an, wird aber nirgends gerendert (kein `renderMedia`/`selectComposition`/`bundle(`-Treffer im ganzen Repo außerhalb von `node_modules`; `apps/worker` hat keine `@remotion/*`-Dependency). Der reservierte Workflow-Name `render-content` (`packages/contracts/src/workflow.ts:15`, Concurrency-Limit in `apps/worker/src/workflows.ts:46`) bleibt unangetastet — Plan 045 hat ihn ausdrücklich für ein „größeres, noch unrealisiertes Remotion-Vorhaben" reserviert (`plans/045-…:54`), dieses Paket dispatcht weiterhin nichts dorthin. Schriften-Felder in der Marke (`display_font_key`/`display_font_asset_id` etc.) bleiben unverändert bestehen, bekommen aber weiterhin keinen Verbraucher — das ist eine bewusste Folgeaufgabe, kein Fehler dieses Pakets.

**Foto-Anhang existiert schon, Bildstil ist die fehlende Ebene darüber:**

- `erstellen.vue:360-371`: `PhotoAttachmentList.vue` (Foto-Upload, Plan 045 PR 0/047 PR 0) + Umschalter „Karussell"/„Bildkomposition" + `PhotoLayoutGallery.vue` (Plan 047 PR 1, komponiert N Fotos zu einem Bild). Das ist bereits ein Karten-Raster-Vorbild (`PhotoLayoutGallery.vue:90-107`, Thumbnail-Buttons je Preset) — passender als der ursprünglich in Plan 045 referenzierte „Stilprofil-Picker" (`erstellen.vue:350`), der tatsächlich ein `SearchableSelect`-Dropdown ist, kein Karten-Raster.
- **Wichtiger Timing-Befund:** `post_media`-Zeilen existieren erst **nach** `accept_text_generation_candidate` (Migration `2026082005_accept_text_generation_candidate_multiple_media.sql`, `insert into public.post_media` innerhalb der Funktion). Vor „Annehmen" gibt es nur `composition_session_post_media` (Foto-Anhänge an der Sitzung, noch kein Beitrag). `POST /v1/post-media/:postMediaId/style-render` (`imageStyle.ts:262`) braucht zwingend eine existierende `post_media`-Zeile — ein Preset kann in `erstellen.vue` also **nicht** direkt beim Foto-Anhang gerendert werden, wie Plan 045 PR 3 es andeutete. Die Preset-*Auswahl* kann trotzdem an dieser Stelle im UI passieren (Karten-Raster neben der Foto-Galerie); der tatsächliche `style-render`-Aufruf muss serverseitig **nach** dem Accept-Schritt erfolgen, sobald `post_media`-Zeilen existieren. `POST /v1/text-workshop/candidates/:id/accept` (`apps/api/src/routes/content.ts:746-794`) reicht `accepted.data` unverändert an den Client durch; die RPC gibt aktuell nur `postVersionId`/`alreadyAccepted` zurück (Migration `2026082005`), keine `post_media`-IDs.

## Design-Entscheidungen (Nutzerentscheidung 2026-08-22)

1. **Logo immer aus der Marke, keine manuelle Asset-Auswahl im Preset mehr.** `image_style_presets.logo_brand_asset_id` (und die dazugehörige generierte Spalte `logo_brand_asset_kind` sowie ihre FK) entfallen. `logo_enabled` + `logo_position` + `logo_size_percent` + `logo_margin_percent` bleiben — das sind legitime Style-Entscheidungen pro Preset (z. B. „Spieltag"-Preset klein unten rechts, „festlich"-Preset groß mittig), *welches* Bild das ist, nicht mehr.
2. **Preset-Auswahl bleibt manuell**, wie ursprünglich in Plan 045 PR 3 vorgesehen (Karten-Raster analog `PhotoLayoutGallery.vue`) — kein einzelner erzwungener Default-Preset pro Ebene. Ein Verein mit mehreren anlassbezogenen Presets (Spieltag/festlich/neutral, siehe `bildstil.vue`s Mehrfach-Preset-Design) behält die Wahl.
3. **Roh-Upload ohne jeden Bildstil bleibt möglich.** Styling ist eine Option, kein Zwang — deckt bewusst ungestylte Fotos ab (z. B. Pressefoto). Die Karten-Auswahl bekommt eine explizite Option „Kein Bildstil".

## Scope

- Migration: `image_style_presets.logo_brand_asset_id`/`logo_brand_asset_kind` entfernen, CHECK-Constraint anpassen.
- `resolveBrand`-Aufrufstelle erweitert: effektive Logo-Asset-ID (Verein `brand_assets(kind='logo_primary', status='ready')` als Fallback, sonst Abteilung/Mannschaft `logo_asset_id`) wird zusätzlich zu Farben aufgelöst und beim Rendern statt `preset.logoBrandAssetId` verwendet.
- Contracts (`packages/contracts/src/imageStyle.ts`) und Route (`apps/api/src/routes/imageStyle.ts`) ohne `logoBrandAssetId`-Feld; `ImageStylePresetForm.vue` ohne Asset-Auswahl-Dropdown.
- `accept_text_generation_candidate` gibt zusätzlich die erzeugten `post_media`-IDs (in Position-Reihenfolge) zurück.
- `erstellen.vue`: Bildstil-Preset-Karten-Raster neben der Foto-Galerie (Auswahl vor Accept, Ausführung danach), automatischer `style-render`-Aufruf je erzeugter `post_media`-Zeile nach erfolgreichem Accept, wenn ein Preset gewählt wurde.

**Nicht enthalten:**

- Video/Remotion-Anbindung (siehe Ausgangslage — eigenständiges, größeres Folgepaket).
- Automatische Hell/Dunkel-Logo-Variantenwahl (bewusst zurückgestellt, siehe Ausgangslage).
- Änderungen an `photo_layout_presets`/Karussell-Publishing (Plan 047) — Bildstil wendet sich unverändert auf das an, was zum Accept-Zeitpunkt an `post_media` hängt (ob Einzelfoto, Karussell-Mehrfoto oder bereits komponiertes Layout-Bild, macht für diesen Schritt keinen Unterschied, da alle drei zu diesem Zeitpunkt bereits als fertige `post_media`-Zeilen vorliegen).
- Aufräumen bestehender, jetzt verwaister `image_style_presets`-Datensätze mit gesetztem `logo_brand_asset_id` — die Migration löscht die Spalte ersatzlos; da dieses Feld nie einen von der Marke abweichenden Wert *brauchte* (Design-Entscheidung 1), ist ein Datenverlust hier unkritisch, aber es gibt keine Migrationsdaten zu erhalten.

## Datenmodell (PR 0)

```sql
-- Reihenfolge wichtig: erst die FK/generierte Spalte, die davon abhängt, dann die Spalte selbst.
alter table public.image_style_presets
  drop constraint if exists image_style_presets_organization_id_logo_brand_asset_id_logo__fkey,
  drop column if exists logo_brand_asset_kind,
  drop column if exists logo_brand_asset_id,
  drop constraint if exists image_style_presets_check, -- exakter Name via \d+ image_style_presets vor der Migration verifizieren
  add constraint image_style_presets_logo_fields_check
    check (logo_enabled = (logo_size_percent is not null and logo_margin_percent is not null));
```

Der exakte Name der bestehenden FK- und CHECK-Constraints muss vor dem Schreiben der Migration gegen die tatsächliche DB verifiziert werden (`\d+ public.image_style_presets` gegen die lokale Instanz) — Postgres vergibt Constraint-Namen bei mehreren `check(...)`-Klauseln in einer `create table` nicht notwendigerweise in offensichtlicher Reihenfolge. Die `unique (organization_id, id, kind)`-Erweiterung auf `brand_assets` (Plan 045 PR 1) bleibt unverändert bestehen — sie wird weiterhin von `frame_brand_asset_id`s FK gebraucht.

**Migrations-Timestamp**: `2026082204` ist zum Planungszeitpunkt der nächste kollisionsfreie Wert (letzte bekannte: `2026082102`; ein anderer, gesperrter Worktree hat bereits `2026082201`-`2026082203` belegt) — **vor dem tatsächlichen Schreiben erneut per `git log --all --oneline -- supabase/migrations` prüfen**, siehe [[project_migrations_timestamp_kollision_ausfall]].

## Umsetzung

### PR 0 – Logo wird zur Marke-Sache

1. Migration wie oben (eigene Datei, siehe Timestamp-Hinweis).
2. `packages/contracts/src/imageStyle.ts`: `logoBrandAssetId` aus `ImageStylePresetFieldsSchema` (Zeile ~22-36) entfernen; `checkImageStylePresetFields` (Zeile ~54-57) auf `logoEnabled === (logoSizePercent !== null && logoMarginPercent !== null)` vereinfachen.
3. `apps/api/src/routes/imageStyle.ts`: Asset-Kind-Prüfschleifen für `logoBrandAssetId` (Create ~137-145, Update ~196-204) entfernen; Snapshot-Objekt (~366-371) ohne das Feld.
4. Neue Funktion `resolveEffectiveBrandLogoAssetId` (Geschwister zu `loadResolvedBrandColors`, gleiche Datei oder `packages/domain/src/brand.ts` falls dort passender): löst pro Ebene (Verein/Abteilung/Mannschaft) analog zu `resolveBrand` auf, aber mit einer zusätzlichen Vor-Abfrage für die Vereinsebene, da `organization_brand_profiles` kein `logo_asset_id`-Feld führt — `select id from brand_assets where organization_id = :orgId and department_id is null and team_id is null and kind = 'logo_primary' and status = 'ready'` liefert den Wert, den `resolveBrand` als `organization.logoAssetId` bekommt. Department-/Team-Ebene liefern ihr `logo_asset_id` bereits über die bestehenden Mapper (`apiMappers.ts:88-104`). `loadResolvedBrandColors` wird um dieses Feld erweitert (Rückgabetyp `{ primaryColor, accentColor, logoAssetId: string | null }`) — ein Aufrufer, der es ignoriert, bleibt unverändert lauffähig.
5. `renderImageStyle`/die Route (~336-350): `input.logoAssetBuffer` wird über die aufgelöste `logoAssetId` geladen (`downloadBrandAssetBuffer`), nicht mehr über `preset.logoBrandAssetId`. Ist `logoEnabled=true`, aber die aufgelöste `logoAssetId` `null` (kein Logo auf keiner Ebene hinterlegt), gibt die Route einen expliziten Fehler `brand_logo_missing` (409) statt eines rohen 500 aus `applyLogoWatermark`s `throw new Error('missing logo asset buffer')`.
   - *Prüfung*: Vitest — Preset mit `logoEnabled=true` und Marke ohne Logo liefert `409 brand_logo_missing`; Verein mit Logo, Abteilung ohne eigenes Logo erbt das Vereinslogo; Abteilung mit eigenem `department_brand_profiles.logo_asset_id` überschreibt es; Pixelprobe bestätigt, dass das im Ergebnis komposittete Logo tatsächlich das aufgelöste Asset ist (nicht mehr `preset.logoBrandAssetId`).
6. `apps/web/app/utils/imageStylePresetDraft.ts`: `logoBrandAssetId`-Feld entfernen. `ImageStylePresetForm.vue`: Zeile ~185-193 (Select + `logoAssets`-Prop) entfernen, Checkbox/Position/Größe/Abstand (Zeile ~181-183, 194-209) bleiben; `setLogoEnabled` (Zeile ~106-116) ohne das Nullen von `logoBrandAssetId`. `bildstil.vue`/aufrufende Stelle: `logoAssets`-Prop-Übergabe an das Formular entfernen, falls dort noch vorhanden.
   - *Prüfung*: Component-Test — Formular zeigt keine Asset-Auswahl mehr; Preset speichern/laden funktioniert ohne das Feld; bestehende `bildstil.vue`-Playwright-Abdeckung (Preset anlegen/bearbeiten) bleibt grün.
7. pgTAP: bestehende `image_style_presets`-Tests (`supabase/tests/image_style_presets.test.sql`) auf die neue Spaltenliste anpassen; kein neuer RLS-Test nötig (keine neue Berechtigungsgrenze).

### PR 1 – `erstellen.vue`-Integration (Plan 045 PR 3, fertiggestellt)

1. `accept_text_generation_candidate` (neue Migration, PR 0 dieses Pakets oder eigene Folgemigration): Rückgabe-`jsonb` um `postMediaIds` (Array, nach `position` sortiert, aus den in derselben Funktion eingefügten `post_media`-Zeilen) ergänzen. `apps/api/src/routes/content.ts:793` gibt `accepted.data` bereits unverändert durch — kein Route-Code nötig, nur der Contract/die Typannahme im Frontend.
2. `erstellen.vue`: Bildstil-Preset-Karten-Raster (Komponente `ImageStylePresetGallery.vue`, analog `PhotoLayoutGallery.vue:90-107`) direkt nach dem bestehenden Foto-Block (nach Zeile 371, vor der „Zielplattformen"-Fieldset Zeile 373), sichtbar sobald `mediaAssetIds.length > 0`. Optionen: alle `is_active`-Presets der aktuellen Ebene (inkl. vererbte, wie `bildstil.vue`) plus eine explizite Karte „Kein Bildstil" (Default). Gewählte `stylePresetId` (nullable) wird wie `selectedProfile`/`photoMode` Teil des Entwurfszustands (`saveServerDraft`/`restoreDraft`, gleicher Mechanismus wie bestehende Entwurfsfelder).
3. Accept-Aufruf-Stelle in `erstellen.vue` (wo `POST /v1/text-workshop/candidates/:id/accept` aufgerufen wird): nach erfolgreichem Accept, wenn `stylePresetId` gesetzt ist, für jede zurückgegebene `postMediaId` `POST /v1/post-media/:id/style-render` mit dieser `stylePresetId` aufrufen (sequenziell oder parallel, Fehresultat pro Foto einzeln anzeigen — ein fehlgeschlagenes Foto darf die anderen nicht blockieren). Zwischenzustand „Beitrag wird gestylt…" anzeigen, danach zur bestehenden Freigabe-Weiterleitung.
   - *Prüfung*: Playwright — Foto(s) anhängen, Preset wählen, Entwurf annehmen, Freigabe-Ansicht zeigt das gestylte Bild (Rahmen/Logo sichtbar); „Kein Bildstil" liefert das unveränderte Originalfoto; ein Preset mit `logoEnabled=true` ohne hinterlegtes Marke-Logo zeigt eine verständliche Fehlermeldung statt eines stillen Fehlschlags, der Beitrag bleibt trotzdem mit dem ungestylten Foto nutzbar (kein Blocker).
   - Zweiter Testfall: Mehrfoto-Karussell (Plan 047) und Bildkomposition (Layout) mit demselben gewählten Preset — beide Pfade erzeugen zum Accept-Zeitpunkt bereits die endgültige `post_media`-Zeilen-Menge, der Style-Render-Schritt braucht dafür keine Sonderfälle; das ist hier als Regressionstest zu bestätigen, nicht anzunehmen.

## Verifikation

```bash
pnpm --filter @vereinsfunk/api test
pnpm --filter @vereinsfunk/web test
pnpm --filter @vereinsfunk/domain test
pnpm check
```

Je PR zusätzlich pgTAP (`supabase/tests/`). End-to-End-Abnahme für PR 1: durchgängiger Playwright-Lauf Foto hochladen → Bildstil wählen → Entwurf annehmen → Freigeben, gegen den lokalen Stack.

## Done-Kriterien

- Ein neu angelegtes Bildstil-Preset hat kein Feld mehr zur Logo-Asset-Auswahl; das Logo im gerenderten Ergebnis entspricht immer dem effektiven Marke-Logo der Beitrags-Ebene (Vererbung Verein→Abteilung→Mannschaft, wie bei Farben).
- Ein Verein ohne hinterlegtes Logo bekommt bei einem Logo-Preset einen klaren, spezifischen Fehler statt eines 500ers.
- Beim Beitragserstellen ist ein Bildstil-Preset wählbar (oder bewusst keins), und das veröffentlichte/freigegebene Foto entspricht nachweislich dem gewählten Preset — für Einzelfoto, Karussell und Bildkomposition gleichermaßen.
- `POST /v1/post-media/:postMediaId/style-render` hat erstmals einen echten Aufrufer aus `apps/web`.

## STOP-Bedingungen

- Video/Remotion-Rendering wird doch für dieses Paket gebraucht: anhalten, das ist ausdrücklich Plan 045/das größere Folgepaket, nicht hier zu improvisieren.
- Der tatsächliche Constraint-Name in `image_style_presets` lässt sich nicht eindeutig ermitteln oder eine bestehende Migration muss nachträglich geändert werden (nie erlaubt, siehe Historie): anhalten, mit einer eigenen Folgemigration lösen.
- Eine automatische Hell/Dunkel-Logo-Auswahl wird doch als Anforderung gestellt, bevor dieses Paket beginnt: anhalten, das ist eine eigene, noch unentschiedene Design-Frage (siehe Ausgangslage), nicht nebenbei zu lösen.
