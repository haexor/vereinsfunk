# 013 – Marke, Branding-Assets und Schriften

## Ergebnis

Ein Verein pflegt sein Erscheinungsbild vollständig selbst: Logo in mehreren Varianten, Farbrollen mit geprüftem Kontrast, ein Schriftpaar aus kuratierter Auswahl **oder** eigene lizenzierte Schriftdateien in WOFF2, WOFF, TTF oder OTF. Abteilungen und Mannschaften dürfen innerhalb eines vom Verein gesetzten Rahmens eigenes Branding führen — eigene Logos, eigene Schriften — und was sie hochladen, ist für andere Abteilungen und Mannschaften nicht nutzbar. Dieselben Werte gelten in der Web-Vorschau und im Remotion-Rendering — kein Beitrag sieht in der Vorschau anders aus als im Ergebnis.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04. **Am 2026-08-07 gegen `main` nach Merge von 011 und 012 (`d7fa8db6`) neu verifiziert; Abweichungen unten als „Update 2026-08-07“ markiert.**

- `supabase/migrations/202608020001_initial_tenant_foundation.sql:120-130`: `organization_brand_profiles` kennt `logo_path`, `primary_color`, `accent_color`, `tone` und ein schemaloses `settings jsonb`. Paket 009 hat bereits `logo_dark_path`, `display_font_key`, `body_font_key` ergänzt (`supabase/migrations/2026080501_organization_profile_and_onboarding.sql:61-64`) — bestätigt, keine weitere Abteilungsebene.
- Die Tabelle hat SELECT- und UPDATE-Policies (`:405-408`), aber **keine INSERT-Policy**. Ein Markenprofil entsteht nur über die Service Role — Paket 009 legt es bei der Vereinserstellung mit an (`2026080501_organization_profile_and_onboarding.sql:165`).
- `supabase/migrations/202608020002_private_storage.sql`: Bucket `brand-assets` ist privat, 20 MB Limit, erlaubt `image/svg+xml`, `image/png`, `image/jpeg` und **`font/woff2`** (Zeile 5). Es gibt nur `storage_read_own_organization` (Zeilen 8-13); `storage_upload_department` gilt ausschließlich für `raw-media` (Zeilen 15-22). `raw-media` erlaubt aktuell `image/jpeg, image/png, image/webp, video/mp4` (Zeile 3) — noch **ohne** Font-Formate, das ist weiterhin ein offener Schritt dieses Pakets. Uploads müssen über die API laufen — das ist die richtige Grenze, weil Fonts und SVG serverseitig geprüft werden müssen.
- **Update 2026-08-07**: `apps/web/nuxt.config.ts` lädt Manrope und DM Sans weiterhin fest von `fonts.googleapis.com`/`fonts.gstatic.com` — Zeilen haben sich auf `:17-24` verschoben (ein `theme-color`-Meta-Tag kam dazwischen), inhaltlich unverändert. Zwei Konsequenzen: das Erscheinungsbild ist nicht vereinsspezifisch, und jeder Seitenaufruf kontaktiert Google — datenschutzrechtlich in Deutschland heikel und in Paket 020 ohnehin zu beheben.
- **Update 2026-08-07 — Tailwind wurde inzwischen auf v4 umgestellt** (`cc22efa8`, `52343c10`, außerhalb dieser Planserie). `apps/web/tailwind.config.ts` **existiert nicht mehr**. Die Farben `ink`, `forest`, `lime`, `oat`, `coral` sowie `font-sans`/`font-display` stehen jetzt als `@theme`-Block in `apps/web/app/assets/css/main.css:9-18`. Der Kernbefund bleibt: feste Hexwerte statt Vereinsfarben, quer durchs Frontend verwendet (u. a. `bg-lime` in `layouts/default.vue:69`, `bg-forest` in `pages/index.vue:112,157` — nicht mehr an den ursprünglich zitierten Zeilen). **Zusätzlicher Fund, über den ursprünglichen Plan hinausgehend**: rund 275 feste Hex-Literale als Tailwind-Arbitrary-Values (`text-[#…]`, `bg-[#…]`) in ca. 20 weiteren Dateien (u. a. `struktur.vue`, `mitglieder.vue`, `kanaele.vue`, `einstellungen.vue`). Diese liegen außerhalb des Umfangs dieses Pakets — der Alias-Ansatz auf CSS-Variablen deckt nur die benannten Tailwind-Tokens ab, nicht beliebige Arbitrary-Hexwerte in Fließtext/Rahmen anderer Seiten. Das wird hier bewusst nicht mit angefasst (chirurgische Änderung), aber als bekannte Lücke im Risiken-Abschnitt vermerkt.
- **Update 2026-08-07 — `apps/web/app/pages/marke.vue` ist nicht mehr der Ausgangszustand des ursprünglichen Plans.** Paket 009 hat die Seite bereits umgebaut: `loadBrand()` lädt `organization_brand_profiles` inkl. signierter Logo-URL, `save()` ruft echtes `PUT /v1/organizations/:id/brand` und bei Logoänderung `POST /v1/organizations/:id/brand/logo` auf, mit echtem `loading`/`saving`/Fehlerzustand. Kein „SN“-Platzhalter mehr (jetzt generisches `?`-Icon ohne Logo). Konsequenz für dieses Paket: **die Seite wird erweitert, nicht neu geschrieben** — Scope-Umschalter, Asset-Verwaltung, Schrift-Upload und Live-Vorschau kommen zum bestehenden Lade-/Speicherzustand hinzu, der bestehende Endpunkt `PUT /v1/organizations/:id/brand` wird um `backgroundColor`, `textColor`, `onPrimaryColor`, `displayFontAssetId`, `bodyFontAssetId` erweitert statt neu gebaut.
- `apps/web/app/components/AppLogo.vue` rendert weiterhin ein statisches, hartkodiertes Inline-SVG-Icon mit dem Schriftzug „vereinsfunk“ — bestätigt, unverändert, noch nicht an `organization_brand_profiles` angebunden.
- **Update 2026-08-07 — geklärt**: `apps/remotion/src/ClubPost.tsx` nimmt aktuell nur `primaryColor`/`accentColor` als Marken-Props entgegen (`ClubPostPropsSchema`), **keine** Font- oder Logo-Props; die Schrift ist hartkodiert `Arial, sans-serif` (`ClubPost.tsx:28`). Damit ist die im ursprünglichen Plan offene Frage beantwortet: Fonts und Logo müssen in diesem Paket neu als Remotion-Props eingeführt werden, nicht nur „angebunden“.

