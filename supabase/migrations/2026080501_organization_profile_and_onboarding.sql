begin;

create table public.organization_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text,
  legal_form text check (legal_form in ('e_v', 'gmbh', 'gugmbh', 'ggmbh', 'nicht_eingetragen', 'sonstige')),
  register_court text,
  register_number text,
  street text,
  house_number text,
  postal_code text,
  city text,
  country_code text not null default 'DE' check (country_code ~ '^[A-Z]{2}$'),
  contact_email text check (contact_email = lower(contact_email)),
  contact_phone text,
  website_url text,
  founded_year integer check (founded_year between 1800 and 2100),
  -- Verantwortliche Person fuer veroeffentlichte Inhalte. Pflicht, bevor ein Kanal
  -- verbunden werden darf (Paket 012, Begruendung in 020). Muss Mitglied *dieses*
  -- Vereins sein -- durchgesetzt per Trigger, siehe unten, nicht per zusammengesetztem
  -- Fremdschluessel, weil organization_memberships keinen Unique-Key ueber
  -- (organization_id, user_id) allein besitzt (nur ueber (organization_id, user_id, role)).
  responsible_person_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_onboarding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  completed_steps text[] not null default '{}',
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ohne diese Pruefung ist eine vereinsfremde Person als Verantwortliche eintragbar --
-- das ist ein Cross-Tenant-Verweis.
create or replace function public.assert_responsible_person_is_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.responsible_person_profile_id is not null and not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.responsible_person_profile_id
      and (m.expires_at is null or m.expires_at > now())
  ) then
    raise exception 'responsible person must be an active member of this organization';
  end if;
  return new;
end;
$$;

create trigger organization_profiles_responsible_member
  before insert or update of responsible_person_profile_id on public.organization_profiles
  for each row execute function public.assert_responsible_person_is_member();

alter table public.organization_brand_profiles
  add column logo_dark_path text,
  add column display_font_key text not null default 'manrope',
  add column body_font_key text not null default 'dm_sans';

-- tone ist ein abgeschlossenes Vokabular (anders als die Font-Keys, die 013 um eigene
-- Uploads erweitert). Ohne diesen Check waere die Zod-Grenze in packages/contracts die
-- einzige Schranke -- wirkungslos, sobald ein zweiter Schreibpfad entsteht.
alter table public.organization_brand_profiles
  add constraint organization_brand_profiles_tone_check
  check (tone in ('nahbar', 'dynamisch', 'sachlich'));

-- Abfragbare Invariante statt Constraint: "mindestens eine Abteilung" laesst sich ueber
-- zwei Tabellen nicht ohne deferrable Trigger als echter Constraint ausdruecken, ohne den
-- Loeschpfad zu verklemmen. create_organization() legt sie atomar mit an; Paket 010 weist
-- das Loeschen der letzten Abteilung ab.
create or replace function public.organization_department_count(target uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.departments where organization_id = target;
$$;

-- Kein authenticated-Grant: die Funktion prueft keine Mitgliedschaft und wuerde sonst
-- jedem eingeloggten Nutzer die Abteilungsanzahl eines beliebigen fremden Vereins per RPC
-- verraten. Sie ist fuer internen/service-role-Gebrauch gedacht (z. B. der Loeschschutz aus
-- Paket 010), nicht fuer direkten Client-Zugriff.
revoke all on function public.organization_department_count(uuid) from public;
grant execute on function public.organization_department_count(uuid) to service_role;

-- Legt Verein, Vereinsprofil, Onboarding-Zustand, Markenprofil, erste Abteilung sowie die
-- Owner-/Admin-Mitgliedschaften des Erstellers atomar an. security definer, weil
-- public.organizations keine INSERT-Policy fuer authenticated besitzt -- das ist Absicht,
-- der einzige Schreibpfad in diese Tabelle fuehrt ueber diese Funktion.
create or replace function public.create_organization(
  organization_name text,
  first_department_name text,
  organization_timezone text default 'Europe/Berlin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := auth.uid();
  new_organization_id uuid;
  new_department_id uuid;
  base_slug text;
  candidate_slug text;
  department_slug text;
  suffix integer := 0;
  owner_count integer;
  -- Als Konstante im Funktionskoerper, nicht als Parameter: ein Parameter waere per
  -- rpc('create_organization', { max_organizations_per_owner: 999 }) aus dem Browser
  -- ueberschreibbar und wuerde die Missbrauchsgrenze genau so aushebeln, wie es der
  -- API-only-Check tat, den diese Funktion eigentlich ersetzen sollte.
  max_organizations_per_owner constant integer := 3;
begin
  if acting_user is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(coalesce(organization_name, ''))) = 0 then
    raise exception 'organization name is required';
  end if;
  if char_length(trim(coalesce(first_department_name, ''))) = 0 then
    raise exception 'first department name is required';
  end if;

  -- Serialisiert konkurrierende Aufrufe desselben Nutzers, damit die Zaehlung unten auch
  -- gegen zwei parallele Anfragen an der Limitgrenze dicht ist. Andere Nutzer sind
  -- unabhaengig und blockieren sich nicht gegenseitig.
  perform pg_advisory_xact_lock(hashtext('create_organization:' || acting_user::text));

  select count(*) into owner_count
  from public.organization_memberships
  where user_id = acting_user and role = 'organization_owner';
  if owner_count >= max_organizations_per_owner then
    raise exception 'organization limit reached for this account';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'verein'; end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.organizations (name, slug, timezone)
      values (trim(organization_name), candidate_slug, organization_timezone)
      returning id into new_organization_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end;
  end loop;

  insert into public.organization_profiles (organization_id) values (new_organization_id);
  insert into public.organization_onboarding (organization_id) values (new_organization_id);
  insert into public.organization_brand_profiles (organization_id) values (new_organization_id);

  department_slug := trim(both '-' from regexp_replace(lower(trim(first_department_name)), '[^a-z0-9]+', '-', 'g'));
  if department_slug = '' then department_slug := 'abteilung'; end if;

  insert into public.departments (organization_id, name, slug)
  values (new_organization_id, trim(first_department_name), department_slug)
  returning id into new_department_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, acting_user, 'organization_owner');

  insert into public.department_memberships (organization_id, department_id, user_id, role)
  values (new_organization_id, new_department_id, acting_user, 'department_admin');

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id)
  values (new_organization_id, acting_user, 'organization.created', 'organization', new_organization_id, gen_random_uuid());

  return new_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

