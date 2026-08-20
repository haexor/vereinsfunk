# Paket 047: Mehrere Fotos je Beitrag — Bildkomposition und Karussell

Stand: 2026-08-20. PR 0 (Mehrfach-Foto-Grundlage) umgesetzt. PR 1 (Bildkomposition per Sharp) und PR 2 (echtes Meta-Karussell) noch nicht begonnen.

## Ausgangslage

Ein Beitrag trug bislang genau ein Foto — eine bewusste Pilot-Entscheidung aus Plan 045 ("Nicht enthalten: Mehrere Fotos/Karussell pro Beitrag"). Der Nutzer möchte Beiträge mit mehreren Fotos: zum einen zu einem Bild komponierte Layouts (Diagonal-Split, Raster, gemischtes Raster), zum anderen echte Mehrfach-Foto-Karussells (mehrere separate Slides, wie ein Instagram-Karussell).

Die Grenze saß an drei Stellen: der DB-Tabelle `composition_session_post_media` (`role='primary'`, `position=0`, `unique(composition_session_id)`), der API-Route `POST /v1/text-workshop/sessions` (`422 text_only_pilot` bei mehr als einem Foto) und dem Frontend (`PhotoAttachment.vue`, skalares Modell).

Recherche-Befund vor dem Bauen: die meisten umliegenden Systeme sind bereits pro-Medienobjekt statt pro-Beitrag ausgelegt und brauchten für die Grundlage keine Änderung — Personen-/Consent-Prüfung (`face_regions`, `confirm_media_people_review`, `apps/api/src/services/mediaGate.ts`) läuft je Medien-Asset. Speicherkontingente (`2026081302_subscriptions_and_content_quotas.sql`) zählen Bytes bzw. Beiträge, nie Fotos je Beitrag. `post_media`/`approval_media_snapshots` selbst sind an der Tabelle schon mehrfach-fähig (positionsbasiert). `apps/api/src/routes/publishing.ts` loopt für andere Zwecke bereits über alle `post_media`-Zeilen einer Fassung, aber `MetaPublisher.publish()` (`packages/publishing/src/index.ts`) nimmt bislang nur das erste Foto — ein echtes Karussell braucht die Meta-Graph-API-Karussell-Flow, die es noch nicht gibt (PR 2).

## Entschiedene Fragen

1. **Beides**: sowohl Bildkomposition (mehrere Fotos → ein Ergebnisfoto) als auch echtes Karussell (mehrere Fotos → mehrere Slides) sollen entstehen — nicht nur eines der beiden.
2. **Rendering-Technik für die Komposition**: Sharp statt Remotion. Remotion hat aktuell keine echte Rendering-Pipeline (kein `@remotion/renderer`, kein Hatchet-Executor jenseits von `generate-text-post`, `ClubPost.tsx` verzweigt trotz `layoutFamily: 'collage'`-Enum-Wert nirgends auf Mehrfoto-Layouts) — Sharp liefert dieselbe Bildklasse mit der bereits vorhandenen Technik aus `apps/api/src/imageStyle.ts` (SVG-Overlays, `sharp().composite()`), ohne neue Infrastruktur.
3. **Zwei getrennte Ausgaben, eine gemeinsame Grundlage**: Komposition verdichtet N Quellfotos auf ein Ergebnisfoto (genau ein `post_media`, unverändert wie heute — kein Eingriff in Freigabe/Kontingente/Publishing nötig). Karussell behält N eigenständige Fotos und braucht die Meta-Karussell-Flow. Beide teilen sich PR 0.

## PR 0 — Mehrfach-Foto-Grundlage (umgesetzt)

- **DB** (`2026082004_composition_session_post_media_multiple.sql`): `composition_session_post_media` von "genau ein Anhang je Sitzung" (`role='primary'` CHECK, `position=0` CHECK, `unique(composition_session_id)`) auf N Anhänge mit echter Position umgestellt (`role in ('primary','slide')`, `position >= 0`, `unique(composition_session_id, position)`).
- **DB** (`2026082005_accept_text_generation_candidate_multiple_media.sql`): `accept_text_generation_candidate` nimmt jetzt `p_media_derivative_ids uuid[]` statt höchstens einer skalaren ID. Reihenfolge im Array wird zur `position` der entstehenden `post_media`-Zeilen; Index 0 wird `'primary'`, alles danach `'slide'` (dieselbe Konvention wie `apps/api/src/routes/publishing.ts`). Die alte Zweiargument- und Dreiargument-Skalar-Signatur wurde vor dem `create or replace` explizit gedroppt (sonst legt Postgres eine zusätzliche überladene Variante an, statt zu ersetzen).
- **API** (`apps/api/src/routes/content.ts`): der `text_only_pilot`-Guard prüft nur noch `requestedFormats` (weiterhin ausschließlich `text_post`), nicht mehr die Anzahl der Fotos. `POST /v1/text-workshop/sessions` validiert jedes Foto einzeln (Zugehörigkeit, `upload_status`, `people_reviewed_at`), hasht `mediaAssetIds` (Reihenfolge relevant) statt einer einzelnen ID, und upsert't N Zeilen in `composition_session_post_media` in einem Aufruf (`onConflict: 'composition_session_id,position'`). `POST /v1/text-workshop/candidates/:id/accept` liest jetzt alle Anhänge einer Sitzung in Positions-Reihenfolge, löst jeden einzeln zu einem Pass-Through-Derivat auf (`ensurePassThroughDerivative`) und übergibt das Array an die RPC.
- **Frontend**: neue Komponente `PhotoAttachmentList.vue` — wrappt die bestehende, unveränderte `PhotoAttachment.vue`-Einheit (Upload + Personen-Prüfung bleiben pro Foto exakt dasselbe, bereits funktionierende Bauteil) mehrfach nebeneinander, mit "+ Weiteres Foto"/"Slot entfernen". `erstellen.vue` nutzt sie über `v-model:media-asset-ids` (Array) statt des vorherigen skalaren `mediaAssetId`.