### Design-Entscheidung: Verhältnis von `organization_brand_profiles.logo_path`/`logo_dark_path` zu `brand_assets`

Beim Abgleich mit dem bereits gebauten Logo-Upload aus 009 (`POST /v1/organizations/:id/brand/logo`, schreibt direkt `logo_path`/`logo_dark_path`) fiel eine Lücke im ursprünglichen Datenmodell auf: `brand_asset_kind` sieht `logo_primary`/`logo_light`/`logo_dark`/`logo_mark`/`wordmark`/`watermark` vor, aber die ALTER-TABLE-Liste für `organization_brand_profiles` fügt keine Logo-Referenz auf `brand_assets` hinzu — nur Abteilung und Mannschaft bekommen `logo_asset_id`.

Entscheidung: **Der bestehende Vereins-Logo-Upload (`logo_path`/`logo_dark_path`) bleibt der einzige Weg für die zwei Kernvarianten Primär- und Dunkellogo** und wird auf `brand_assets` umgestellt, statt eine Parallelstruktur zu schaffen — `POST /v1/organizations/:id/brand/logo` legt künftig eine `brand_assets`-Zeile (`kind = 'logo_primary'` bzw. `'logo_dark'`, `department_id`/`team_id = null`) an und `organization_brand_profiles.logo_path`/`logo_dark_path` werden zu abgeleiteten, denormalisierten Zeigern auf den jeweils aktuellen `ready`-Asset-Pfad (aktualisiert beim Asset-Wechsel, analog zum „nie ersetzen, nur ablösen“-Prinzip). Die drei zusätzlichen Vereins-Logovarianten (`logo_mark`, `wordmark`, `watermark`) existieren ausschließlich als `brand_assets`-Zeilen ohne eigene Profilspalte — sie werden kontextuell abgerufen (z. B. Wasserzeichen automatisch, Mark für quadratische Formate), nicht manuell als „aktiv“ markiert. Das hält die Web- und Remotion-Anbindung, die heute schon `logo_path`/`logo_dark_path` liest, unverändert funktionsfähig und vermeidet zwei Quellen der Wahrheit für dieselben zwei Varianten.

## Scope

- Migration: Markenprofil erweitern, Abteilungs- **und** Mannschaftsbranding, Schrift-Registry und eigene Schriften, Asset-Tabelle mit Besitzebene und Abschottung
- `raw-media` um die Schriftformate erweitern, damit Originale dort liegen können
- kuratierte Font-Registry in `packages/domain`
- API: Asset-Upload mit Validierung, SVG-Sanitisierung, Font-Prüfung, Lizenzbestätigung
- Farbrollen und Kontrastprüfung
- Anbindung an Web-Darstellung und Remotion
- Nuxt: echte Markenseite mit Live-Vorschau, Abteilungs- und Mannschafts-Overrides
- Ablösung der fest eingebundenen Google Fonts

Nicht enthalten: Vorlagengestaltung und Layoutfamilien (Paket 005), Rechtstexte (020).

## Datenmodell

Migration `2026080406_brand_assets_and_fonts.sql`:

