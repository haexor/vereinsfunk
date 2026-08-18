# Prompt für die nächste Session

Arbeite im Repository-Root dieses Checkouts. Beginne mit `git status --short --branch`, `git fetch origin` und `git log --oneline origin/main..HEAD`.

## Ausgangslage: Plan 045 PR 0 ist fertig

`plans/045-bildstil-rahmen-logo-und-filter-fuer-beitragsfotos.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen" (2026-08-18): die Foto-Pipeline, die bis dahin eine Fassade war (`LocalUploadService`-Stub, kein Code erzeugte je `media_derivatives` oder verknüpfte `post_media`, `facesConfirmedComplete` hartcodiert `true`), ist jetzt real. Vier Commits:

- Echter `SupabaseUploadService` (signierte Upload-URL, byte-sniff, sha256-Verifikation, EXIF-Strip) statt `LocalUploadService`-Stub.
- `people_reviewed_at`-Prüfsignal + `confirm_media_people_review()` + Gate-Verdrahtung in `mediaGate.ts` **und** `schedule_publication()` (neuer eigener Blocker `people_review_pending`, nicht `face_pending` überladen).
- Pass-Through-Derivat (`ensurePassThroughDerivative()`) + echte `post_media`-Verknüpfung über eine Erweiterung von `accept_text_generation_candidate`.
- Minimale Foto-Markier-UI in `erstellen.vue` (neue Komponente `PhotoAttachment.vue`).

**Abweichung vom ursprünglichen Plan**: kein separater `MalwareScanner`-Provider (Betreiberentscheidung — angemeldete Vereinsmitglieder sind kein anonymes Public-Upload, Byte-Sniff + Sharp-Decode gilt als ausreichend). Details und die zwei per echtem Playwright-Lauf gefundenen Grant-/`SECURITY DEFINER`-Lücken stehen im Plandokument.

Verifiziert: pgTAP (32 Dateien, 859 Assertions, nach frischem `supabase db reset`), `pnpm check`, echter Playwright-Lauf gegen die lokale App (Upload → Markieren → „keine Personen erkennbar" → Sitzung mit Foto-Anhang erstellen).

## Nächster Schritt

**Plan 045, PR 1** (Datenmodell + `/bildstil`-Seite für Bildstil-Presets: Rahmen, Logo-Position, Filter, mehrschichtig wie Marke). PR 0 muss dafür in der Zielumgebung gemerged sein — PR 1 setzt auf `image_style_presets` auf, das `brand_assets` erweitert (neuer `kind='frame'`-Wert per `ALTER TYPE`).

### Danach

- **PR 2-3 aus Plan 045**: strikt in der Merge-Reihenfolge PR 2 (Sharp-Compositing) → PR 3 (Preset-Auswahl in `erstellen.vue`); parallele Vorbereitung ist möglich. Details im Plan.
- Die seit Paket 032 offene Lücke „Foto-/Video-Anhänge" ist für Fotos jetzt geschlossen (PR 0). Videos bleiben außerhalb dieses Plans.
- **029**, **031** und **043** sind weiterhin als offen/bereit markiert, unabhängig von 045.

Falls diese Datei in einer künftigen Session nicht mehr aktuell aussieht, gilt `plans/README.md` als Quelle der Wahrheit, nicht dieser Prompt (siehe [[feedback_plan_status_vor_umsetzung_gegen_code_pruefen]]).
