begin;

-- Plan 047, PR 1: "Bildkomposition" -- mehrere Fotos zu einem Layout zusammensetzen. Eigenes
-- Datenmodell nach demselben Muster wie image_style_presets (2026081916): gleiche Besitzebene
-- (Verein/Abteilung/Mannschaft), eigene Zeile je Preset statt eines Singleton-Profils je Ebene.
-- Interner Tabellenname "photo_layout_presets" statt "composition_presets"/"collage_presets" --
-- beide Woerter sind bereits fuer etwas anderes vergeben (composition_session_post_media fuer die
-- Textwerkstatt-Sitzung, layoutFamily 'collage' im noch ungebauten Remotion-Video), siehe
-- packages/contracts/src/photoLayout.ts fuer die ausfuehrliche Begruendung.
create type public.photo_layout_kind as enum ('diagonal_split', 'grid_2x2', 'mixed_grid');

create table public.photo_layout_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid, team_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  is_active boolean not null default true,

  kind public.photo_layout_kind not null,
  -- Trennlinie (diagonal_split) bzw. Gutter (grid_2x2/mixed_grid) zwischen den Fotos --
  -- parametrisiert in Vereinsfarbe wie die Bildstil-Rahmenstile (frame_color).
  divider_color text not null default 'primary' check (divider_color ~ '^#[0-9a-fA-F]{6}$' or divider_color in ('primary', 'accent')),
  divider_width_px integer not null default 6 check (divider_width_px >= 0 and divider_width_px <= 100),
  corner_radius_px integer check (corner_radius_px >= 0 and corner_radius_px <= 200),

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),

  unique (organization_id, id),
  check (department_id is not null or team_id is null),

  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade
);

create index photo_layout_presets_scope_idx on public.photo_layout_presets(organization_id, department_id, team_id, is_active);

alter table public.photo_layout_presets enable row level security;
alter table public.photo_layout_presets force row level security;

-- Dieselbe Sichtbarkeit wie image_style_presets_select: ein Preset ist nur fuer Mitglieder seiner
-- eigenen Ebene (oder mit Verwaltungsaufsicht von oben) sichtbar; vereinsweite Presets (beide
-- Spalten null) sind fuer jedes Vereinsmitglied sichtbar.
create policy photo_layout_presets_select on public.photo_layout_presets for select to authenticated using (
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

-- Schreiben verlangt brand.manage auf genau der Ebene des Presets -- dieselbe Berechtigung wie
-- Bildstil (plans/045), keine neue.
create policy photo_layout_presets_insert on public.photo_layout_presets for insert to authenticated with check (
  created_by = auth.uid()
  and (
    (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
    or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
    or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
  )
);
create policy photo_layout_presets_update on public.photo_layout_presets for update to authenticated using (
  (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
  or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
) with check (
  (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
  or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
);
create policy photo_layout_presets_delete on public.photo_layout_presets for delete to authenticated using (
  (team_id is not null and authz.has_team_permission(team_id, 'brand.manage'))
  or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'brand.manage'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'brand.manage'))
);

grant select, insert, update, delete on public.photo_layout_presets to authenticated;
grant all privileges on public.photo_layout_presets to service_role;

create trigger set_photo_layout_presets_updated_at before update on public.photo_layout_presets for each row execute function public.set_updated_at();

-- created_by ist die Herkunftsangabe eines Presets -- dieselbe Sperre wie
-- image_style_presets_created_by_immutable (2026081919): die update-Policy prueft nur brand.manage
-- auf der Ebene, nicht welche Spalten sich aendern.
create or replace function public.enforce_immutable_photo_layout_preset_created_by()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'photo layout preset created_by is immutable';
  end if;
  return new;
end;
$$;
create trigger photo_layout_presets_created_by_immutable before update on public.photo_layout_presets
  for each row execute function public.enforce_immutable_photo_layout_preset_created_by();

commit;