```sql
create type public.brand_asset_kind as enum (
  'logo_primary','logo_light','logo_dark','logo_mark','wordmark','watermark','font'
);

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Besitzebene: beide null = vereinsweit, department_id gesetzt = Abteilung,
  -- beide gesetzt = Mannschaft. Ein Asset ist nur auf seiner Ebene und darunter
  -- waehlbar -- die Abteilung Handball benutzt kein Fussball-Logo.
  department_id uuid, team_id uuid,
  kind public.brand_asset_kind not null,
  bucket_id text not null default 'brand-assets' check (bucket_id = 'brand-assets'),
  object_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  width integer check (width > 0), height integer check (height > 0),
  -- Nur für kind = 'font'
  font_family text, font_weight integer check (font_weight between 100 and 900),
  font_style text check (font_style in ('normal','italic')),
  license_holder text, license_note text, license_confirmed_at timestamptz,
  license_confirmed_by uuid references public.profiles(id),
  status text not null default 'processing'
    check (status in ('processing','ready','rejected','replaced')),
  rejection_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (bucket_id, object_path),
  check (department_id is not null or team_id is null),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  -- Die Lizenzpflicht haengt am Status, nicht am Insert: eine Schriftdatei muss
  -- sich hochladen und pruefen lassen, bevor der Verein die Lizenz bestaetigt.
  check (kind <> 'font' or status <> 'ready'
         or (font_family is not null and license_holder is not null
             and license_confirmed_at is not null and license_confirmed_by is not null))
);
```

Der letzte CHECK ist der wichtige: **eine Schriftdatei ohne bestätigte Lizenz kann nicht `ready` werden.** Sie kann sehr wohl in `processing` liegen — sonst gäbe es keinen Zustand, in dem Datei und Lizenzformular nebeneinander existieren, und der Upload würde vor der Bestätigung scheitern. Erst der Übergang nach `ready` verlangt `font_family`, `license_holder`, `license_confirmed_at` und `license_confirmed_by`. Die Bestätigung ist keine Rechtsprüfung durch uns, sondern eine dokumentierte Erklärung des Vereins mit Person und Zeitstempel — nachweisbar im Audit.

Markenprofil erweitern (Paket 009 hat bereits `logo_dark_path`, `display_font_key`, `body_font_key` ergänzt):

```sql
alter table public.organization_brand_profiles
  add column background_color text not null default '#f6f4ec' check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  add column text_color text not null default '#122820' check (text_color ~ '^#[0-9a-fA-F]{6}$'),
  add column on_primary_color text not null default '#ffffff' check (on_primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column display_font_asset_id uuid,
  add column body_font_asset_id uuid,
  add column allow_department_overrides boolean not null default true,
  add column locked_fields text[] not null default '{}';

create table public.department_brand_profiles (
  organization_id uuid not null, department_id uuid not null,
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_asset_id uuid, tone text,
  display_font_asset_id uuid, body_font_asset_id uuid,
  allow_team_overrides boolean not null default true,
  locked_fields text[] not null default '{}',
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, department_id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade
);

-- Dritte Ebene, gleiche Felder, gleiche Vererbungsrichtung.
create table public.team_brand_profiles (
  organization_id uuid not null, department_id uuid not null, team_id uuid not null,
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_asset_id uuid, tone text,
  display_font_asset_id uuid, body_font_asset_id uuid,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, department_id, team_id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);
```

**Eigenes Branding auf jeder Ebene, aber keine Quervermischung.** Eine Abteilung und eine Mannschaft dürfen eigene Logos und eigene Schriften haben und hochladen. Was sie hochladen, gehört ihnen: ein Asset mit `department_id` der Abteilung Fußball ist für Handball nicht wählbar, ein Team-Asset nicht für die Schwesternmannschaft. Diese Abschottung ist die Anforderung — sie steht nicht automatisch aus der Mandantentrennung, weil alle Zeilen dieselbe `organization_id` tragen. Sie braucht deshalb eine eigene Policy und einen eigenen negativen Test.

Wählbar für einen Beitrag im Scope S sind genau die Assets auf S **oder einer übergeordneten Ebene** — das Vereinslogo darf jede Mannschaft benutzen, das Mannschaftslogo nur sie selbst. `resolveBrand` und die Asset-Auswahl in der Oberfläche benutzen dieselbe Funktion dafür, damit die Liste im Formular und die Prüfung im Endpunkt nicht auseinanderlaufen können.

`display_font_key` bleibt für die kuratierte Auswahl, `display_font_asset_id` für eine eigene Schrift. Genau eines von beiden ist wirksam; ist ein Asset gesetzt, gewinnt es. Ein CHECK ist hier nicht sinnvoll, weil der Schlüssel immer einen Default trägt und als Rückfallebene taugt, wenn ein Asset abgelehnt wird.

`locked_fields` erlaubt dem Verein, einzelne Felder für Abteilungen zu sperren — feiner als das globale `allow_department_overrides`. Werte sind Feldnamen aus `department_brand_profiles`.

Beide neuen Tabellen sind mandantenbezogen und gehören deshalb ausdrücklich in den RLS-Block derselben Migration — die private Storage-Policy schützt nur Objekte, nicht die Metadatenzeilen:

```sql
alter table public.brand_assets enable row level security;
alter table public.brand_assets force row level security;
alter table public.department_brand_profiles enable row level security;
alter table public.department_brand_profiles force row level security;
-- select: authz.is_organization_member(organization_id)
-- insert/update: brand.manage im Scope; Abteilungszeilen zusaetzlich
--   authz.has_department_permission(department_id, 'brand.manage')
-- Schreiben auf brand_assets laeuft ausschliesslich ueber die API mit Service
-- Role, weil Pruefung, Sanitisierung und Rasterderivat serverseitig entstehen.
```

