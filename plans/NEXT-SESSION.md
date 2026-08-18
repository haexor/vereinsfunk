# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`.

## Ausgangslage: Plan 045 ausgeplant, PR 0 ist der nächste Schritt

`plans/045-bildstil-rahmen-logo-und-filter-fuer-beitragsfotos.md` ist am 2026-08-17 ausgeplant (dieser PR liefert nur die Plandatei + diesen Eintrag, noch keinen Anwendungscode). Auslöser: der Wunsch nach vereinsdefinierten Bildstil-Presets (Rahmen, Vereinslogo als Wasserzeichen in wählbarer Ecke, Fotofilter) für Beitragsbilder.

**Wichtigster Befund der Ausplanung**: die Foto-Pipeline, auf der dieses Feature aufbauen müsste, existiert nicht — sie ist eine Fassade, verifiziert direkt gegen den Code (nicht gegen Plan-Statustexte):

- `LocalUploadService` (`apps/api/src/app.ts:63-66`) ist ein No-op-Stub — `complete()` schreibt nie in die DB, `upload_status` wird nie `'ready'`.
- `ImageAnonymizer` (`packages/media-processing/src/index.ts`) hat keine Implementierung; `ManualOnlyFaceDetector` liefert immer `[]`. Keine Route schreibt je in `face_regions`.
- Kein Code erzeugt je eine `media_derivatives`-Zeile oder verknüpft `post_media` mit einem Beitrag. Die Hatchet-Workflows `render-content`/`anonymize-media` sind nur registrierte Hüllen, der Executor wirft für sie sofort `product_executor_unavailable`.
- **Sicherheitsrelevanter Nebenfund**: `facesConfirmedComplete` ist in `apps/api/src/services/mediaGate.ts:42,130` hartcodiert `true`; `media_assets.scan_status` wird nirgends auf `'clean'` gesetzt. Beides bislang folgenlos, weil die vorgelagerten Tabellen leer bleiben — wird aber mit dem ersten echten Schreiber (PR 0 dieses Pakets) erstmals wirksam und muss dort behoben sein, bevor echte Fotos fließen.

Damit hängt an Plan 045 auch die seit Paket 032 offene Lücke „Foto-/Video-Anhänge bleiben bis Plan 002 gesperrt" — PR 0 baut die erforderliche Foto-Pipeline nach: mit verpflichtendem Malware-Scan, aber weiterhin ohne automatische Gesichtserkennung und Bildverdeckung (das bleibt Plan 003).

## Nächster Schritt

**Plan 045, PR 0** umsetzen (Abschnitt „Umsetzung" im Plan): echter Upload-Service mit verpflichtendem `MalwareScanner`-Provider, `people_reviewed_at`-Prüfsignal + Gate-Verdrahtung in TS **und** SQL, minimale Foto-Markier-UI in `erstellen.vue`, Pass-Through-Derivat, echte `post_media`-Verknüpfung über eine Erweiterung von `accept_text_generation_candidate`. Ergebnis: ein *ungestyltes*, gescanntes Foto ist Ende-zu-Ende veröffentlichbar, bevor PR 1-3 (Bildstil-Presets, Sharp-Compositing, `erstellen.vue`-Integration) darauf aufbauen. Realistisch ein eigener Arbeitsblock — nicht mehr im selben Rutsch wie die Ausplanung.

### Danach

- **PR 1-3 aus Plan 045**: strikt in der Merge-Reihenfolge PR 1 (Bildstil-Datenmodell + `/bildstil`) → PR 2 (Sharp-Compositing) → PR 3 (Preset-Auswahl in `erstellen.vue`); parallele Vorbereitung ist möglich. Details im Plan.
- **Paket 038** ist erledigt: Der Status vom 2026-08-13 in `plans/README.md` bestätigt den stabilen `vereinsfunk-worker` auf haex.space (`RestartCount=0`) und den erfolgreichen Fünf-Minuten-`generation-recovery-scan`. Es ist kein offener Dringlichkeitspunkt.
- **029**, **031** und **043** sind weiterhin als offen/bereit markiert, unabhängig von 045.

Pakete 039, 042 und 044 sind vollständig abgeschlossen und gemergt — falls diese Datei in einer künftigen Session nicht mehr aktuell aussieht, gilt `plans/README.md` als Quelle der Wahrheit, nicht dieser Prompt (siehe [[feedback_plan_status_vor_umsetzung_gegen_code_pruefen]]).
