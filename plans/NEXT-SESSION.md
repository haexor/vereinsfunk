# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`.

## Ausgangslage: Plan 045 PR 0 und PR 1 sind fertig

`plans/045-bildstil-rahmen-logo-und-filter-fuer-beitragsfotos.md`, Abschnitte „Umsetzung: Ergebnis und Abweichungen" (PR 0, 2026-08-18 und PR 1, 2026-08-19):

- **PR 0**: die Foto-Pipeline (Upload, Personen-Prüfung, Pass-Through-Derivat, minimale Markier-UI) ist real — ein Foto ohne Styling ist Ende-zu-Ende veröffentlichbar.
- **PR 1**: Datenmodell (`image_style_presets`, `brand_asset_kind` um `frame` erweitert), CRUD-Routen (`GET/POST/PATCH/DELETE /v1/image-style-presets`), und die Verwaltungsseite `/bildstil` (Scope-Umschalter Verein/Abteilung/Mannschaft, Rahmen/Logo/Filter-Formular, CSS-Live-Vorschau, eigener Rahmengrafik-/Wasserzeichen-Upload). Ein Verein kann beliebig viele Presets je Ebene anlegen; eine Abteilung ohne eigenes Preset erbt weiterhin die vereinsweiten.

**Abweichungen vom ursprünglichen Plandokument** (Details je PR im Plandokument): PR 0 hatte keinen separaten Malware-Scanner (Betreiberentscheidung) und zwei per Playwright gefundene Grant-/`SECURITY DEFINER`-Lücken. PR 1: PATCH ersetzt den gesamten Bildstil-Anteil eines Presets statt einzelne Felder zu patchen (die CHECK-Constraints verknüpfen mehrere Spalten), der Upload-Einstieg für Rahmengrafik/Wasserzeichen sitzt auf `/bildstil` selbst statt auf `marke.vue`, und ein Klammerungsfehler in der Update-RLS-Policy (hätte die Waehlbarkeits-Prüfung nur auf dem Organisations-Zweig durchgesetzt) wurde per gezieltem pgTAP-Test noch vor dem ersten Commit gefangen.

Verifiziert (beide PRs): pgTAP (34 Dateien, 892 Assertions, nach frischem `supabase db reset`), `pnpm check`, echter Playwright-Lauf gegen die lokale App (Preset anlegen/bearbeiten/löschen auf Vereins- und Abteilungsebene, Vererbung sichtbar, Rahmengrafik-/Wasserzeichen-Upload, keine Konsolenfehler).

## Nächster Schritt

**Plan 045, PR 2** (Sharp-Compositing-Engine): `apps/api/src/imageStyle.ts` — parametrischer Rahmen, eigene Rahmengrafik, Logo-Platzierung, die fünf Filter (`original`/`schwarz_weiss`/`kontrastreich`/`warm`/`vereinsfarben_duoton`). Neue Route `POST /v1/post-media/:postMediaId/style-render`, die ein neues, unveränderliches gestyltes Derivat mit Rezept-Snapshot erzeugt (nie ein bereits `ready`-Derivat still neu rendern). PR 1 muss dafür in der Zielumgebung gemergt sein — PR 2 baut auf `image_style_presets` auf.

### Danach

- **PR 3 aus Plan 045**: `erstellen.vue`-Integration — Foto-Anhang + Preset-Auswahl (Karten-Raster wie der bestehende Stilprofil-Picker) + Live-Vorschau über signierte URL aus `rendered-media`. Braucht PR 2 zuerst.
- Die seit Paket 032 offene Lücke „Foto-/Video-Anhänge" ist für Fotos ohne Styling bereits geschlossen (PR 0). Videos bleiben außerhalb dieses Plans.
- **029**, **031** und **043** sind weiterhin als offen/bereit markiert, unabhängig von 045.

Falls diese Datei in einer künftigen Session nicht mehr aktuell aussieht, gilt `plans/README.md` als Quelle der Wahrheit, nicht dieser Prompt (siehe [[feedback_plan_status_vor_umsetzung_gegen_code_pruefen]]).
