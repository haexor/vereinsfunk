begin;

-- Paket 023, Teil 2: policy_settings/policy_scope entstehen hier; Paket 011 erweitert dieselbe
-- Tabelle um seine Freigabe- und Kontingentfelder, legt sie nicht neu an (Plan 023,
-- "Datenmodell"). Zwei boolesche Felder beweisen die Vererbungsmechanik ("untere Ebenen duerfen
-- nur verschaerfen"), bevor Paket 011 die komplexe Freigabelogik darauf aufsetzt.

create type public.policy_scope as enum ('organization', 'department', 'team');

create table public.policy_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid,
  team_id uuid,

  invite_allowed boolean,            -- null = erben
  posts_visible_org_wide boolean,    -- null = erben

  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

create unique index policy_settings_org_unique  on public.policy_settings (organization_id) where scope = 'organization';
create unique index policy_settings_dep_unique  on public.policy_settings (organization_id, department_id) where scope = 'department';
create unique index policy_settings_team_unique on public.policy_settings (organization_id, team_id) where scope = 'team';

alter table public.policy_settings enable row level security;
alter table public.policy_settings force row level security;

-- Nicht sensibel (zwei boolesche Schalter, keine Personendaten) -- vereinsweit lesbar wie
-- Mitgliedernamen (profiles_select_co_member), nicht auf is_department_member beschraenkt: eine
-- Abteilung soll sehen koennen, was der Verein fuer eine ANDERE Abteilung festgelegt hat, um die
-- eigene Vererbung einzuordnen.
create policy policy_settings_select on public.policy_settings for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));

-- Schreibend nur ueber set_policy_setting() (security definer, unten) -- kein Insert/Update-Grant
-- fuer authenticated, gleiches Muster wie departments/create_department(). Der Grant ist
-- spaltenweise, ohne updated_by: die zwei Schalter sind vereinsweit unbedenklich, aber wer
-- zuletzt eine Richtlinie geaendert hat, ist eine administrative Handlung einer konkreten Person
-- und soll nicht an jeden Vereinsangehoerigen ausserhalb der betroffenen Ebene gehen (dasselbe
-- Muster wie beim spaltenblinden Grant auf invitations, siehe 2026080601_structure_and_invitations.sql).
grant select (id, organization_id, scope, department_id, team_id, invite_allowed, posts_visible_org_wide, created_at, updated_at)
  on public.policy_settings to authenticated;
grant all privileges on public.policy_settings to service_role;

create trigger set_policy_settings_updated_at before update on public.policy_settings
  for each row execute function public.set_updated_at();

