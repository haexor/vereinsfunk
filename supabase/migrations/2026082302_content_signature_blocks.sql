begin;

-- Paket B, PR 0: frei anlegbare Textbausteine (CTA/Footer/Signatur) je Verein oder Abteilung --
-- kein team_id (nicht angefragt, "Einfachheit zuerst"). Scope-Form wie content_style_profiles,
-- aber mit RLS-Schreibpolicies analog image_style_presets (2026081916): direkt vom Nutzer-Client
-- geschrieben statt ueber die Service Role, Berechtigung ist post.create statt brand.manage --
-- content_style_profiles hat dieselbe Scope-Form und ist ebenfalls mit post.create gegated.
create table public.content_signature_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 1000),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade
);

create index content_signature_blocks_scope_idx on public.content_signature_blocks(organization_id, department_id, is_active);

alter table public.content_signature_blocks enable row level security;
alter table public.content_signature_blocks force row level security;

-- Reine Scope-Mitgliedschaft, wie image_style_presets_select (ohne den dortigen team_id-Zweig):
-- ein vereinsweiter Baustein (department_id null) ist fuer jedes Vereinsmitglied sichtbar, ein
-- Abteilungs-Baustein nur fuer deren Mitglieder oder mit department.manage von oben.
create policy content_signature_blocks_select on public.content_signature_blocks for select to authenticated using (
  authz.is_any_member_of_organization(organization_id)
  and (
    department_id is null
    or authz.participates_in_department(department_id)
    or authz.has_department_permission(department_id, 'department.manage')
  )
);

create policy content_signature_blocks_insert on public.content_signature_blocks for insert to authenticated with check (
  created_by = auth.uid()
  and (
    (department_id is not null and authz.has_department_permission(department_id, 'post.create'))
    or (department_id is null and authz.has_organization_permission(organization_id, 'post.create'))
  )
);
create policy content_signature_blocks_update on public.content_signature_blocks for update to authenticated using (
  (department_id is not null and authz.has_department_permission(department_id, 'post.create'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'post.create'))
) with check (
  (department_id is not null and authz.has_department_permission(department_id, 'post.create'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'post.create'))
);
create policy content_signature_blocks_delete on public.content_signature_blocks for delete to authenticated using (
  (department_id is not null and authz.has_department_permission(department_id, 'post.create'))
  or (department_id is null and authz.has_organization_permission(organization_id, 'post.create'))
);

grant select, insert, update, delete on public.content_signature_blocks to authenticated;
grant all privileges on public.content_signature_blocks to service_role;

create trigger set_content_signature_blocks_updated_at before update on public.content_signature_blocks for each row execute function public.set_updated_at();

-- Scope und Urheberschaft sind direkt in dieser Migration unveraenderlich (anders als
-- image_style_presets, siehe 2026081919): die update-Policy prueft nur post.create auf der Ebene
-- des Bausteins, nicht welche Spalten sich aendern. Ohne diese Sperre koennte eine Person mit
-- post.create einen Baustein auf eine andere Organisation/Abteilung verschieben oder created_by
-- auf eine beliebige andere profiles.id umbiegen.
create or replace function public.enforce_immutable_content_signature_block_created_by()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'content signature block created_by is immutable';
  end if;
  if new.organization_id is distinct from old.organization_id or new.department_id is distinct from old.department_id then
    raise exception 'content signature block scope is immutable';
  end if;
  return new;
end;
$$;
create trigger content_signature_blocks_created_by_immutable before update on public.content_signature_blocks
  for each row execute function public.enforce_immutable_content_signature_block_created_by();

commit;
