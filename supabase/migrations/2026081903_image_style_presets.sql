begin;

-- Plan 045, PR 1: Bildstil-Presets (Rahmen, Logo-Wasserzeichen, Filter) als eigenes,
-- mehrschichtiges Datenmodell -- gleiche Besitzebene wie brand_assets (Verein/Abteilung/
-- Mannschaft), aber ein eigener Datensatz je Preset statt eines Singleton-Profils je Ebene: ein
-- Verein pflegt beliebig viele Presets (plans/045, "Ergebnis").
create type public.image_style_frame_type as enum ('none', 'parametric', 'custom');
create type public.image_style_filter as enum ('original', 'schwarz_weiss', 'kontrastreich', 'warm', 'vereinsfarben_duoton');
create type public.image_style_logo_position as enum ('bottom_right', 'bottom_left', 'top_right', 'top_left', 'center');

-- Zielschluessel fuer die typisierten Fremdschluessel unten: frame_brand_asset_id darf nur ein
-- Asset mit kind='frame' referenzieren, logo_brand_asset_id nur eines mit kind='watermark' --
-- eine UI-Auswahl allein ist dafuer keine Sicherheitsgrenze (siehe plans/013, "Ergaenzungen zum
-- Datenmodell beim Bauen", derselbe Fehler dort bereits einmal gefunden und nachgebessert).
alter table public.brand_assets
  add constraint brand_assets_organization_id_id_kind_key unique (organization_id, id, kind);

create table public.image_style_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Gleiche Besitzebene wie brand_assets: beide null = vereinsweit, department_id gesetzt =
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

  -- Generierte Spalten statt eines literalen Werts im Fremdschluessel unten: Postgres verlangt,
  -- dass beide Seiten eines zusammengesetzten Fremdschluessels echte Spalten sind.
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

create index image_style_presets_scope_idx on public.image_style_presets(organization_id, department_id, team_id, is_active);

alter table public.image_style_presets enable row level security;
alter table public.image_style_presets force row level security;

-- Dieselbe Sichtbarkeit wie brand_assets_select (2026080702): ein Preset ist nur fuer Mitglieder
-- seiner eigenen Ebene (oder mit Verwaltungsaufsicht von oben) sichtbar, nie fuer eine
-- Schwesterabteilung/-mannschaft. Vereinsweite Presets (beide Spalten null) sind fuer jedes
-- Vereinsmitglied sichtbar.
create policy image_style_presets_select on public.image_style_presets for select to authenticated using (
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

-- Schreiben verlangt brand.manage auf genau der Ebene des Presets selbst -- dieselbe Berechtigung
-- wie Marke, keine neue (plans/045, "Datenmodell"). has_department_permission/has_team_permission
-- kaskadieren bereits nach oben (eine Vereinsadminrolle deckt jede Abteilung/Mannschaft ab), daher
-- reicht ein einzelner Zweig je Ebene.
create policy image_style_presets_insert on public.image_style_presets for insert to authenticated with check (
  created_by = auth.uid()
  and (
    (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
    or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
    or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
  )
  and (frame_brand_asset_id is null or authz.brand_asset_is_selectable(frame_brand_asset_id, organization_id, department_id, team_id))
  and (logo_brand_asset_id is null or authz.brand_asset_is_selectable(logo_brand_asset_id, organization_id, department_id, team_id))
);
create policy image_style_presets_update on public.image_style_presets for update to authenticated using (
  (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
  or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
) with check (
  (
    (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
    or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
    or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
  )
  and (frame_brand_asset_id is null or authz.brand_asset_is_selectable(frame_brand_asset_id, organization_id, department_id, team_id))
  and (logo_brand_asset_id is null or authz.brand_asset_is_selectable(logo_brand_asset_id, organization_id, department_id, team_id))
);
create policy image_style_presets_delete on public.image_style_presets for delete to authenticated using (
  (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
  or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
);

-- RLS allein reicht nicht ohne die table-level GRANTs (siehe brand_assets/channel_scopes als
-- Vorbild in denselben Migrationen).
grant select, insert, update, delete on public.image_style_presets to authenticated;
grant all privileges on public.image_style_presets to service_role;

create trigger set_image_style_presets_updated_at before update on public.image_style_presets for each row execute function public.set_updated_at();

commit;