-- Innerste vorhandene Festlegung gewinnt, aber nur verschaerfend: sobald eine Ebene false setzt,
-- bleibt es false, unabhaengig davon, was eine speziellere Ebene sagt (kein Zurueck-Lockern nach
-- unten). Als AND-Reduktion ueber (organisation, abteilung, team) mit null als neutralem Element
-- (kein Elemente vorhanden = keine zusaetzliche Einschraenkung durch diese Ebene).
create or replace function authz.resolve_policy_flag(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, flag text
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org_row public.policy_settings;
  dept_row public.policy_settings;
  team_row public.policy_settings;
  org_value boolean;
  dept_value boolean;
  team_value boolean;
begin
  if flag not in ('invite_allowed', 'posts_visible_org_wide') then
    raise exception 'unknown_policy_flag: %', flag;
  end if;

  select * into org_row from public.policy_settings
    where organization_id = target_organization_id and scope = 'organization';
  if target_department_id is not null then
    select * into dept_row from public.policy_settings
      where organization_id = target_organization_id and department_id = target_department_id and scope = 'department';
  end if;
  if target_team_id is not null then
    select * into team_row from public.policy_settings
      where organization_id = target_organization_id and team_id = target_team_id and scope = 'team';
  end if;

  org_value := case flag when 'invite_allowed' then org_row.invite_allowed else org_row.posts_visible_org_wide end;
  dept_value := case flag when 'invite_allowed' then dept_row.invite_allowed else dept_row.posts_visible_org_wide end;
  team_value := case flag when 'invite_allowed' then team_row.invite_allowed else team_row.posts_visible_org_wide end;

  return coalesce(org_value, true) and coalesce(dept_value, true) and coalesce(team_value, true);
end;
$$;
revoke all on function authz.resolve_policy_flag(uuid, uuid, uuid, text) from public;
grant execute on function authz.resolve_policy_flag(uuid, uuid, uuid, text) to authenticated, service_role;

-- Race-safe wie create_department()/create_invitation(): select-for-update auf die eine
-- betroffene Zeile, dann gezielt nur die eine Spalte schreiben, die dieser Aufruf meint --
-- ein blindes Upsert beider Spalten wuerde die jeweils andere mit null ueberschreiben.
create or replace function public.set_policy_setting(
  target_organization_id uuid, target_scope text, target_department_id uuid, target_team_id uuid,
  target_flag text, target_value boolean
) returns public.policy_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authorized boolean;
  existing_id uuid;
  result public.policy_settings;
begin
  if target_flag not in ('invite_allowed', 'posts_visible_org_wide') then
    raise exception 'unknown_policy_flag';
  end if;

  if target_scope = 'organization' then
    authorized := authz.has_organization_permission(target_organization_id, 'organization.manage');
  elsif target_scope = 'department' then
    authorized := authz.has_department_permission(target_department_id, 'department.manage');
  elsif target_scope = 'team' then
    authorized := authz.has_team_permission(target_team_id, 'team.manage');
  else
    raise exception 'invalid_scope';
  end if;
  if not authorized then
    raise exception 'insufficient_permission';
  end if;

  select id into existing_id from public.policy_settings
    where organization_id = target_organization_id
      and scope = target_scope::public.policy_scope
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
    for update;

  if existing_id is not null then
    if target_flag = 'invite_allowed' then
      update public.policy_settings set invite_allowed = target_value, updated_by = auth.uid() where id = existing_id;
    else
      update public.policy_settings set posts_visible_org_wide = target_value, updated_by = auth.uid() where id = existing_id;
    end if;
  else
    insert into public.policy_settings (organization_id, scope, department_id, team_id, invite_allowed, posts_visible_org_wide, updated_by)
      values (
        target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id,
        case when target_flag = 'invite_allowed' then target_value end,
        case when target_flag = 'posts_visible_org_wide' then target_value end,
        auth.uid()
      )
      returning id into existing_id;
  end if;

  select * into result from public.policy_settings where id = existing_id;
  return result;
end;
$$;
revoke all on function public.set_policy_setting(uuid, text, uuid, uuid, text, boolean) from public;
grant execute on function public.set_policy_setting(uuid, text, uuid, uuid, text, boolean) to authenticated;

-- Einladungsrecht als Richtlinie (Plan 023, "Umsetzung 1."): invite_allowed wirkt an genau den
-- Stellen, die eine NEUE Mitgliedschaft oder Einladung entstehen lassen -- den drei
-- *_memberships_insert-Policies, invitations_insert und create_invitation(). Bewusst NICHT in
-- authz.has_department_permission/has_team_permission selbst: change_membership_role() (Paket
-- 010) prueft fuer einen Rollenwechsel dieselbe 'member.invite'-Permission wie fuer eine
-- Neuanlage -- eine Aenderung dort haette einer Abteilung mit invite_allowed = false auch das
-- Verwalten bestehender Mitglieder entzogen, was mit "kann niemanden mehr einladen" nicht gemeint
-- ist.
alter policy organization_memberships_insert on public.organization_memberships
  with check (
    authz.has_organization_permission(organization_id, 'member.invite')
    and authz.can_assign_role(organization_id, null, null, role::text)
    and authz.resolve_policy_flag(organization_id, null, null, 'invite_allowed')
  );

alter policy department_memberships_insert on public.department_memberships
  with check (
    authz.has_department_permission(department_id, 'member.invite')
    and authz.can_assign_role(organization_id, department_id, null, role::text)
    and authz.resolve_policy_flag(organization_id, department_id, null, 'invite_allowed')
  );

alter policy team_memberships_insert on public.team_memberships
  with check (
    authz.has_team_permission(team_id, 'member.invite')
    and authz.can_assign_role(organization_id, department_id, team_id, role::text)
    and authz.resolve_policy_flag(organization_id, department_id, team_id, 'invite_allowed')
  );

alter policy invitations_insert on public.invitations
  with check (
    invited_by = auth.uid()
    and (
      (team_id is not null and authz.has_team_permission(team_id, 'member.invite'))
      or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'member.invite'))
      or (department_id is null and authz.has_organization_permission(organization_id, 'member.invite'))
    )
    and authz.can_assign_role(organization_id, department_id, team_id, role)
    and authz.resolve_policy_flag(organization_id, department_id, team_id, 'invite_allowed')
  );

