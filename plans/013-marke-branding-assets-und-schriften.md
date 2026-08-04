# 013 – Marke, Branding-Assets und Schriften

## Ergebnis

Ein Verein pflegt sein Erscheinungsbild vollständig selbst: Logo in mehreren Varianten, Farbrollen mit geprüftem Kontrast, ein Schriftpaar aus kuratierter Auswahl **oder** eigene lizenzierte Schriftdateien. Abteilungen dürfen innerhalb eines vom Verein gesetzten Rahmens abweichen. Dieselben Werte gelten in der Web-Vorschau und im Remotion-Rendering — kein Beitrag sieht in der Vorschau anders aus als im Ergebnis.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `supabase/migrations/202608020001_initial_tenant_foundation.sql:120-130`: `organization_brand_profiles` kennt `logo_path`, `primary_color`, `accent_color`, `tone` und ein schemaloses `settings jsonb`. **Keine Schriftarten, keine Logo-Varianten, keine Abteilungsebene.**
- Die Tabelle hat SELECT- und UPDATE-Policies (`:405-408`), aber **keine INSERT-Policy**. Ein Markenprofil entsteht nur über die Service Role — Paket 009 legt es bei der Vereinserstellung mit an.
- `supabase/migrations/202608020002_private_storage.sql`: Bucket `brand-assets` ist privat, 20 MB Limit, erlaubt `image/svg+xml`, `image/png`, `image/jpeg` und **`font/woff2`**. Es gibt nur `storage_read_own_organization`; `storage_upload_department` gilt ausschließlich für `raw-media`. Uploads müssen über die API laufen — das ist die richtige Grenze, weil Fonts und SVG serverseitig geprüft werden müssen.
- `apps/web/nuxt.config.ts:14-21` lädt Manrope und DM Sans fest von `fonts.googleapis.com`. Zwei Konsequenzen: das Erscheinungsbild ist nicht vereinsspezifisch, und jeder Seitenaufruf kontaktiert Google — datenschutzrechtlich in Deutschland heikel und in Paket 020 ohnehin zu beheben.
- `apps/web/tailwind.config.ts` definiert `font-display`, `forest`, `lime`, `coral`, `oat`, `ink`. Diese Farben sind über alle Seiten fest verdrahtet, unter anderem `bg-forest` in `layouts/default.vue:69` und `pages/index.vue:36`.
- `apps/web/app/pages/marke.vue:1` hält Farben in lokalem `reactive`, Tonalität in `ref`, und „Änderungen speichern“ setzt nur `saved = true`. Nichts wird geladen, nichts gespeichert.
- `apps/web/app/components/AppLogo.vue` rendert ein statisches Logo; `pages/marke.vue` zeigt „SN“ als Platzhalter-Initialen aus dem Demo-Verein.
- `apps/remotion/src/ClubPost.tsx` existiert für Story- und Feed-Formate. Ob und wie es Marken-Props entgegennimmt, ist beim Umsetzen zu prüfen — Fonts müssen im Renderer registriert sein, sonst fällt das Rendering stumm auf eine Ersatzschrift zurück.

## Scope