**Vererbung** folgt derselben Richtung wie Paket 011, jetzt über drei Ebenen: die Abteilung darf abweichen, wenn der Verein es zulässt, die Mannschaft, wenn die Abteilung es zulässt. `resolveBrand(organizationProfile, departmentProfile?, teamProfile?)` in `packages/domain` ist die einzige Auflösungsfunktion und respektiert `allow_department_overrides`, `allow_team_overrides` und `locked_fields` auf beiden Ebenen.

Anders als bei den Richtlinien in Paket 011 ist Branding keine Verschärfung, sondern eine Ersetzung — eine Abteilungsfarbe ist nicht „strenger“ als die Vereinsfarbe. Die Erlaubnis vererbt sich trotzdem nur nach unten: was der Verein sperrt, kann die Abteilung nicht für ihre Mannschaften öffnen.

### Ergänzungen zum Datenmodell beim Bauen

Vier Lücken zwischen Plan-Entwurf und AGENTS.md-Pflichten, beim Schreiben der Migration gefunden und ergänzt statt still übernommen:

- **`brand_assets.raster_derivative_paths jsonb`**: Der Entwurf verlangt in Abschnitt „Umsetzung“ ein rasterisiertes Derivat für jede SVG-Asset, hat dafür aber keine Spalte vorgesehen. Ergänzt, leer für alles außer SVG-Ursprung.
- **Zusammengesetzte Fremdschlüssel für alle neuen Asset-Referenzen** (`organization_brand_profiles.display_font_asset_id`/`body_font_asset_id`, `department_brand_profiles.logo_asset_id`/`display_font_asset_id`/`body_font_asset_id`, dieselben drei auf `team_brand_profiles`) fehlten im Entwurf — ohne sie könnte eine Zeile theoretisch auf ein Asset eines fremden Vereins zeigen. AGENTS.md verlangt das für jede Tenant-Referenz.
- **`tone`-CHECK auch auf `department_brand_profiles`/`team_brand_profiles`**: der Entwurf hat den Constraint nur auf `organization_brand_profiles`, obwohl beide neuen Tabellen dasselbe Feld führen.
- **`authz.participates_in_department`**: eine neue, strikte Hilfsfunktion war nötig. Die bestehende `authz.is_department_member` hat einen Org-weiten Fallback (jedes Vereinsmitglied gilt als "Abteilungsmitglied", weil sie auch RLS für `departments`/`submissions`/`posts` trägt) — für die Asset-Abschottung zwischen Abteilungen wäre sie wirkungslos gewesen, jeder Handball-Kollege hätte als "Mitglied" der Abteilung Fußball gegolten. Die neue Funktion prüft ausschließlich echte `department_memberships`- oder `team_memberships`-Zeilen.

### Design-Entscheidung: Schreiben auf `department_brand_profiles`/`team_brand_profiles` nur über die API

Der Plan-Entwurf sieht dafür (anders als bei `brand_assets`) eine INSERT/UPDATE-Policy für `authenticated` vor. Das bleibt so (RLS erlaubt es), aber der tatsächliche Schreibpfad läuft über `PUT /v1/departments/:id/brand` bzw. `PUT /v1/teams/:id/brand`, nicht über einen direkten Supabase-Client-Aufruf aus der Oberfläche: nur der API-Endpunkt kann prüfen, ob ein referenziertes Asset (`logo_asset_id` etc.) auf der eigenen Ebene oder einer übergeordneten liegt — die Anforderung aus dem Plan-Text „`resolveBrand` und die Asset-Auswahl in der Oberfläche benutzen dieselbe Funktion … damit die Prüfung im Endpunkt nicht auseinanderläuft“ verlangt genau das. RLS bleibt die zweite Grenze, nicht die einzige.

### Design-Entscheidung: Asset-Upload als einzelner multipart-POST, kein zweistufiger Signed-URL-Fluss

Der Plan-Entwurf schlägt `POST /v1/brand/assets` → signierte Upload-URL → `POST /v1/brand/assets/:id/complete` vor. Der bereits gebaute Logo-Upload aus Paket 009 (`POST /v1/organizations/:id/brand/logo`) funktioniert anders: ein einzelner multipart-POST, den die API synchron validiert, verarbeitet und selbst in den Bucket schreibt. Es gibt im gesamten Repository kein Beispiel für einen zweistufigen signierten Upload. Um keine zweite Konvention einzuführen, folgt der neue allgemeine Endpunkt `POST /v1/brand/assets` demselben Einzel-POST-Muster; die separate Lizenzbestätigung für Schriften (`POST /v1/brand/assets/:id/confirm-license`) bleibt als zweiter Schritt bestehen, weil sie inhaltlich (nicht technisch) zweistufig ist — Datei und Lizenzformular existieren bewusst nacheinander.

## Umsetzung

### 1. Kuratierte Font-Registry

`packages/domain/src/fonts.ts`:

```ts
export interface CuratedFont {
  key: string; family: string; role: 'display' | 'body' | 'both'
  weights: readonly number[]
  license: 'ofl' | 'apache' | 'ufl'
  selfHostedPath: string        // im Repo mitgeliefert, nicht von einem CDN
}
```