## PR 1 — Bildkomposition (Sharp, offen)

- Neues Datenmodell "Kompositions-Presets" nach demselben Muster wie `image_style_presets` (Verein/Abteilung/Mannschaft-Ebenen, eigene vs. geerbte Presets, eigene Seite analog zu `apps/web/app/pages/bildstil.vue`).
- Layout-Startsatz, parametrisiert in Vereinsfarbe wie die Bildstil-Rahmenstile: Diagonal-Split (2 Fotos), Raster 2×2 (4 Fotos), gemischtes Raster (1 groß + N klein). Technik: mehrere Foto-Buffer per `resize`/`extract`/`composite` auf eine Zielfläche, diagonale Trennlinien per SVG-Clip-Path — dieselbe Technik wie die Rahmenstile/abgerundeten Ecken in `apps/api/src/imageStyle.ts`.
- Neue Route analog zu `POST /v1/post-media/:id/style-render`: nimmt N Medien-Asset-IDs + ein Kompositions-Preset, liefert ein neues, zusammengesetztes Foto — das danach wie ein gewöhnliches Einzelfoto weiterläuft (an Position 0 angehängt, PR 0 bleibt hierfür unverändert nutzbar mit nur einem Element im Array).
- `erstellen.vue`-Integration: nach dem Mehrfach-Foto-Anhang (PR 0) eine Layout-Galerie im selben Kachel-Muster wie die Rahmenstil-Galerie in `ImageStylePresetForm.vue`.

## PR 2 — Echtes Karussell (Meta-Publishing, offen)

- `MetaPublisher.publish()` (`packages/publishing/src/index.ts`) auf die Graph-API-Karussell-Flow umstellen: je Foto einen Medien-Container erzeugen (`is_carousel_item=true`), danach einen übergeordneten Container, der alle referenziert.
- **Vor PR 2 zu bestätigen**: Plan 021 hat "kein Karussell-Begriff" bei Kontingenten bewusst abgelehnt — Beitragskontingente zählen je `post_versions`, nicht je Foto. Ein Karussell mit N Fotos zählt nach heutiger Regel weiterhin als 1 Beitrag; vermutlich weiterhin richtig, verdient aber eine bewusste Bestätigung statt eines stillschweigenden Fortlaufens der alten Entscheidung.
- `erstellen.vue`: bei mehreren angehängten Fotos eine Wahl zwischen "Komposition" (PR 1) und "Karussell" (PR 2).

## Nicht Teil dieses Pakets

- Remotion-/Video-/Animations-Kompositionen — Plan 005 bleibt der richtige Ort dafür.
- Mehr als 10 Fotos je Beitrag (Contract-Obergrenze bleibt, Meta erlaubt ohnehin nur bis zu 10 Karussell-Slides).
- Karussell-Semantik für Twitter/LinkedIn (andere API-Form, nicht Teil dieses Pakets — nur Meta/Instagram+Facebook).

## Verifikation (PR 0)

- `pnpm --filter @vereinsfunk/api test` (458 Tests) — Route-Tests für mehrere Fotos (Validierung je Foto, Positions-/Rollen-Zuweisung, abgelehnte zweite Fotos), Accept-Route mit mehreren Derivaten.
- `pnpm --filter web typecheck` — `PhotoAttachmentList.vue`/`erstellen.vue`.
- `pnpm exec supabase test db` — `composition_session_post_media.test.sql` (19 Assertions: mehrere Anhänge je Sitzung auf unterschiedlichen Positionen, Uniqueness weiterhin je Position, RPC mit einem und mit zwei Derivaten, Rückwärtskompatibilität des Zweiargument-Aufrufs).
- Noch offen: Browser-Smoke-Test (mehrere Fotos in `erstellen.vue` anhängen, Sitzung annehmen, `post_media` prüfen) — folgt sinnvollerweise zusammen mit PR 1, sobald die Fotos auch sichtbar zu etwas führen.
