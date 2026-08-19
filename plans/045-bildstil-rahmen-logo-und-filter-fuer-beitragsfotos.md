# 045 – Bildstil: Rahmen, Logo-Wasserzeichen und Filter für Beitragsfotos

> **Executor instructions**: Vier PRs. **PR 0 ist Voraussetzung für PR 1**, **PR 1 für PR 2** und **PR 2 für PR 3**; die zwingende Merge-Reihenfolge lautet damit **PR 0 → PR 1 → PR 2 → PR 3**. Parallele Entwicklung auf getrennten Branches ist möglich, aber PR 2 und PR 3 werden erst nach ihren jeweiligen Vorgängern rebased, integriert und gemergt. Nach jedem Schritt die angegebene Prüfung ausführen. Bei einer STOP-Bedingung anhalten und berichten, nicht improvisieren.
>
> **Drift check (run first)**: `git log --oneline -8 -- apps/api/src/routes/content.ts apps/api/src/services/mediaGate.ts apps/api/src/app.ts supabase/migrations packages/media-processing/src apps/worker/src` — falls sich `LocalUploadService`, `facesConfirmedComplete` oder die `face_pending`/`scan_pending`-Blocker-Logik in `schedule_publication()` seit Planung geändert haben, Abschnitt „Ausgangslage" neu verifizieren, bevor begonnen wird.

## Ergebnis