Auswahl mit Bedacht klein halten: sechs bis acht Familien, die als Paar funktionieren und breite Sprachabdeckung mit Umlauten haben. Die bestehenden Manrope und DM Sans bleiben als Default drin, damit Paket 009 nichts umstellen muss.

**Die Dateien werden im Repository mitgeliefert und selbst ausgeliefert.** Grund: Google Fonts per CDN überträgt IP-Adressen an einen Drittanbieter in den USA, was für Vereinsseiten in Deutschland ein bekanntes Datenschutzrisiko ist. Selbst-Hosting löst das und ist gleichzeitig die Voraussetzung dafür, dass Remotion dieselben Dateien nutzen kann.

### 2. Asset-Upload mit echter Prüfung

`POST /v1/brand/assets` → signierte Upload-URL, dann `POST /v1/brand/assets/:id/complete` mit SHA-256. Der Abschluss löst serverseitige Prüfung aus.

Bilder:

- MIME-Typ **aus dem Dateiinhalt** bestimmen, nicht aus dem Header. Ein falsch deklarierter Typ ist der einfachste Angriff auf einen Upload-Endpunkt.
- Dimensionen und Seitenverhältnis lesen; Mindestgröße für Logos, damit das Rendering nicht verpixelt
- EXIF entfernen — `media_assets` hat dafür schon `exif_stripped_at` (`202608030001:28`), Branding-Assets brauchen es genauso
- **SVG**: über `packages/svg-safe` aus Paket 009 — Allowlist, XXE aus, Größen- und Tiefengrenzen vor dem Parser, Neuserialisierung, Auslieferung mit `nosniff` und restriktivem CSP-Header. Der Sanitizer wird hier nicht neu geschrieben, sondern für alle Asset-Arten mitbenutzt. Neu in diesem Paket sind zwei Ergänzungen:
  - **Rasterisiertes Derivat für jede SVG-Asset.** Remotion und die Meta-APIs brauchen ohnehin ein Rasterbild. Ein PNG in zwei Größen wird beim Upload erzeugt und im Render- und Publishing-Pfad verwendet. Damit kommt kein SVG in einen Pfad, in dem es außerhalb unserer Kontrolle interpretiert wird — die riskanteste Verwendung fällt weg, ohne dass der Verein auf sein Format verzichtet.
  - **Schrift in SVG**: `<text>` mit `font-family` rendert je Umgebung anders. Beim Upload wird gewarnt, wenn ein Logo Textelemente enthält, mit der Empfehlung, Text in Pfade umzuwandeln. Keine Blockade, aber eine Warnung, die spätere Überraschungen im Rendering verhindert.

Schriften:

- **Akzeptiert werden WOFF2, WOFF, TTF und OTF.** Ein Verein, der eine eigene Schrift besitzt, hat sie in der Regel als TTF oder OTF — ihn auf WOFF2 zu verweisen heißt, ihn zu einem Onlinekonverter zu schicken. Serverseitig wird nach WOFF2 konvertiert; ausgeliefert wird ausschließlich das WOFF2.
- Das löst auch den Bucket-Konflikt, ohne die MIME-Liste von `brand-assets` aufzuweichen: **das Original geht nach `raw-media`, das konvertierte WOFF2 nach `brand-assets`.** Das ist genau das Muster, das das Projekt schon zweimal benutzt — `media_assets` → `media_derivatives` und der SVG-Sanitizer aus Paket 009, wo das Original als Nachweis privat bleibt und nur das Ergebnis ausgeliefert wird. `raw-media` braucht dafür `font/woff2`, `font/ttf` und `font/otf` in seiner MIME-Liste (`202608020002:3`); `brand-assets` bleibt unverändert.
- **Scope-Entscheidung beim Bauen: Upload akzeptiert TTF, OTF und WOFF2 — legacy WOFF (Version 1) bewusst nicht**, abweichend vom ursprünglichen Plan-Wortlaut „WOFF2, WOFF, TTF und OTF“. Grund: die Konvertierung nach WOFF2 läuft über `fontkit` (Lesen/Validieren: Familie, Gewicht, Stil, `fsType`-Einbettungsbits) und `wawoff2` (TTF/OTF → WOFF2). Beide Bibliotheken können ein WOFF1 zwar lesen, aber nicht verlustfrei zu rohem SFNT zurückwandeln — das bräuchte eine vollständige eigene Neuserialisierung, die dieses Paket nicht rechtfertigt. Reale Schriftauslieferungen von Foundries sind heute praktisch immer TTF/OTF; ein WOFF1-Upload wird mit einer klaren Fehlermeldung abgelehnt, nicht stillschweigend falsch verarbeitet. Nachrüstbar, ohne etwas umzubauen.
- Konvertierung mit dem WOFF2-Encoder von Google (als `wawoff2` in Node verfügbar). Das ist eine Abhängigkeit und wenige Zeilen, kein Teilprojekt — der Aufwand liegt nicht in der Konvertierung, sondern in der Validierung darunter.
- Signatur prüfen, Tabellenstruktur validieren, `family`, `weight`, `style` aus der Datei lesen und **nicht** aus der Nutzereingabe übernehmen
- `OS/2`-Einbettungsbits (`fsType`) lesen. Verbietet die Datei Einbettung, wird sie abgelehnt mit Hinweis auf die Lizenz. Das schützt den Verein, nicht uns.
- Lizenzbestätigung ist Pflicht: Rechteinhaber, freie Notiz, Checkbox „Wir besitzen eine Lizenz, die die Nutzung in unseren Social-Media-Beiträgen erlaubt“. Erst danach `status = 'ready'`, plus `audit_events`-Eintrag mit Person und Zeitstempel.
- Größenbegrenzung pro Verein, damit der Bucket nicht als Dateiablage dient. Vorschlag: höchstens vier Schriftdateien.

