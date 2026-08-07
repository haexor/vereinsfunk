begin;

-- Paket 013: Marke, Branding-Assets und Schriften. Plan-Dateiname war
-- 2026080406_brand_assets_and_fonts.sql -- dieser Zeitstempel liegt vor allen
-- 2026080501..2026080701-Migrationen aus den Paketen 009-012 (gleiches Muster wie bereits bei
-- 2026080606 und 2026080701 dokumentiert). Der tatsaechliche Dateiname folgt der naechsten
-- freien Zeitscheibe.

-- 0. Neue Verwaltungsrechte je Ebene ------------------------------------------------------------
--
-- organization_owner (immer "true") und organization_admin (immer "permission <> billing.manage")
-- erhalten brand.manage automatisch, ohne dass ihre case-Zweige angepasst werden muessen. Volle
-- Funktionskopie beider Funktionen aus 2026080701_channel_scoping_and_secrets.sql bzw.
-- 2026080601_structure_and_invitations.sql, nur die betroffenen Arrays um 'brand.manage' erweitert
-- (siehe packages/authorization fuer das TS-Gegenstueck).
create or replace function authz.has_department_permission(target_department_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.department_memberships membership
    where membership.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view'])
        when 'editor' then permission = any(array['post.create','post.edit','post.submit','analytics.view'])
        when 'approver' then permission = any(array['post.approve','analytics.view'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.departments department
    where department.id = target_department_id
      and authz.has_organization_permission(department.organization_id, permission)
  );
$$;

create or replace function authz.has_team_permission(target_team_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_memberships membership
    where membership.team_id = target_team_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'team_manager' then permission = any(array['post.create','post.edit','post.submit','analytics.view','member.invite','member.remove','brand.manage'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.teams team
    where team.id = target_team_id
      and authz.has_department_permission(team.department_id, permission)
  );
$$;

-- Strikte Mitgliedschaftspruefung ohne den Org-weiten Fallback von is_department_member: jene
-- Funktion gilt fuer JEDES Vereinsmitglied als "Abteilungsmitglied" (sie traegt RLS fuer
-- departments/submissions/posts, wo das gewollt ist), waere hier also wirkungslos -- die
-- Abschottung zwischen Abteilungen wuerde nie greifen. Ein Mitglied "nimmt teil", wenn es eine
-- echte department_memberships-Zeile hat ODER Mitglied irgendeines Teams dieser Abteilung ist
-- (sonst saehe ein reiner Team-Mitspieler ohne Abteilungsrolle nicht einmal die Assets seiner
-- eigenen Abteilung, obwohl "Waehlbar ... sind genau die Assets auf S oder einer uebergeordneten
-- Ebene" das verlangt).
create or replace function authz.participates_in_department(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.department_memberships membership
    where membership.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
  ) or exists (
    select 1 from public.team_memberships membership
    join public.teams team on team.id = membership.team_id
    where team.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
  );
$$;
revoke all on function authz.participates_in_department(uuid) from public;
grant execute on function authz.participates_in_department(uuid) to authenticated, service_role;

-- 1. Branding-Assets --------------------------------------------------------------------------
--
-- Logos (mehrere Varianten), Wasserzeichen und eigene Schriften, mit Besitzebene und
-- gegenseitiger Abschottung zwischen Abteilungen/Mannschaften.
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
  -- Ergaenzt gegenueber dem Plan-Entwurf: das rasterisierte SVG-Derivat (Abschnitt "Bilder" der
  -- Umsetzung) braucht eine Ablage. Zwei Groessen je nach Verwendungszweck (Remotion, Meta),
  -- leer ('{}') fuer alles ausser 'kind' mit SVG-Ursprung.
  raster_derivative_paths jsonb not null default '{}'::jsonb check (jsonb_typeof(raster_derivative_paths) = 'object'),
  -- Nur fuer kind = 'font'
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
  -- Die Lizenzpflicht haengt am Status, nicht am Insert: eine Schriftdatei muss sich hochladen
  -- und pruefen lassen, bevor der Verein die Lizenz bestaetigt. Sie kann sehr wohl in
  -- 'processing' liegen -- erst der Uebergang nach 'ready' verlangt Familie, Rechteinhaber,
  -- Zeitpunkt und Person.
  check (kind <> 'font' or status <> 'ready'
         or (font_family is not null and license_holder is not null
             and license_confirmed_at is not null and license_confirmed_by is not null))
);

create index brand_assets_scope_idx on public.brand_assets(organization_id, department_id, team_id, kind, status);

-- 2. Markenprofil erweitern (Verein) ------------------------------------------------------------
--
-- logo_path/logo_dark_path (Paket 009) bleiben unveraendert bestehen -- siehe Design-Entscheidung
-- in plans/013, Abschnitt "Ausgangslage": der bestehende Logo-Upload wird auf brand_assets
-- umgestellt statt eine Parallelstruktur zu schaffen, die zwei Spalten bleiben denormalisierte
-- Zeiger auf den jeweils aktuellen 'ready'-Asset-Pfad.
alter table public.organization_brand_profiles
  add column background_color text not null default '#f6f4ec' check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  add column text_color text not null default '#122820' check (text_color ~ '^#[0-9a-fA-F]{6}$'),
  add column on_primary_color text not null default '#ffffff' check (on_primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column display_font_asset_id uuid,
  add column body_font_asset_id uuid,
  add column allow_department_overrides boolean not null default true,
  add column locked_fields text[] not null default '{}';

-- Ergaenzt gegenueber dem Plan-Entwurf: zusammengesetzte Fremdschluessel fuer die neuen
-- Asset-Referenzen fehlten im Entwurf (AGENTS.md verlangt sie fuer jede Tenant-Referenz, damit
-- keine Zeile eines fremden Vereins referenzierbar ist).
alter table public.organization_brand_profiles
  add constraint organization_brand_profiles_display_font_fk
    foreign key (organization_id, display_font_asset_id) references public.brand_assets(organization_id, id),
  add constraint organization_brand_profiles_body_font_fk
    foreign key (organization_id, body_font_asset_id) references public.brand_assets(organization_id, id);

-- 3. Markenprofil je Abteilung und Mannschaft --------------------------------------------------
--
-- Eigenes Branding auf jeder Ebene, aber keine Quervermischung -- das ist die Anforderung, sie
-- steht nicht automatisch aus der Mandantentrennung, weil alle Zeilen dieselbe organization_id
-- tragen. Deshalb eigene Policies unten und eigene negative Tests.
create table public.department_brand_profiles (
  organization_id uuid not null, department_id uuid not null,
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_asset_id uuid,
  -- Ergaenzt gegenueber dem Plan-Entwurf: derselbe CHECK wie organization_brand_profiles.tone,
  -- sonst kann ein Tippfehler resolveBrand lautlos auf eine unbekannte Tonalitaet setzen.
  tone text check (tone is null or tone in ('nahbar','dynamisch','sachlich')),
  display_font_asset_id uuid, body_font_asset_id uuid,
  allow_team_overrides boolean not null default true,
  locked_fields text[] not null default '{}',
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, department_id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, logo_asset_id) references public.brand_assets(organization_id, id),
  foreign key (organization_id, display_font_asset_id) references public.brand_assets(organization_id, id),
  foreign key (organization_id, body_font_asset_id) references public.brand_assets(organization_id, id)
);

-- Dritte Ebene, gleiche Felder, gleiche Vererbungsrichtung.
create table public.team_brand_profiles (
  organization_id uuid not null, department_id uuid not null, team_id uuid not null,
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_asset_id uuid,
  tone text check (tone is null or tone in ('nahbar','dynamisch','sachlich')),
  display_font_asset_id uuid, body_font_asset_id uuid,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, department_id, team_id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, logo_asset_id) references public.brand_assets(organization_id, id),
  foreign key (organization_id, display_font_asset_id) references public.brand_assets(organization_id, id),
  foreign key (organization_id, body_font_asset_id) references public.brand_assets(organization_id, id)
);

-- 4. Row Level Security ---------------------------------------------------------------------
--
-- Schreiben auf brand_assets laeuft ausschliesslich ueber die API mit Service Role, weil
-- Pruefung, Sanitisierung, Rasterderivat und WOFF2-Konvertierung serverseitig entstehen --
-- deshalb keine insert/update-Policy fuer authenticated, analog invitations/consent_records.
alter table public.brand_assets enable row level security;
alter table public.brand_assets force row level security;
alter table public.department_brand_profiles enable row level security;
alter table public.department_brand_profiles force row level security;
alter table public.team_brand_profiles enable row level security;
alter table public.team_brand_profiles force row level security;

-- Abschottung: ein Asset ist nur sichtbar fuer Mitglieder seiner eigenen Ebene (oder fuer
-- Personen mit Verwaltungsaufsicht von oben), nie fuer eine Schwesterabteilung/-mannschaft.
-- Vereinsweite Assets (beide Spalten null) sind fuer jedes Vereinsmitglied sichtbar.
-- is_any_member_of_organization statt is_organization_member, aus demselben Grund wie bei
-- channel_scopes/policy_settings (2026080701/2026080606): die meisten Vereinsmitglieder haben
-- ausschliesslich eine Abteilungs- oder Teamrolle, keine Organisationsrolle -- mit der engeren
-- Funktion saehe ein reiner Abteilungsadmin nicht einmal das vereinsweite Logo.
create policy brand_assets_select on public.brand_assets for select to authenticated using (
  authz.is_any_member_of_organization(organization_id)
  and (
    department_id is null
    or (
      team_id is null
      and (authz.participates_in_department(department_id) or authz.has_department_permission(department_id, 'department.manage'))
    )
    or (
      team_id is not null
      and (authz.has_team_membership(team_id) or authz.has_department_permission(department_id, 'department.manage'))
    )
  )
);

-- department_brand_profiles/team_brand_profiles sind die AUFGELOESTEN Markeneinstellungen einer
-- Ebene (Farben, gewaehlte Assets), keine hochgeladenen Dateien -- anders als brand_assets nicht
-- vertraulich, deshalb vereinsweit lesbar (jedes Mitglied sieht, wie jede Abteilung markiert ist).
create policy department_brand_profiles_select on public.department_brand_profiles for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));

-- Spiegelt isBrandAssetSelectable (packages/domain/src/brand.ts) als SQL-Funktion: ein Asset ist
-- waehlbar, wenn es vereinsweit ist, oder auf genau der Zielebene (Abteilung/Mannschaft) liegt,
-- oder -- fuer eine Mannschaft -- auf deren Abteilung. Ergaenzt gegenueber dem urspruenglichen
-- Migrationsentwurf: der dortige Kommentar behauptete, diese Pruefung liefe "zusaetzlich im
-- API-Endpunkt" und RLS pruefe nur die Berechtigung -- das liess sich per direktem PostgREST-
-- Zugriff umgehen (adversariale Pruefung dieses Pakets), weil die Berechtigungspruefung allein
-- keine Aussage ueber die HERKUNFT des referenzierten Assets trifft. Ohne diese Funktion haette
-- eine Abteilung mit eigenem brand.manage ein Asset einer Schwesterabteilung referenzieren
-- koennen, ohne die API zu benutzen.
create or replace function authz.brand_asset_is_selectable(
  target_asset_id uuid, target_organization_id uuid, target_department_id uuid, target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.brand_assets asset
    where asset.id = target_asset_id
      and asset.organization_id = target_organization_id
      and asset.status = 'ready'
      and (
        asset.department_id is null
        or (asset.department_id = target_department_id and (asset.team_id is null or asset.team_id = target_team_id))
      )
  );
$$;
revoke all on function authz.brand_asset_is_selectable(uuid, uuid, uuid, uuid) from public;
grant execute on function authz.brand_asset_is_selectable(uuid, uuid, uuid, uuid) to authenticated, service_role;

create policy department_brand_profiles_insert on public.department_brand_profiles for insert to authenticated
  with check (
    updated_by = auth.uid() and authz.has_department_permission(department_id, 'brand.manage')
    and (logo_asset_id is null or authz.brand_asset_is_selectable(logo_asset_id, organization_id, department_id, null))
    and (display_font_asset_id is null or authz.brand_asset_is_selectable(display_font_asset_id, organization_id, department_id, null))
    and (body_font_asset_id is null or authz.brand_asset_is_selectable(body_font_asset_id, organization_id, department_id, null))
  );
create policy department_brand_profiles_update on public.department_brand_profiles for update to authenticated
  using (authz.has_department_permission(department_id, 'brand.manage'))
  with check (
    updated_by = auth.uid() and authz.has_department_permission(department_id, 'brand.manage')
    and (logo_asset_id is null or authz.brand_asset_is_selectable(logo_asset_id, organization_id, department_id, null))
    and (display_font_asset_id is null or authz.brand_asset_is_selectable(display_font_asset_id, organization_id, department_id, null))
    and (body_font_asset_id is null or authz.brand_asset_is_selectable(body_font_asset_id, organization_id, department_id, null))
  );

create policy team_brand_profiles_select on public.team_brand_profiles for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));
create policy team_brand_profiles_insert on public.team_brand_profiles for insert to authenticated
  with check (
    updated_by = auth.uid() and authz.has_team_permission(team_id, 'brand.manage')
    and (logo_asset_id is null or authz.brand_asset_is_selectable(logo_asset_id, organization_id, department_id, team_id))
    and (display_font_asset_id is null or authz.brand_asset_is_selectable(display_font_asset_id, organization_id, department_id, team_id))
    and (body_font_asset_id is null or authz.brand_asset_is_selectable(body_font_asset_id, organization_id, department_id, team_id))
  );
