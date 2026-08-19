# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`.

## Ausgangslage: Plan 045 PR 0, PR 1 und PR 2 sind fertig

`plans/045-bildstil-rahmen-logo-und-filter-fuer-beitragsfotos.md`, Abschnitte „Umsetzung: Ergebnis und Abweichungen" (PR 0, 2026-08-18; PR 1 und PR 2, 2026-08-19):

- **PR 0**: die Foto-Pipeline (Upload, Personen-Prüfung, Pass-Through-Derivat, minimale Markier-UI) ist real — ein Foto ohne Styling ist Ende-zu-Ende veröffentlichbar.
- **PR 1**: Datenmodell (`image_style_presets`, `brand_asset_kind` um `frame` erweitert), CRUD-Routen (`GET/POST/PATCH/DELETE /v1/image-style-presets`), und die Verwaltungsseite `/bildstil` (Scope-Umschalter Verein/Abteilung/Mannschaft, Rahmen/Logo/Filter-Formular, CSS-Live-Vorschau, eigener Rahmengrafik-/Wasserzeichen-Upload). Ein Verein kann beliebig viele Presets je Ebene anlegen; eine Abteilung ohne eigenes Preset erbt weiterhin die vereinsweiten. Vor dem Merge (PR #111) per eigenem, mehrperspektivischem Review (CodeRabbit war rate-limited) zwei Runden echter Funde behoben: Asset-Re-Upload superseded jetzt kein über die generische Route erreichbares Kind mehr (sonst wären bestehende Presets beim nächsten Speichern mit `invalid_asset_reference` gescheitert), und `selectScope()` nullt nur die beiden tatsächlich betroffenen Asset-Felder statt des ganzen Anlage-Entwurfs.
- **PR 2**: Sharp-Compositing-Engine (`apps/api/src/imageStyle.ts`) — alle fünf Filter, parametrischer Rahmen (inkl. abgerundeter Ecken), eigene Rahmengrafik, Logo-Wasserzeichen an allen fünf Positionen. Neue Route `POST /v1/post-media/:postMediaId/style-render` (Autorisierung über `post.edit` auf der Beitrags-Ebene, nicht `brand.manage`) plus die atomare RPC `apply_image_style_render`, die ein neues, unveränderliches gestyltes Derivat schreibt und `post_media` in derselben Transaktion darauf umzeigt.

**Abweichungen vom ursprünglichen Plandokument** (Details je PR im Plandokument): PR 0 hatte keinen separaten Malware-Scanner (Betreiberentscheidung) und zwei per Playwright gefundene Grant-/`SECURITY DEFINER`-Lücken. PR 1: PATCH ersetzt den gesamten Bildstil-Anteil eines Presets statt einzelne Felder zu patchen, der Upload-Einstieg für Rahmengrafik/Wasserzeichen sitzt auf `/bildstil` selbst statt auf `marke.vue`, ein Klammerungsfehler in der Update-RLS-Policy wurde per pgTAP vor dem ersten Commit gefangen, zwei echte Review-Funde vor dem Merge behoben (siehe oben). PR 2: Duoton hat keine direkte Sharp-Entsprechung (manuelle Pixel-Interpolation zwischen Vereinsfarben über die Luminanz), `warm` ist eine feste Farbentscheidung (`.tint({r:255,g:200,b:150})`), `frameColor`/Duoton lösen erstmals serverseitig über `packages/domain`s `resolveBrand()` gegen die tatsächlich vererbte Vereinsfarbe der Beitrags-Ebene auf, und `apply_image_style_render` leitet die `post.edit`-Berechtigung bewusst nicht selbst her (die Route prüft sie vorher über den Nutzer-Client — die volle Rollen-Kaskade in SQL zu duplizieren wäre ein eigenes Wartungsrisiko gewesen).

Verifiziert: PR 0/1 per pgTAP (34 Dateien, 892 Assertions, nach frischem `supabase db reset`), `pnpm check`, echter Playwright-Lauf gegen die lokale App. PR 2 per 12 Pixelproben-Tests gegen echtes `sharp` (keine Mocks), 6 neue Route-Tests, 9 pgTAP-Assertions für die neue RPC (rollback-gekapselt gegen die geteilte lokale Supabase-Instanz gefahren, ohne deren Zustand zu verändern), `pnpm check`.

## Nächster Schritt

**Plan 045, PR 3** (`erstellen.vue`-Integration): Foto-Anhang + Preset-Auswahl (Karten-Raster wie der bestehende Stilprofil-Picker) + Live-Vorschau über signierte URL aus `rendered-media` (`POST /v1/post-media/:postMediaId/style-render` aus PR 2 aufrufen). PR 2 ist fertig, aber noch nicht gemergt — vor Beginn von PR 3 prüfen, ob es schon gemergt ist.

### Danach

- Die seit Paket 032 offene Lücke „Foto-/Video-Anhänge" ist für Fotos ohne Styling bereits geschlossen (PR 0), mit Styling nach PR 3 vollständig. Videos bleiben außerhalb dieses Plans.
- **029**, **031** und **043** sind weiterhin als offen/bereit markiert, unabhängig von 045.

Falls diese Datei in einer künftigen Session nicht mehr aktuell aussieht, gilt `plans/README.md` als Quelle der Wahrheit, nicht dieser Prompt (siehe [[feedback_plan_status_vor_umsetzung_gegen_code_pruefen]]).