Assets werden **nie ersetzt, nur abgelöst**: ein neuer Upload erzeugt eine neue Zeile, die alte wird `replaced`. Grund: `post_versions` und gerenderte Derivate verweisen indirekt auf das Erscheinungsbild zum Zeitpunkt der Freigabe. Ein überschriebenes Logo würde bereits freigegebene Medien nachträglich verändern und damit die Immutabilitätszusage aus `ADR-003` und `ADR-006` brechen.

### 3. Farbrollen und Kontrast

Fünf Rollen statt zwei Farben: `primary`, `accent`, `background`, `text`, `on_primary`. Die heutigen zwei Felder reichen nicht, um eine Kachel zu gestalten, ohne Werte zu erfinden.

`packages/domain/src/contrast.ts` implementiert das WCAG-Kontrastverhältnis und prüft die relevanten Paare: `text` auf `background`, `on_primary` auf `primary`, `text` auf `accent`. Unter 4.5:1 erscheint eine Warnung mit dem gemessenen Wert und einem Korrekturvorschlag. **Keine Blockade** — es ist das Corporate Design des Vereins. Aber die Warnung ist konkret, nicht dekorativ.

Tailwind wird von festen Farben auf CSS-Variablen umgestellt: `--brand-primary`, `--brand-accent`, `--brand-background`, `--brand-text`, `--brand-on-primary`. Die Variablen setzt ein Server-Plugin aus dem aufgelösten Markenprofil in den `<html>`-Style. Die bestehenden Tailwind-Namen (`forest`, `lime`, `oat`, `ink`) bleiben als Aliase auf die Variablen erhalten, damit nicht alle Templates gleichzeitig angefasst werden müssen — das wäre eine unnötig große Änderung mit hohem Regressionsrisiko.

### 4. Remotion

- Fonts werden im Renderer über `@remotion/fonts` oder `loadFont` registriert, bevor eine Komposition rendert. Ohne Registrierung fällt Remotion stumm auf eine Systemschrift zurück, und das Ergebnis weicht von der Vorschau ab — ein Fehler, der in der Freigabe erst spät auffällt.
- Das aufgelöste Markenprofil wird als Prop an die Komposition übergeben, inklusive signierter, kurzlebiger URLs für Logo und Schriftdateien. Keine dauerhaften öffentlichen URLs.
- Ein Snapshot des Markenprofils gehört in `post_versions.effective_config_snapshot` (Paket 011 füllt das Feld). Damit ist nachvollziehbar, mit welchem Erscheinungsbild eine Version freigegeben wurde.

### 5. Oberfläche

`pages/marke.vue` wird **erweitert** (Laden/Speichern/Fehlerzustand existieren bereits seit Paket 009, siehe Ausgangslage):

- Scope-Umschalter Verein / Abteilung / Mannschaft, mit sichtbarer Vererbung wie in Paket 011
- Assetliste zeigt Herkunft je Eintrag („vom Verein“, „aus dieser Abteilung“) und blendet fremde Abteilungs- und Mannschaftsassets aus, statt sie deaktiviert anzuzeigen — ein gesperrtes fremdes Logo in der Liste verrät bereits, dass es existiert
- Logo-Bereich mit Varianten und Vorschau auf hellem **und** dunklem Grund. Ein Logo, das nur auf Weiß funktioniert, fällt hier auf.
- Farbrollen mit Live-Kontrastanzeige neben jedem Paar
- Schriften: kuratierte Paare als visuelle Karten mit echtem Satzbeispiel, plus Bereich „Eigene Schrift“ mit Upload, Lizenzformular und Prüfstatus. Eine abgelehnte Datei nennt den Grund im Klartext.
- Live-Vorschau: eine echte Beitragskachel im Story- und im Feed-Format, die sich bei jeder Änderung sofort aktualisiert. Ohne diese Vorschau ist Branding blind konfiguriert.
- Speichern lädt neu und zeigt den persistierten Zustand, nicht den lokalen.