- Migration: Markenprofil erweitern, Abteilungsbranding, Schrift-Registry und eigene Schriften, Asset-Tabelle
- kuratierte Font-Registry in `packages/domain`
- API: Asset-Upload mit Validierung, SVG-Sanitisierung, Font-Prüfung, Lizenzbestätigung
- Farbrollen und Kontrastprüfung
- Anbindung an Web-Darstellung und Remotion
- Nuxt: echte Markenseite mit Live-Vorschau, Abteilungs-Overrides
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
  department_id uuid,                              -- null = gilt vereinsweit
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
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
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
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, department_id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade
);
```

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

**Vererbung** folgt derselben Richtung wie Paket 011: die Abteilung darf abweichen, nur wenn der Verein es zulässt. `resolveBrand(organizationProfile, departmentProfile?)` in `packages/domain` ist die einzige Auflösungsfunktion und respektiert `allow_department_overrides` und `locked_fields`.

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

- nur WOFF2 (Bucket erlaubt bereits `font/woff2`); optional TTF/OTF, dann serverseitig nach WOFF2 konvertieren, damit im Web nur ein Format ausgeliefert wird. **Dazu gehört eine Migrationszeile**: `brand-assets` erlaubt heute ausschließlich `image/svg+xml`, `image/png`, `image/jpeg` und `font/woff2` (`202608020002:5`). Eine signierte Upload-URL für TTF/OTF würde am `mimetype` des Objekts scheitern. Entweder wird die MIME-Liste des Buckets in derselben Migration um `font/ttf` und `font/otf` erweitert, oder der TTF/OTF-Pfad entfällt und die Oberfläche verlangt WOFF2. Die Entscheidung gehört in diesen Plan, nicht in die Implementierung.
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

`pages/marke.vue` wird ersetzt:

- Scope-Umschalter Verein / Abteilung, mit sichtbarer Vererbung wie in Paket 011
- Logo-Bereich mit Varianten und Vorschau auf hellem **und** dunklem Grund. Ein Logo, das nur auf Weiß funktioniert, fällt hier auf.
- Farbrollen mit Live-Kontrastanzeige neben jedem Paar
- Schriften: kuratierte Paare als visuelle Karten mit echtem Satzbeispiel, plus Bereich „Eigene Schrift“ mit Upload, Lizenzformular und Prüfstatus. Eine abgelehnte Datei nennt den Grund im Klartext.
- Live-Vorschau: eine echte Beitragskachel im Story- und im Feed-Format, die sich bei jeder Änderung sofort aktualisiert. Ohne diese Vorschau ist Branding blind konfiguriert.
- Speichern lädt neu und zeigt den persistierten Zustand, nicht den lokalen.

### 6. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/marke.vue:1` | lokaler `reactive`-State, `saved = true` ohne Persistenz, „SN“ als Platzhalter | echtes Laden und Speichern, echtes Logo, echte Fehler und Ladezustände |
| `nuxt.config.ts:14-21` | Manrope und DM Sans von `fonts.googleapis.com` | selbst gehostete Dateien aus der Registry, keine Verbindung zu Google |
| `tailwind.config.ts` | feste Hexwerte für `forest`, `lime`, `oat`, `ink` | CSS-Variablen aus dem Markenprofil, alte Namen als Aliase |
| `components/AppLogo.vue` | statisches Logo | Vereinslogo aus `brand_assets`, Fallback auf Initialen |
| `organization_brand_profiles.settings` | schemaloses `jsonb` | bleibt bestehen, wird aber nicht weiter befüllt; neue Felder sind typisiert |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests: `resolveBrand` respektiert `allow_department_overrides` und `locked_fields`; Kontrastberechnung gegen bekannte WCAG-Referenzwerte; Font-Asset schlägt Font-Key.
- pgTAP: Schrift-Asset ohne `license_confirmed_at` lässt sich in `processing` anlegen, aber nicht auf `ready` setzen; ein `ready`-Font ohne `license_holder` oder `license_confirmed_by` verstößt ebenso gegen CHECK; Asset einer fremden Organisation ist nicht lesbar; `department_brand_profiles` einer fremden Abteilung ist nicht schreibbar; `authenticated` kann in `brand_assets` **nicht** direkt schreiben (Prüfung, Sanitisierung und Rasterderivat entstehen serverseitig) — beide Tabellen tragen RLS, was ein positiver *und* ein negativer Fall belegen muss.
- Upload-Tests: PNG mit falsch deklariertem MIME-Typ → 400; SVG mit `<script>` → sanitisiert oder abgelehnt, nie unverändert gespeichert; WOFF2 mit gesperrten Einbettungsbits → abgelehnt mit Begründung; Font ohne Lizenzbestätigung bleibt `processing`; ein Upload je unterstütztem Schriftformat kommt tatsächlich im Bucket an — das findet eine MIME-Liste, die zur Oberfläche nicht passt.
- Rendering: eine Komposition mit eigener Schrift rendert sichtbar in dieser Schrift. **Ein Test, der nur prüft, dass das Rendering nicht abbricht, genügt hier nicht** — der stumme Fallback ist genau der Fehler, den es zu finden gilt. Pixelvergleich gegen eine Referenz oder Prüfung der eingebetteten Schriftmetadaten.
- manuell: Farben ändern, Vorschau folgt sofort; Abteilung überschreibt Akzentfarbe; Verein sperrt das Feld, Abteilung sieht es deaktiviert mit Begründung; Logo austauschen, ein bereits freigegebener Beitrag zeigt weiterhin das alte Logo.

## Risiken und offene Entscheidungen

- **SVG-Sanitisierung** kommt aus Paket 009 und ist damit eine Abhängigkeit, nicht ein Risiko dieses Pakets. Das Risiko hier ist Nachlässigkeit im Umgang damit: jeder neue Asset-Typ muss durch denselben Sanitizer, und der Testkorpus wächst mit. Ein zweiter, „schnellerer“ Pfad für Assets, die man für harmlos hält, ist die Art Abkürzung, die eine Sicherheitsmaßnahme wirkungslos macht.
- **Schriftlizenzen**: Vereine besitzen häufig eine Desktop-Lizenz und keine Web- oder Einbettungslizenz. Die Bestätigung verlagert die Verantwortung, beseitigt das Risiko aber nicht. Der Bestätigungstext sollte juristisch geprüft und in Paket 020 mit den übrigen Rechtstexten behandelt werden.
- **Tailwind auf CSS-Variablen** umzustellen berührt viele Templates. Der Alias-Ansatz begrenzt das, aber Farben, die per `:style` gesetzt werden (etwa `pages/index.vue:70`, `pages/freigaben.vue:12`) verschwinden mit ihren Dummy-Daten ohnehin in den Paketen 009 und 015.
- **Kontrast als Warnung, nicht als Blockade** ist eine bewusste Produktentscheidung. Wer Barrierefreiheit erzwingen will, muss sie hier zur Pflicht machen — das würde manche Vereinsfarben ausschließen und sollte dann ausdrücklich beschlossen werden.
- **Abteilungsbranding und Wiedererkennbarkeit** stehen in Spannung. `allow_department_overrides` steht per Default auf `true`; ein Verein, dem Einheitlichkeit wichtig ist, muss es aktiv abschalten. Der umgekehrte Default wäre auch vertretbar und ist eine Produktentscheidung.