alter table public.organization_profiles enable row level security;
alter table public.organization_profiles force row level security;
alter table public.organization_onboarding enable row level security;
alter table public.organization_onboarding force row level security;

create policy organization_profiles_select on public.organization_profiles for select to authenticated
  using (authz.is_organization_member(organization_id));
create policy organization_profiles_update on public.organization_profiles for update to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'))
  with check (authz.has_organization_permission(organization_id, 'organization.manage'));

create policy organization_onboarding_select on public.organization_onboarding for select to authenticated
  using (authz.is_organization_member(organization_id));
create policy organization_onboarding_update on public.organization_onboarding for update to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'))
  with check (authz.has_organization_permission(organization_id, 'organization.manage'));

create trigger set_organization_profiles_updated_at before update on public.organization_profiles
  for each row execute function public.set_updated_at();
create trigger set_organization_onboarding_updated_at before update on public.organization_onboarding
  for each row execute function public.set_updated_at();

-- Privileges and RLS are both required: a GRANT alone would expose all rows, an RLS policy
-- alone is silently ineffective without the matching GRANT (see 202608020003_api_grants.sql).
grant select, update on public.organization_profiles, public.organization_onboarding to authenticated;
grant all privileges on public.organization_profiles, public.organization_onboarding to service_role;

-- Additive redefinition of 2026080401_auth_bootstrap.sql's authz.membership_scopes(): adds
-- organizationTimezone, which every date display and scheduling computation from this package
-- onward must use instead of the server's own timezone. Everything else is unchanged.
create or replace function authz.membership_scopes()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(org_scope order by org_scope->>'organizationName'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'organizationId', organization.id,
      'organizationName', organization.name,
      'organizationTimezone', organization.timezone,
      'organizationRoles', (
        select coalesce(jsonb_agg(org_membership.role order by org_membership.role), '[]'::jsonb)
        from public.organization_memberships org_membership
        where org_membership.organization_id = organization.id
          and org_membership.user_id = auth.uid()
          and (org_membership.expires_at is null or org_membership.expires_at > now())
      ),
      'departments', (
        select coalesce(jsonb_agg(department_scope order by department_scope->>'name'), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'id', department.id,
            'name', department.name,
            'roles', (
              select coalesce(jsonb_agg(department_membership.role order by department_membership.role), '[]'::jsonb)
              from public.department_memberships department_membership
              where department_membership.department_id = department.id
                and department_membership.user_id = auth.uid()
                and (department_membership.expires_at is null or department_membership.expires_at > now())
            ),
            'teams', (
              select coalesce(jsonb_agg(team_scope order by team_scope->>'name'), '[]'::jsonb)
              from (
                select jsonb_build_object(
                  'id', team.id,
                  'name', team.name,
                  'roles', (
                    select coalesce(jsonb_agg(team_membership.role order by team_membership.role), '[]'::jsonb)
                    from public.team_memberships team_membership
                    where team_membership.team_id = team.id
                      and team_membership.user_id = auth.uid()
                      and (team_membership.expires_at is null or team_membership.expires_at > now())
                  )
                ) as team_scope
                from public.teams team
                where team.department_id = department.id
                  and (authz.is_department_member(department.id) or authz.has_team_membership(team.id))
              ) team_rows
            )
          ) as department_scope
          from public.departments department
          where department.organization_id = organization.id
            and (
              authz.is_department_member(department.id)
              or exists (
                select 1 from public.teams team
                where team.department_id = department.id and authz.has_team_membership(team.id)
              )
            )
        ) department_rows
      )
    ) as org_scope
    from public.organizations organization
    where authz.is_organization_member(organization.id)
      or exists (
        select 1 from public.departments department
        where department.organization_id = organization.id
          and (
            authz.is_department_member(department.id)
            or exists (
              select 1 from public.teams team
              where team.department_id = department.id and authz.has_team_membership(team.id)
            )
          )
      )
  ) org_rows;
$$;

commit;