### 6. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/marke.vue` | ✓ 009: echtes Laden/Speichern/Fehlerzustand für Farben, Tonalität, Primär-/Dunkellogo | 013: Scope-Umschalter, Asset-Verwaltung mit Herkunftsanzeige, Schrift-Upload mit Lizenzformular, Live-Vorschau |
| `nuxt.config.ts:17-24` | Manrope und DM Sans von `fonts.googleapis.com` | selbst gehostete Dateien aus der Registry, keine Verbindung zu Google |
| `apps/web/app/assets/css/main.css:9-18` (`@theme`-Block, vormals `tailwind.config.ts`) | feste Hexwerte für `forest`, `lime`, `oat`, `ink` | CSS-Variablen aus dem Markenprofil, alte Namen als Aliase |
| `layouts/default.vue`, Vereins-Umschalter-Kachel | feste Initialen (`organizationInitials`) | Vereinslogo aus `organization_brand_profiles.logo_path`, Fallback auf Initialen — **Korrektur beim Bauen**: `components/AppLogo.vue` selbst bleibt unverändert, sie steht auch in `layouts/admin.vue`/`layouts/auth.vue` ohne (oder ohne eindeutigen) aktiven Verein und zeigt dort absichtlich die Produktmarke „vereinsfunk“, nicht die eines einzelnen Vereins. Der eigentliche Rückbau-Ort ist die bereits vorhandene, bislang immer nur Initialen zeigende Kachel im Vereins-Umschalter |
| `organization_brand_profiles.settings` | schemaloses `jsonb` | bleibt bestehen, wird aber nicht weiter befüllt; neue Felder sind typisiert |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests: `resolveBrand` respektiert `allow_department_overrides`, `allow_team_overrides` und `locked_fields` beider Ebenen; die Mannschaft erbt von der Abteilung, nicht direkt vom Verein, wenn die Abteilung abweicht; Kontrastberechnung gegen bekannte WCAG-Referenzwerte; Font-Asset schlägt Font-Key.
- pgTAP: Schrift-Asset ohne `license_confirmed_at` lässt sich in `processing` anlegen, aber nicht auf `ready` setzen; ein `ready`-Font ohne `license_holder` oder `license_confirmed_by` verstößt ebenso gegen CHECK; Asset einer fremden Organisation ist nicht lesbar; `department_brand_profiles` einer fremden Abteilung ist nicht schreibbar; `authenticated` kann in `brand_assets` **nicht** direkt schreiben (Prüfung, Sanitisierung und Rasterderivat entstehen serverseitig) — alle Brandingtabellen tragen RLS, was ein positiver *und* ein negativer Fall belegen muss; ein Team-Asset mit `department_id is null` verstößt gegen CHECK.
- pgTAP zur Abschottung, die eigentliche Anforderung: ein Asset der Abteilung Fußball ist für ein Mitglied der Abteilung Handball **nicht** lesbar und nicht referenzierbar, obwohl beide zum selben Verein gehören; ein Mannschaftsasset ist für die Schwesternmannschaft unsichtbar; das Vereinsasset ist für beide sichtbar. Ohne diese drei Fälle ist „eigenes Branding, das andere nicht nutzen können“ nur eine Absichtserklärung.
- Upload-Tests: PNG mit falsch deklariertem MIME-Typ → 400; SVG mit `<script>` → sanitisiert oder abgelehnt, nie unverändert gespeichert; WOFF2 mit gesperrten Einbettungsbits → abgelehnt mit Begründung; Font ohne Lizenzbestätigung bleibt `processing`; **je Format — WOFF2, WOFF, TTF, OTF — kommt das Original in `raw-media` an und das konvertierte WOFF2 in `brand-assets`**, geprüft am tatsächlichen Objekt und nicht an der Antwort; das findet eine MIME-Liste, die zur Oberfläche nicht passt.
- Rendering: eine Komposition mit eigener Schrift rendert sichtbar in dieser Schrift. **Ein Test, der nur prüft, dass das Rendering nicht abbricht, genügt hier nicht** — der stumme Fallback ist genau der Fehler, den es zu finden gilt. Pixelvergleich gegen eine Referenz oder Prüfung der eingebetteten Schriftmetadaten.
- manuell: Farben ändern, Vorschau folgt sofort; Abteilung überschreibt Akzentfarbe; Verein sperrt das Feld, Abteilung sieht es deaktiviert mit Begründung; Logo austauschen, ein bereits freigegebener Beitrag zeigt weiterhin das alte Logo.

## Risiken und offene Entscheidungen