Ein Verein pflegt beliebig viele **Bildstil-Presets** (Rahmen, Vereinslogo als Wasserzeichen in wählbarer Ecke, Fotofilter) auf einer neuen Seite `/bildstil`, analog zu Marke. Beim Erstellen eines Beitrags kann eine Person ein Foto anhängen, es auf abgebildete Personen prüfen (Consent verlinken oder „keine Personen erkennbar" erklären) und eines der Presets auswählen. Das System rendert serverseitig ein finales, gestyltes Bild, das durch die bestehende Freigabe- und Medien-Gate-Prüfung läuft und veröffentlicht werden kann.

## Ausgangslage und Evidenz

Geplant auf `main` am 2026-08-17, verifiziert direkt gegen den Code (nicht gegen `plans/*.md`-Statustexte, die in diesem Repo nachweislich veralten, siehe [[feedback_plan_status_vor_umsetzung_gegen_code_pruefen]]).

**Die Foto-Pipeline existiert nicht — sie ist eine Fassade, kein „fast fertiges" System:**

- `POST /v1/media/uploads` (`apps/api/src/routes/content.ts:719-744`) reserviert echt eine `media_assets`-Zeile über `reserve_storage_upload()` (`supabase/migrations/2026081303_storage_reservation_and_content_limit_rpc.sql:12-61`, Status `'initiated'`, nur für die Kontingent-Buchhaltung), ruft danach aber `LocalUploadService.create()` (`apps/api/src/app.ts:63-66`) auf, die eine **erfundene** `uploadUrl: https://storage.invalid/upload/...` zurückgibt — kein echtes Storage-Backend.
- `POST /v1/media/:assetId/complete` (`content.ts:745-754`) ruft `LocalUploadService.complete()` auf: `async complete() { return { accepted: true } }` — ein **totaler No-op**. Kein DB-Zugriff, `upload_status` wird nie `'ready'`, `sha256`/Maße werden nie geprüft oder geschrieben.
- `packages/media-processing/src/index.ts`: `ImageAnonymizer` ist ein Interface **ohne jede Implementierung** im Repo. `ManualOnlyFaceDetector.detect()` liefert immer `[]` — bewusst, kein Netzwerk-/Biometrie-Zugriff. Keine Route in `apps/api` schreibt je in `face_regions`; keine UI in `apps/web` existiert dafür.
- **Kein Code erzeugt je eine `media_derivatives`-Zeile.** Die Hatchet-Workflownamen `render-content`/`anonymize-media` sind nur als generische Hüllen registriert (`apps/worker/src/workflows.ts:54-88`, über `client.task(...)`, bestätigt **nicht** `client.workflow()`); der `ProductWorkflowExecutor` (`apps/worker/src/index.ts:66-71`) implementiert ausschließlich `'generate-text-post'` und wirft für jeden anderen Workflownamen sofort `product_executor_unavailable`.
- **Kein Code verknüpft `post_media`** mit einem `post_version` (kein `.insert()` gegen `post_media` im ganzen Repo).
- `composition_session_media` (Plan 032, `supabase/migrations/2026081003_text_workshop_foundation.sql:121-134`) ist ein **anderes** Konzept — Foto als Kontext fürs Textmodell, nie das zu veröffentlichende Bild selbst. FK-korrekt zu `media_assets`, aber nur eine SELECT-RLS-Policy, keine INSERT/UPDATE-Grants an `authenticated`, keine schreibende Anwendungslogik. Reine Vertragshülle.
- `apps/web/app/pages/erstellen.vue:336` ist der einzige medienbezogene Text im ganzen Textwerkstatt-Flow: *„Dieser Pilot erstellt nur Text. Foto- und Videoanhänge sind noch nicht verfügbar und werden nie an das Sprachmodell gesendet."* Kein Datei-Input, kein Upload-Widget existiert.

**Konkreter, bisher nicht dokumentierter Sicherheitsfund** (gefunden bei der Planung dieses Pakets, nicht Teil der ursprünglichen Anfrage, aber direkt relevant für das Medien-Gate, das dieses Paket erstmals real durchläuft):

- `facesConfirmedComplete` ist in `apps/api/src/services/mediaGate.ts:42` und `:130` **hartcodiert auf `true`** — verifiziert per `grep`, kein Tippfehler, betrifft beide Aufrufpfade der Funktion.
- Der SQL-Gate in `schedule_publication()` (`supabase/migrations/2026081302_subscriptions_and_content_quotas.sql:514-522`) prüft ausschließlich „existiert eine `face_regions`-Zeile mit `decision='pending'` für dieses Medium" — bei **null** Zeilen (weil niemand je eine anlegt) ist die EXISTS-Prüfung leer, also kein Blocker. Ein Foto mit einer nicht geprüften/nicht eingewilligten Person ist damit heute strukturell veröffentlichbar, sobald `post_media`/`media_derivatives` überhaupt existieren würden — es blockiert nur zufällig, weil die vorgelagerten Tabellen ebenfalls leer bleiben.
- `media_assets.scan_status` hat Default `'pending'` (`202608030001_content_media_workflows_publishing.sql:27`); **nichts im Repo setzt ihn je auf `'clean'`**. Ohne einen expliziten Schreiber würde jedes Foto für immer am `scan_pending`-Blocker hängen. Byte-Sniff und ein erfolgreiches Sharp-Decode sind ausschließlich strukturelle Validierung, niemals ein Malware-Scan und dürfen deshalb diesen Status nicht setzen.

Beide Funde werden in PR 0 behoben (echte `people_reviewed_at`-Prüfung, separater Struktur-Status und ein verpflichtender Malware-Scan im echten Upload-Pfad) — nicht als Nebenkriegsschauplatz, sondern weil PR 0 der erste Code ist, der diese Tabellen überhaupt mit echten Daten befüllt und die Lücke damit erstmals wirksam würde.

**Was solide ist und wiederverwendet wird:**

- Das Sharp-Verarbeitungsmuster aus `apps/api/src/brandLogo.ts` (Byte-Sniff statt Client-`Content-Type` vertrauen → `sharp(buffer).metadata()` → `.rotate()` bäckt EXIF-Orientierung ein und entfernt den Rest → Metadaten **aus dem Output-Buffer neu lesen** (`.rotate()` kann Breite/Höhe bei Orientierung 5-8 vertauschen) → sha256-Hash für Idempotenz → Service-Role-Storage-Schreiben) und `apps/api/src/brandAssetDerivatives.ts` (SVG-Rasterisierung mit `limitInputPixels`-Schutz gegen Speicher-DoS).
- Die `brand_assets`-Abteilungs-/Team-Scope-Hierarchie: `department_id`/`team_id` beide `null` = vereinsweit, `department_id` gesetzt = Abteilung, beide gesetzt = Mannschaft; durchgesetzt über `isBrandAssetSelectable()` (`packages/domain/src/brand.ts:145-149`) und serverseitig über `authz.brand_asset_is_selectable()` (`supabase/migrations/2026080702_brand_assets_and_fonts.sql:284-305`).
- `brand_asset_kind = 'watermark'` ist bereits definiert und über die Marke-UI hochladbar (`marke.vue:443-452`), aber **nirgends angewendet** — bestätigt tot. Dieses Paket macht ihn erstmals nutzbar.
- Die Marke-Seiten-Architektur (`marke.vue`, `useBrandAssets.ts`, `useBrandOverrides.ts`, `BrandLivePreview.vue`) als direktes UI-Vorbild: Scope-Umschalter (`activeLevel`-Ref, `selectScope()`), `loadAll()`-Parallel-Hydration, Asset-Upload per `FormData`-POST + Reload, signierte URLs via `supabase.storage.from(bucket).createSignedUrl(path, 600)`.
- Die Stilprofil-Auswahl in `erstellen.vue` (Karten-Raster, `selectedProfile`-Ref, aktiver Zustand per CSS-Klasse) als Vorbild für die Preset-Auswahl.
- `media_derivatives.recipe jsonb` + `recipe_version text` sind angelegt, aber komplett ungenutzt — der vorgesehene Ort, um festzuhalten, wie ein Derivat entstanden ist.

## Scope

- Echter Medien-Upload-Service (ersetzt `LocalUploadService`), echte `people_reviewed_at`-Prüfung mit Verdrahtung in TS- **und** SQL-Gate, minimale Foto-Markier-UI, Pass-Through-Derivat, echte `post_media`-Verknüpfung
- Datenmodell und Verwaltungsseite `/bildstil` für Bildstil-Presets (Rahmen parametrisch/eigene Grafik, Logo-Position, Filter), mehrschichtig wie Marke (Verein/Abteilung/Team)
- Sharp-Compositing-Engine: Rahmen, Logo-Wasserzeichen, kuratierte Filter
- Integration in `erstellen.vue`: Foto-Anhang, Preset-Auswahl, Live-Vorschau

**Nicht enthalten:**

- Automatische Gesichtserkennung, Bildverdeckung/Anonymisierung (bleibt vollständig Plan 003 — `ImageAnonymizer` bleibt unimplementiert; `decision='obscure'/'exclude'` bleiben in der neuen UI verborgen, weil nichts sie rendern kann)
- Mehrere Fotos/Karussell pro Beitrag (nur `role='primary'`, `position=0`)
- Separate Logo-Deckkraft-Regelung (nur die im PNG hinterlegte Alphatransparenz)
- Asynchrones Rendering über den `render-content`-Hatchet-Workflow — der Name bleibt für Plan 005s größeres, noch unrealisiertes Remotion-Vorhaben reserviert; dieses Paket dispatcht dorthin nichts, um spätere Namenskollisionen zu vermeiden

## Datenmodell

### PR 0: Personen-Prüfsignal

```sql
alter table public.media_assets
  add column people_reviewed_at timestamptz,
  add column people_reviewed_by uuid references public.profiles(id),
  add column structural_validation_status text not null default 'pending'
    check (structural_validation_status in ('pending', 'valid', 'failed'));

create or replace function public.confirm_media_people_review(
  target_asset_id uuid, faces_present boolean
) returns public.media_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  asset public.media_assets;
  region_count integer;
  pending_count integer;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into asset from public.media_assets where id = target_asset_id for update;
  if not found then raise exception 'not_found'; end if;
  if not authz.has_department_permission(asset.department_id, 'post.edit') then
    raise exception 'insufficient_permission';
  end if;
  select count(*), count(*) filter (where decision = 'pending')
    into region_count, pending_count
    from public.face_regions where media_asset_id = target_asset_id;
  -- "keine Personen" widerspricht real markierten Gesichtern; "Personen vorhanden" verlangt
  -- mindestens eine Zeile UND dass keine davon noch unentschieden ist -- sonst waere dies der
  -- Rubberstamp, den mediaGate.ts:42/130 heute schon ist (facesConfirmedComplete hartcodiert true).
  if not faces_present and region_count > 0 then raise exception 'faces_present_mismatch'; end if;
  if faces_present and (region_count = 0 or pending_count > 0) then raise exception 'faces_incomplete'; end if;
  update public.media_assets set people_reviewed_at = now(), people_reviewed_by = auth.uid()
    where id = target_asset_id returning * into asset;
  return asset;
end; $$;
revoke all on function public.confirm_media_people_review(uuid, boolean) from public;
grant execute on function public.confirm_media_people_review(uuid, boolean) to authenticated;
```

`people_reviewed_at` und `people_reviewed_by` sind keine normalen Browser-editierbaren Metadaten: PR 0 entzieht `authenticated` den pauschalen `UPDATE`-Grant auf `media_assets` und vergibt allenfalls explizite, nicht sensible Spaltenrechte. Die Upload- und Normalisierungslogik schreibt mit Service Role; der Browser kann das Prüfsignal ausschließlich über die obige `SECURITY DEFINER`-Funktion setzen. `auth.uid()` wird dort vor dem Update auf einen nicht-null Aufrufer geprüft und ist die alleinige Quelle für `people_reviewed_by`; ein frei übergebener Akteur existiert nicht.

Ein `SECURITY DEFINER`-Trigger auf `face_regions` setzt für **INSERT, UPDATE und DELETE** beiderseits betroffener Assets `people_reviewed_at` und `people_reviewed_by` auf `NULL`. Ein weiterer `BEFORE UPDATE OF object_path, sha256, mime_type, byte_size, width, height, duration_ms, upload_status`-Trigger auf `media_assets` invalidiert dasselbe Signal, wenn der Medieninhalt erneut geändert wird. Damit kann weder eine nachträglich markierte Person noch ein anderer Dateiinhalt eine frühere Sichtung weiterverwenden. `face_regions_write`-RLS (`202608030001_content_media_workflows_publishing.sql:119`) bleibt für die Markier-UI erhalten; sie bekommt keine Schreibrechte auf das Prüfsignal.

Blocker-Erweiterung: `MediaGateBlockerSchema` (`packages/contracts/src/content.ts:483-487`) bekommt einen **neuen** Wert `people_review_pending` statt den bestehenden `face_pending` zu überladen — beide Ursachen sind für die anzeigende Person unterschiedlich handlungsrelevant (Gesicht markieren vs. Foto überhaupt erst sichten). `schedule_publication()` bekommt eine fünfte EXISTS-Klausel nach dem bestehenden Muster (`2026081302_subscriptions_and_content_quotas.sql:514-522`ff.), die auf `media_assets.people_reviewed_at is null` statt auf `face_regions` prüft. `apps/api/src/services/mediaGate.ts:42,130` liest `people_reviewed_at is not null` statt der Konstante `true`.

### PR 1: Bildstil-Presets

```sql
-- eigene Migration, VOR jeder Referenz auf 'frame' committen (ALTER TYPE ... ADD VALUE
-- kann nicht in derselben Transaktion wie ein Insert mit dem neuen Wert stehen)
alter type public.brand_asset_kind add value 'frame';
```

```sql
create type public.image_style_frame_type as enum ('none', 'parametric', 'custom');
create type public.image_style_filter as enum ('original', 'schwarz_weiss', 'kontrastreich', 'warm', 'vereinsfarben_duoton');
create type public.image_style_logo_position as enum ('bottom_right', 'bottom_left', 'top_right', 'top_left', 'center');

-- Der Zielschluessel der typisierten Fremdschluessel muss explizit eindeutig sein.
alter table public.brand_assets
  add constraint brand_assets_organization_id_id_kind_key unique (organization_id, id, kind);

create table public.image_style_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- gleiche Besitzebene wie brand_assets: beide null = vereinsweit, department_id gesetzt =
  -- Abteilung, beide gesetzt = Mannschaft.
  department_id uuid, team_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  is_active boolean not null default true,

  frame_type public.image_style_frame_type not null default 'none',
  frame_color text check (frame_color ~ '^#[0-9a-fA-F]{6}$' or frame_color in ('primary', 'accent')),
  frame_width_px integer check (frame_width_px > 0 and frame_width_px <= 200),
  frame_corner_radius_px integer check (frame_corner_radius_px >= 0 and frame_corner_radius_px <= 200),
  frame_brand_asset_id uuid,

  logo_enabled boolean not null default false,
  logo_brand_asset_id uuid,
  logo_position public.image_style_logo_position not null default 'bottom_right',
  logo_size_percent integer check (logo_size_percent between 4 and 30),
  logo_margin_percent integer check (logo_margin_percent between 0 and 15),

  filter public.image_style_filter not null default 'original',

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),

  frame_brand_asset_kind public.brand_asset_kind generated always as ('frame'::public.brand_asset_kind) stored,
  logo_brand_asset_kind public.brand_asset_kind generated always as ('watermark'::public.brand_asset_kind) stored,
  unique (organization_id, id),
  check (department_id is not null or team_id is null),
  check (frame_type <> 'parametric' or (frame_color is not null and frame_width_px is not null)),
  check ((frame_type = 'custom') = (frame_brand_asset_id is not null)),
  check (logo_enabled = (logo_brand_asset_id is not null and logo_size_percent is not null and logo_margin_percent is not null)),

  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, frame_brand_asset_id, frame_brand_asset_kind)
    references public.brand_assets(organization_id, id, kind),
  foreign key (organization_id, logo_brand_asset_id, logo_brand_asset_kind)
    references public.brand_assets(organization_id, id, kind)
);
```

Zusammengesetzte Fremdschlüssel statt jsonb-eingebetteter Referenzen — Plan 013 hat genau diesen Fehler im eigenen Datenmodell gefunden und nachgebessert (`plans/013-marke-branding-assets-und-schriften.md`, Abschnitt „Ergänzungen zum Datenmodell beim Bauen"). Die typisierten Fremdschlüssel sind bewusst zusätzlich zur Organisationsbindung: `frame_brand_asset_id` kann nur `kind='frame'`, `logo_brand_asset_id` nur `kind='watermark'` referenzieren; eine UI-Auswahl ist dafür keine Sicherheitsgrenze. RLS: SELECT über `authz.is_organization_member`-Muster wie `brand_assets`, Schreiben über `brand.manage` (dieselbe Berechtigung wie Marke, keine neue). `WITH CHECK` auf `frame_brand_asset_id`/`logo_brand_asset_id` über `authz.brand_asset_is_selectable()` von Anfang an einbauen — Plan 013 musste das für `department_brand_profiles`/`team_brand_profiles` nachträglich per Review-Fix ergänzen (Cross-Department-Leck), hier von Anfang an.

### Recipe-Serialisierung (PR 2)

```json
{
  "kind": "image_style_v1",
  "stylePresetId": "<uuid>",
  "stylePresetSnapshot": { "name": "...", "frameType": "parametric", "...": "..." },
  "sourceMediaAssetId": "<uuid>",
  "sourceSha256": "<sha256 des normalisierten Originals>"
}
```

`recipe_version = 'image-style-v1'`, nur bei echten Pixel-Algorithmus-Änderungen erhöht — nie ein stilles Neu-Rendern eines bereits freigegebenen, `ready`-Derivats (`enforce_immutable_derivative`-Trigger, `202608030001_content_media_workflows_publishing.sql:108-109`, schützt das bereits). Das Preset wird als **Snapshot**, nicht nur als ID gespeichert — ein später bearbeitetes/gelöschtes Preset darf nicht rückwirkend ändern, was ein bereits freigegebener Beitrag zeigt (gleiche Begründung wie `post_generation_provenance.style_profile_snapshot` in Plan 032).

## Umsetzung

### PR 0 – Ein Foto wird echt veröffentlichbar

> **Umsetzung, Stand 2026-08-18: alle vier Schritte fertig, verifiziert (pgTAP 32 Dateien/859 Assertions, `pnpm check`, echter Playwright-Lauf gegen die lokale App), vier Commits auf `worktree-paket-045-pr0-foto-pipeline`.** Zwei Abweichungen von diesem Abschnitt, beide Betreiberentscheidungen bzw. beim Bauen gefundene Fehler, siehe „Umsetzung: Ergebnis und Abweichungen" am Ende dieses Abschnitts.

1. **Echter Upload-Service und Struktur-Grenze.** `SupabaseUploadService` ersetzt `LocalUploadService` (`apps/api/src/app.ts`): signierte Upload-URL zu `raw-media`, `complete()` lädt das Objekt, byte-sniffed MIME (wie `brandLogo.ts:21-30`), verifiziert `sha256` gegen den Client-Wert, liest Maße per `sharp(buffer).metadata()`, schreibt EXIF-bereinigt zurück (`.rotate()` + kein `.withMetadata()`), setzt `structural_validation_status='valid'`, `scan_status='clean'`, `upload_status='ready'` und `exif_stripped_at=now()` **im selben Schritt** — kein separater `MalwareScanner`-Provider (Abweichung, siehe unten).
   - Nebenbefund beheben: die Kommentar-Begründung in `content.ts:747-751` für die fehlende `requirePermission`-Prüfung bei `/complete` ist veraltet — `reserve_storage_upload()` legt die `media_assets`-Zeile längst synchron an. `/complete` soll die Zeile laden und `post.edit` auf ihre `department_id` prüfen.
   - *Prüfung*: Vitest — Datei mit falschem Magic-Byte-Header trotz korrektem `Content-Type` wird abgelehnt; korrekte Datei landet mit `structural_validation_status='valid'` und `scan_status='clean'`; ein Decode-Fehlschlag (korrupte Datei mit richtigen Magic Bytes) setzt beide auf `failed`.
2. **`people_reviewed_at` + `confirm_media_people_review`** (SQL oben) + Blocker-Verdrahtung in `mediaGate.ts` und `schedule_publication()`.
   - *Prüfung*: pgTAP — Foto ohne `people_reviewed_at` blockiert `schedule_publication` trotz null `face_regions`-Zeilen; direkter Browser-Update der Prüffelder wird verweigert; nach `confirm_media_people_review` blockiert das Hinzufügen, Ändern oder Löschen einer `face_regions`-Zeile wieder, bis die Sichtung erneut bestätigt wurde.
3. **Minimale Foto-Markier-UI** in `erstellen.vue`: Box zeichnen (schreibt `face_regions`, `source='manual'`), pro Box Consent verlinken (`GET /v1/consents`) oder neu anlegen (Link zu `/einwilligungen`), oder „keine Personen erkennbar" (ruft `confirm_media_people_review(faces_present=false)`).
   - *Prüfung*: Component-/Playwright-Test — Foto mit markierter, nicht eingewilligter Person bleibt gesperrt; „keine Personen" + leere Markierung gibt frei.
4. **Pass-Through-Derivat + `post_media`-Verknüpfung.** Aus einem `ready`-`media_asset` entsteht eine `media_derivatives`-Zeile (`recipe={"kind":"pass_through_v1"}`, Bytes = normalisiertes Original, Ziel-Bucket `rendered-media`). Die neue Tabelle `composition_session_post_media` enthält `organization_id`, `composition_session_id`, `media_asset_id`, `role` und `position`, mit zusammengesetzten FKs zu Sitzung und Asset. Für den jetzt bewusst einzelnen Anhang erzwingen `check (role = 'primary')`, `check (position = 0)` und eindeutige Session-Indizes höchstens einen Eintrag — sofern ein Anhang existiert, ist er damit genau `primary` auf Position `0`.
   - SELECT sowie INSERT, UPDATE und DELETE erhalten eigene RLS-Policies. Jede Schreib-Policy prüft über die Sitzung Organisations- **und** Abteilungsbindung, `post.edit` und dass das Asset derselben Organisation und Abteilung wie die Sitzung angehört; zusammengesetzte FKs verhindern zusätzlich Cross-Tenant-Referenzen. Die nötigen `authenticated`-Grants werden gezielt nur für diese Tabelle vergeben.
   - `accept_text_generation_candidate` sperrt weiterhin den Kandidaten, erzeugt `post_media` aus dieser Session-Anlage in **derselben** Transaktion und verwendet `ON CONFLICT (post_version_id, position) DO NOTHING`. Sein vorhandener `accepted`-Kurzschluss gibt dieselbe Version zurück; Retries erzeugen daher weder eine zweite Version noch eine zweite `post_media`-Zeile.
   - *Prüfung*: pgTAP — Cross-Tenant- und Cross-Department-Attachments werden durch RLS/FKs abgewiesen; zwei Accept-Aufrufe haben genau eine `post_media`-Zeile. Der End-to-End-Test Upload → Scan → Personen-Prüfung → Session → Accept → `post_media` → `schedule_publication` ist erfolgreich (vorher 409 `media_gate_blocked`).

### PR 1 – Datenmodell + `/bildstil`

> **Umsetzung, Stand 2026-08-19: alle drei Schritte fertig, verifiziert (pgTAP 34 Dateien/892 Assertions, `pnpm check`, echter Playwright-Lauf gegen die lokale App).** Drei Abweichungen/Ergänzungen gegenüber diesem Abschnitt, siehe „Umsetzung: Ergebnis und Abweichungen (PR 1, 2026-08-19)" am Ende dieses Abschnitts.

1. Migration wie oben (zwei Schritte: `ALTER TYPE` zuerst, `image_style_presets` danach). Im selben PR `BrandAssetKindSchema`, `BrandAssetSchema` und `CreateBrandAssetRequestSchema` um `frame` ergänzen; `POST /v1/brand/assets` verarbeitet ihn wie `watermark`. Contract- und Route-Tests decken beide positiven Fälle `frame` und `watermark` ab.
2. CRUD-Routen `apps/api/src/routes/imageStyle.ts` (neue Datei, Modulgrenze wie Plan 027): `GET/POST/PATCH/DELETE /v1/image-style-presets`, Rahmen-/Logo-Asset-Upload über die bestehende `POST /v1/brand/assets`-Route (kind `frame`/`watermark`, keine neue Upload-Route nötig).
3. Neue Seite `apps/web/app/pages/bildstil.vue`, 1:1-Architekturübernahme von `marke.vue` (Scope-Umschalter, `loadAll()`, Formular, Live-Vorschau-Komponente `ImageStyleLivePreview.vue` analog `BrandLivePreview.vue`). Nav-Eintrag in `layouts/default.vue`s `organizationNav`-Array direkt nach „Marke".
   - *Prüfung*: Vitest für die Routen, Component-Test für Scope-Vererbung (Abteilung erbt Vereins-Preset, bis sie eigenes anlegt).

### PR 2 – Sharp-Compositing

1. `apps/api/src/imageStyle.ts` (Geschwister von `brandLogo.ts`): parametrischer Rahmen (`sharp().extend()` mit Rahmenfarbe/-breite, optional abgerundete Ecken per SVG-Maske), eigene Rahmengrafik (`sharp().composite()`), Logo-Platzierung (`gravity` aus `logo_position`, Größe relativ zur Bildbreite), Filter-Pipeline:

   | Schlüssel | Effekt | sharp |
   |---|---|---|
   | `original` | unverändert | – |
   | `schwarz_weiss` | Graustufen | `.greyscale()` |
   | `kontrastreich` | Kontrast/Sättigung erhöht | `.linear()` + `.modulate({ saturation: 1.15 })` |
   | `warm` | wärmere Farbstimmung | kanalgewichtetes `.tint()` Richtung Amber |
   | `vereinsfarben_duoton` | Duoton aus den eigenen Vereinsfarben | Graustufen → Neueinfärbung zwischen `organization_brand_profiles.primary_color`/`accent_color` |

2. `POST /v1/post-media/:postMediaId/style-render` (Body: `stylePresetId`) nimmt die konkrete Attachment-Identität an, nicht nur ein global wiederverwendbares `media_asset`. Der Handler autorisiert über die zugehörige Beitragsversion, sperrt genau diese `post_media`-Zeile und erzeugt in derselben Transaktion ein **neues**, sofort unveränderliches gestyltes Derivat mit Rezept-Snapshot. Er aktualisiert ausschließlich diese noch bearbeitbare Attachment-Zeile auf die neue Derivat-ID; weder das Original noch ein Pass-Through- oder Styling-Derivat eines anderen Beitrags wird ersetzt oder gelöscht. Ist die Version bereits zur Freigabe eingereicht, wird der Aufruf abgewiesen, statt eine freigegebene Version zu verändern.
   - *Prüfung*: Pixelprobe-Tests je Filter/Rahmen/Logo-Kombination (feste Fixture-Bilder, Hash- oder Stichproben-Farbwert-Vergleich); Snapshot-Test für `recipe`-Inhalt. Ein Integrationstest hängt dasselbe Original an zwei Beiträge, rendert mit zwei verschiedenen Presets und beweist getrennte Derivate sowie unveränderte jeweils andere `post_media`-Zeile.

### PR 3 – `erstellen.vue`-Integration

1. Foto-Anhang-Steuerung (Upload + Markier-Widget aus PR 0) + Preset-Auswahl (Karten-Raster wie der bestehende Stilprofil-Picker, `erstellen.vue:339`) + Live-Vorschau über `supabase.storage.from('rendered-media').createSignedUrl(objectPath, 600)` (gleicher Aufruf wie `marke.vue:125-126`).
   - *Prüfung*: Playwright — Foto anhängen, Preset wählen, Vorschau zeigt gestyltes Bild, Entwurf annehmen, Freigabe zeigt das Bild.

## Verifikation

```bash
pnpm --filter @vereinsfunk/api test
pnpm --filter @vereinsfunk/web test
pnpm --filter @vereinsfunk/domain test
pnpm check
```

Je PR zusätzlich pgTAP-Tests für RLS/Gate-Verhalten (`supabase/tests/`, Muster wie bei bestehenden Paketen). End-to-End-Abnahme für PR 0 wie oben beschrieben; für PR 1-3 ein durchgängiger manueller/Playwright-Lauf: Foto hochladen → Personen erklären → Preset wählen → Entwurf annehmen → Freigeben → Veröffentlichen-Route liefert keinen `media_gate_blocked` mehr.

## Done-Kriterien

- Ein Foto ohne Styling ist Ende-zu-Ende veröffentlichbar (PR 0 allein beweisbar).
- `facesConfirmedComplete`/`scan_status`-Lücke ist geschlossen — ein Foto mit ungeprüfter Person oder ohne erfolgreichen Malware-Scan blockiert nachweislich (Regressionstests vorhanden); strukturelle Validierung allein kann nie `clean` setzen.
- Ein Verein kann mindestens zwei Bildstil-Presets anlegen (Rahmen parametrisch + eigene Grafik, Logo, Filter) und beim Beitragserstellen zwischen ihnen wählen.
- Gerendertes Bild entspricht dem gewählten Preset (Pixelprobe grün) und ist in der Vorschau identisch mit dem später veröffentlichten Bild (keine Web/Render-Divergenz).
- `brand_asset_kind='watermark'` ist erstmals tatsächlich angewendet, nicht mehr toter Code.

## STOP-Bedingungen

- Gesichtsverdeckung/Anonymisierung wird für dieses Paket gebraucht, nicht nur „keine Person"/„Consent vorhanden": Plan 003 zuerst umsetzen, hier nicht improvisieren.
- `render-content` soll doch synchron/asynchron über Hatchet laufen, bevor Plan 005 seinen eigenen Bedarf dafür klärt: anhalten, Namenskollision mit dem Kreativsystem zuerst auflösen.

## Umsetzung: Ergebnis und Abweichungen (PR 0, 2026-08-18)

Alle vier Schritte umgesetzt und verifiziert. Zwei Abweichungen von diesem Plandokument:

1. **Kein separater `MalwareScanner`-Provider.** Betreiberentscheidung: angemeldete, namentlich bekannte Vereinsmitglieder sind kein anonymes Public-Upload. Byte-Sniff gegen den Client-`Content-Type` plus ein erfolgreiches Sharp-Decode (dieselbe Prüfung wie `brandLogo.ts`) gilt als ausreichende Grundlage — `structural_validation_status='valid'` und `scan_status='clean'` werden vom selben Codepfad in derselben Schreiboperation gesetzt (siehe Migration `2026081801_media_upload_pipeline.sql`). Die ursprüngliche STOP-Bedingung dazu ist damit gegenstandslos und wurde entfernt.
2. **Bestandsmedien bleiben bewusst fail-closed.** Die neue Spalte `people_reviewed_at` wird nicht rückwirkend gefüllt: Vor dieser Pipeline gab es keinen nachweisbaren Personenprüfschritt, deshalb wäre ein Backfill eine unbelegte Freigabe. Bestehende veröffentlichungsrelevante Medien müssen vor einer weiteren Einplanung einmal von einer Person mit `post.edit` prüfen und bestätigen werden. Das ist eine fachliche Breaking Change; beim Rollout ist sie an Vereinsadmins zu kommunizieren und die offene Medienliste gezielt nachzuziehen.
3. **Zwei echte Fehler per echtem Playwright-Lauf gegen die lokale App gefunden**, die die eigene pgTAP-Suite nicht gefangen hatte, weil die betroffenen Schreibzugriffe dort ausschließlich unter der Rolle `postgres` liefen, nie unter `authenticated`:
   - `invalidate_people_review_on_face_change()` (Migration `2026081802`) fehlte `SECURITY DEFINER` — jedes echte Markieren einer Gesichtsregion scheiterte an „permission denied for table media_assets". Fix in eigener Folgemigration `2026081805` (die bereits committete `2026081802` bleibt unverändert, keine nachträgliche Änderung an einer bereits committeten Migration).
   - `face_regions` hatte seit der ursprünglichen Migration (`202608030001`, vor diesem Paket) nie einen `DELETE`-Grant für `authenticated`. Fix in Migration `2026081804`.

Beide Funde bestätigen: pgTAP-Fixtures, die Schreibzugriffe der Einfachheit halber unter `postgres` statt der tatsächlich aufrufenden Rolle anlegen, verdecken echte Grant-/`SECURITY DEFINER`-Lücken. `supabase/tests/media_people_review.test.sql` wurde entsprechend nachgeschärft.

## Umsetzung: Ergebnis und Abweichungen (PR 1, 2026-08-19)

Datenmodell, CRUD-Routen und `/bildstil`-Seite vollständig umgesetzt und verifiziert (pgTAP 34 Dateien/892 Assertions nach frischem `supabase db reset`, `pnpm check`, echter Playwright-Lauf gegen die lokale App: Preset anlegen/bearbeiten/löschen auf Vereins- und Abteilungsebene, Vererbung geprüft, keine Konsolenfehler). Drei Abweichungen bzw. Ergänzungen gegenüber diesem Plandokument:

1. **PATCH ersetzt den gesamten Bildstil-Anteil, statt einzelne Felder partiell zu patchen.** Die CHECK-Constraints der Migration verknüpfen mehrere Spalten (`frame_type`↔`frame_color`/`frame_width_px`, `logo_enabled`↔die drei Logo-Felder) — ein echtes Feld-für-Feld-PATCH könnte eine Kombination erzeugen, die die API-seitige Prüfung nie sieht, aber an der DB-Constraint scheitert. `UpdateImageStylePresetRequestSchema` verlangt deshalb dieselben Pflichtfelder wie beim Anlegen (nur `isActive` bleibt echt optional) — passend zum Formular auf `/bildstil`, das ohnehin immer den ganzen Preset-Zustand hält.
2. **Rahmengrafik-/Wasserzeichen-Upload sitzt auf `/bildstil` selbst, nicht auf `marke.vue`.** Der Plan verlangte nur, dass die bestehende `POST /v1/brand/assets`-Route `kind='frame'` verarbeitet — wo der Upload-Trigger in der UI sitzt, blieb offen. `marke.vue`s „Weitere Logovarianten" kennt nur `logo_mark`/`wordmark`/`watermark`; ohne einen eigenen Upload-Einstieg auf `/bildstil` wäre `frameType='custom'` nie nutzbar gewesen (kein Asset zum Wählen). Ergänzt als eigener Abschnitt „Bausteine für diese Ebene" mit Upload für `frame` und `watermark`, dieselbe Route, dieselbe Verarbeitung.
3. **RLS-Bug per pgTAP-Regressionstest schon beim Bauen gefangen, nicht erst per Playwright danach** (siehe [[feedback_pgtap_fixtures_als_postgres_verdecken_grant_luecken]]): eine fehlende Klammerung in `image_style_presets_update`s `WITH CHECK` hätte `A or B or (C and D and E)` statt `(A or B or C) and D and E` ausgewertet — die Waehlbarkeits-Prüfung (`authz.brand_asset_is_selectable`) wäre dadurch nur auf dem Organisations-Zweig durchgesetzt worden, nicht auf Abteilungs-/Mannschaftsebene. Ein gezielter pgTAP-Fall (Abteilungsadmin versucht, den Rahmen auf ein Asset einer Schwesterabteilung umzustellen) deckte das noch vor dem ersten Commit auf; der Test bleibt als Regressionsschutz in `supabase/tests/image_style_presets.test.sql` erhalten.

### Eigener Review vor dem Merge (2026-08-19)

CodeRabbit war rate-limited (siehe [[feedback_coderabbit_rate_limited_selbst_review]]), deshalb eigener mehrperspektivischer Review vor dem Merge. Vier bestätigte Funde behoben:

1. **Asset-Re-Upload zerstörte bestehende Presets.** `POST /v1/brand/assets` löste beim Hochladen bislang jedes vorherige `'ready'`-Asset derselben Kind/Ebene ab (`status='replaced'`) — richtig für Icon/Wortmarke (ein Platz pro Ebene), falsch für `frame`/`watermark`: `image_style_presets` zeigt per fester ID auf ein bestimmtes Asset, und ein Verein soll mehrere Rahmen-/Wasserzeichen-Varianten parallel pflegen können. Jeder weitere Upload hätte jedes bestehende Preset, das noch auf das abgelöste Asset zeigt, beim nächsten Speichern mit `invalid_asset_reference` scheitern lassen, ohne Ausweg in der UI. Fix: Supersede läuft nur noch für `logo_mark`/`wordmark` (`apps/api/src/routes/brand.ts`, `SINGLETON_PER_SCOPE_ASSET_KINDS`).
2. **`frame`-Assets leckten in `marke.vue`s Logo-Auswahl.** `useBrandAssets.ts`s `selectableLogoAssets`/`ownLogoAssets` schlossen nur `font` (bzw. zusätzlich `logo_primary`/`logo_dark`) aus, nicht den neuen Kind-Wert `frame` — eine hochgeladene Rahmengrafik erschien auf `/marke` in der Logo-Auswahl und ließ sich dort "als Logo" setzen, scheiterte aber serverseitig (`LOGO_ASSET_KINDS` schließt `frame` dort korrekt aus). Fix: `frame` in beiden Filtern explizit ausgeschlossen.
3. **Leere Zahlenfelder umgingen die Validierung.** `v-model.number` auf `frameWidthPx`/`logoSizePercent`/`logoMarginPercent` lieferte bei leerem Feld einen leeren String statt `null` (Vue-`looseToNumber`-Fallback) — `isValid`s `=== null`-Prüfung erkannte das nicht, der Speichern-Knopf blieb aktiv, die Zod-Validierung scheiterte erst serverseitig mit einer generischen Fehlermeldung. Fix: gleiches manuelle `@input`-Handling wie bei `frameCornerRadiusPx` (leerer String → `null`).
4. **Veraltete Asset-Referenz beim Ebenenwechsel.** Ein Wechsel der aktiven Ebene im Anlage-Formular aktualisierte die wählbaren Assets, ließ aber eine bereits gewählte `frameBrandAssetId`/`logoBrandAssetId` der alten Ebene im Entwurf stehen — fiel erst beim Speichern als `invalid_asset_reference` auf. Fix: `selectScope()` setzt Anlage-Entwurf und eine offene Bearbeitung zurück.

Ein fünfter, zunächst gemeldeter Verdacht (falscher Abteilungs-/Mannschaftsname für Organisations-Admins ohne eigene Abteilungsmitgliedschaft in `scopeLabel()`) wurde geprüft und verworfen: `authz.is_department_member()` behandelt jedes Organisationsmitglied bereits als Mitglied jeder Abteilung der Organisation (`202608020001_initial_tenant_foundation.sql:296-300`), `membership_scopes()` liefert die Abteilung deshalb mit echtem Namen, nur mit leerem `roles`-Array.

Kein Fund betraf SQL/RLS; keine neue Migration nötig. Nicht mit eigenem Regressionstest abgesichert (kein bestehendes Test-Setup für `POST /v1/brand/assets`-Happy-Path mit echter Bildverarbeitung bzw. für Vue-Komponenten in diesem Repo) — abgedeckt durch `pnpm check` und manuelle Diff-Prüfung.

## Pflegehinweis

`recipe_version`-Disziplin: nie ein bereits `ready`-Derivat still neu rendern, immer eine neue Zeile mit neuer Version. Filter-Set klein halten (5 zum Start) und nur bei wiederholtem Vereinsbedarf erweitern, gleiche Begründung wie bei Marke-Schriftpaaren. Bei jeder Änderung an `mediaGate.ts`/`schedule_publication()`-Blockern beide Stellen synchron halten — sie sind zwei unabhängige Implementierungen derselben Regeln (TS informativ, SQL durchsetzend).