-- create_invitation() umgeht RLS (security definer) und muss die Bedingung deshalb selbst
-- wiederholen, wie es das bereits fuer has_*_permission und can_assign_role tut.
create or replace function public.create_invitation(
  target_organization_id uuid,
  target_department_id uuid,
  target_team_id uuid,
  target_email text,
  target_role text,
  target_token_hash text
) returns public.invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := lower(trim(target_email));
  existing record;
  result public.invitations;
begin
  if target_team_id is not null then
    if not authz.has_team_permission(target_team_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  elsif target_department_id is not null then
    if not authz.has_department_permission(target_department_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  else
    if not authz.has_organization_permission(target_organization_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  end if;
  if not authz.can_assign_role(target_organization_id, target_department_id, target_team_id, target_role) then
    raise exception 'insufficient_permission';
  end if;
  if not authz.resolve_policy_flag(target_organization_id, target_department_id, target_team_id, 'invite_allowed') then
    raise exception 'insufficient_permission';
  end if;

  select * into existing from public.invitations
    where organization_id = target_organization_id
      and email = normalized_email
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
      and accepted_at is null
      and revoked_at is null
    for update;

  if found then
    if existing.expires_at >= now() then
      raise exception 'invitation_already_open';
    end if;
    delete from public.invitations where id = existing.id;
  end if;

  perform authz.register_invitation_send(target_organization_id, target_department_id, target_team_id, normalized_email);

  begin
    insert into public.invitations (organization_id, department_id, team_id, email, role, token_hash, invited_by, expires_at)
      values (target_organization_id, target_department_id, target_team_id, normalized_email, target_role, target_token_hash, auth.uid(), now() + interval '14 days')
      returning * into result;
  exception when unique_violation then
    raise exception 'invitation_already_open';
  end;

  return result;
end;
$$;

-- Sichtbarkeit: Ausnahme "diese Abteilung nicht vereinsweit" (Plan 023, Tabelle "Sichtbarkeit
-- richtet sich nach dem Lebenszyklus"). Nur der vereinsweite Zweig wird eingeschraenkt --
-- Abteilungs- und Teammitglieder sehen ihre eigenen Inhalte unveraendert weiter.
alter policy posts_select on public.posts
  using (
    (
      status in ('published', 'scheduled')
      and authz.is_any_member_of_organization(organization_id)
      and authz.resolve_policy_flag(organization_id, department_id, null, 'posts_visible_org_wide')
    )
    or authz.is_department_member(department_id)
    or (team_id is not null and authz.has_team_membership(team_id))
  );

alter policy post_versions_select on public.post_versions
  using (
    exists (
      select 1 from public.posts post
      where post.id = post_versions.post_id
        and post.organization_id = post_versions.organization_id
        and (
          (
            post.status in ('published', 'scheduled')
            and authz.is_any_member_of_organization(post.organization_id)
            and authz.resolve_policy_flag(post.organization_id, post.department_id, null, 'posts_visible_org_wide')
          )
          or authz.is_department_member(post.department_id)
          or (post.team_id is not null and authz.has_team_membership(post.team_id))
        )
    )
  );

commit;