- **SVG-Sanitisierung** kommt aus Paket 009 und ist damit eine Abhängigkeit, nicht ein Risiko dieses Pakets. Das Risiko hier ist Nachlässigkeit im Umgang damit: jeder neue Asset-Typ muss durch denselben Sanitizer, und der Testkorpus wächst mit. Ein zweiter, „schnellerer“ Pfad für Assets, die man für harmlos hält, ist die Art Abkürzung, die eine Sicherheitsmaßnahme wirkungslos macht.
- **Schriftlizenzen**: Vereine besitzen häufig eine Desktop-Lizenz und keine Web- oder Einbettungslizenz. Die Bestätigung verlagert die Verantwortung, beseitigt das Risiko aber nicht. Der Bestätigungstext sollte juristisch geprüft und in Paket 020 mit den übrigen Rechtstexten behandelt werden.
- **Tailwind auf CSS-Variablen** umzustellen berührt viele Templates. Der Alias-Ansatz begrenzt das, aber Farben, die per `:style` gesetzt werden (etwa `pages/index.vue:70`, `pages/freigaben.vue:12`) verschwinden mit ihren Dummy-Daten ohnehin in den Paketen 009 und 015.
- **Kontrast als Warnung, nicht als Blockade** ist eine bewusste Produktentscheidung. Wer Barrierefreiheit erzwingen will, muss sie hier zur Pflicht machen — das würde manche Vereinsfarben ausschließen und sollte dann ausdrücklich beschlossen werden.
- **Tailwind-Arbitrary-Hexwerte außerhalb der benannten Tokens** (rund 275 Fundstellen in ca. 20 Dateien, siehe Ausgangslage) bleiben nach diesem Paket bestehen. Der Alias-Ansatz löst nur `forest`/`lime`/`oat`/`ink`/`coral` in CSS-Variablen auf; Fließtext- und Rahmenfarben, die als `text-[#…]`/`bg-[#…]` direkt in einzelnen Seiten stehen, folgen dem Markenprofil weiterhin nicht. Bewusst nicht in diesem Paket behoben (chirurgische Änderung, kein Umbau von 20 fremden Seiten) — wer künftig vollständige Markenkonsistenz will, braucht ein eigenes, kleines Nachfolgepaket.
- **Kuratierte Font-Registry bewusst kleiner als empfohlen**: der Plan-Entwurf nennt „sechs bis acht Familien“, umgesetzt sind zwei Paare (Manrope/DM Sans als bestehender Default, Space Grotesk/Karla neu — vier Familien, `packages/domain/src/fonts.ts`). Das Vendern real lizenzierter, selbst gehosteter Schriftdateien ist der eigentliche Aufwand, nicht der Code — ein drittes oder viertes Paar zu ergänzen ist reine Datenpflege (WOFF2-Dateien + ein Registry-Eintrag), keine Codeänderung.
- **Beim adversarialen Review gefundene und behobene Lücke**: die RLS-Policies für `department_brand_profiles`/`team_brand_profiles` prüften ursprünglich nur `brand.manage` im eigenen Scope, nicht aber, ob eine referenzierte Asset-ID (`logo_asset_id`, `display_font_asset_id`, `body_font_asset_id`) überhaupt zur eigenen oder einer übergeordneten Ebene gehört — der Migrationskommentar behauptete fälschlich, das laufe „zusätzlich im API-Endpunkt“. Per direktem PostgREST-Zugriff (außerhalb der Oberfläche) hätte eine Abteilung so das Asset einer Schwesterabteilung referenzieren können. Behoben durch `authz.brand_asset_is_selectable()` als zweite, echte RLS-Grenze (SQL-Spiegel von `isBrandAssetSelectable`), mit vier neuen pgTAP-Regressionstests. Ebenfalls beim Review gefunden und behoben: `POST /v1/brand/assets` prüfte bei einem `teamId` nicht dessen `organization_id`, `POST /v1/brand/assets/:id/confirm-license` las das Asset vor der Berechtigungsprüfung per Service Role (kleines Existenz-/Art-Leck über Vereinsgrenzen hinweg) statt über den RLS-gebundenen Nutzer-Client, und `processBrandFontUpload` griff ungeschützt auf eine möglicherweise fehlende OS/2-Tabelle zu (hätte zu einem rohen 500 statt einer 400-Antwort geführt).
- **Verifikationslücken, die nach diesem Paket offen bleiben**: der im Plan geforderte Rendering-Test „eine Komposition mit eigener Schrift rendert sichtbar in dieser Schrift, Pixelvergleich oder Prüfung eingebetteter Schriftmetadaten“ existiert nicht — `apps/remotion/src/ClubPost.test.ts` prüft nur das Zod-Schema, nicht das tatsächliche Rendering. Ebenso fehlt ein Test mit gesperrten Einbettungsbits (`fsType.noEmbedding`) für `FontEmbeddingRestrictedError` — eine solche Schriftdatei lässt sich ohne eine reale, lizenzrestriktive Testdatei nicht ehrlich konstruieren. Und es gibt keinen Erfolgspfad-Test für `POST /v1/brand/assets`, der die tatsächlichen Storage-Objekte prüft (Original in `raw-media`, WOFF2 in `brand-assets`) — konsistent mit der bestehenden Projektkonvention, dass kein Test in `apps/api` Supabase Storage mockt (auch der bestehende Logo-Upload aus Paket 009 hat keinen solchen Test). Alle drei Lücken sind über den manuellen Browser-Test dieses Pakets abzudecken, nicht über automatisierte Tests.
- **Abteilungsbranding und Wiedererkennbarkeit** stehen in Spannung. `allow_department_overrides` und `allow_team_overrides` stehen per Default auf `true` — entschieden, weil Abteilungen und Mannschaften ausdrücklich eigenes Branding führen können sollen. Ein Verein, dem Einheitlichkeit wichtig ist, schaltet es ab oder sperrt einzelne Felder über `locked_fields`. Mit drei Ebenen wächst allerdings die Zahl der Kombinationen, die die Oberfläche erklären muss: die Prosa-Zusammenfassung „was gilt hier konkret und woher kommt es“ ist auf Mannschaftsebene wichtiger als auf Vereinsebene.