create policy team_brand_profiles_update on public.team_brand_profiles for update to authenticated
  using (authz.has_team_permission(team_id, 'brand.manage'))
  with check (
    updated_by = auth.uid() and authz.has_team_permission(team_id, 'brand.manage')
    and (logo_asset_id is null or authz.brand_asset_is_selectable(logo_asset_id, organization_id, department_id, team_id))
    and (display_font_asset_id is null or authz.brand_asset_is_selectable(display_font_asset_id, organization_id, department_id, team_id))
    and (body_font_asset_id is null or authz.brand_asset_is_selectable(body_font_asset_id, organization_id, department_id, team_id))
  );

-- RLS allein reicht nicht: ohne diese table-level GRANTs verweigert Postgres den Zugriff, bevor
-- eine Policy ueberhaupt ausgewertet wird (siehe die Grants fuer channel_scopes/approval_stages
-- in 2026080606/2026080701 als Vorbild).
grant select on public.brand_assets to authenticated;
grant all privileges on public.brand_assets to service_role;
grant select, insert, update on public.department_brand_profiles to authenticated;
grant all privileges on public.department_brand_profiles to service_role;
grant select, insert, update on public.team_brand_profiles to authenticated;
grant all privileges on public.team_brand_profiles to service_role;

create trigger set_brand_assets_updated_at before update on public.brand_assets for each row execute function public.set_updated_at();
create trigger set_department_brand_profiles_updated_at before update on public.department_brand_profiles for each row execute function public.set_updated_at();
create trigger set_team_brand_profiles_updated_at before update on public.team_brand_profiles for each row execute function public.set_updated_at();

-- 5. Storage: Schriftformate fuer raw-media (Originalablage vor der WOFF2-Konvertierung) --------
--
-- brand-assets bleibt unveraendert (nur image/svg+xml, image/png, image/jpeg, font/woff2 --
-- das konvertierte Ergebnis). Das Original (TTF/OTF/WOFF2) landet in raw-media, analog zum
-- Original/Derivat-Muster von media_assets/media_derivatives und dem SVG-Sanitizer aus Paket 009.
-- Legacy WOFF (Version 1) bewusst nicht in dieser Liste: siehe Design-Entscheidung in
-- plans/013 -- ohne vollstaendige SFNT-Neuserialisierung laesst sich daraus kein WOFF2 erzeugen,
-- und reale Schrift-Auslieferungen sind heute praktisch immer TTF/OTF.
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','font/woff2','font/ttf','font/otf']
where id = 'raw-media';

commit;
