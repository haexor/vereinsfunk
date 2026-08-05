begin;

-- 1. Archivieren statt Loeschen fuer Abteilungen/Teams (siehe Plan 010, "Archivieren statt
-- Loeschen"). Echtes Loeschen bleibt moeglich, aber nur wenn keine Beitraege referenzieren
-- (siehe Trigger unten) -- sonst wuerde on delete cascade Teams, Mitgliedschaften,
-- Submissions und Posts unwiederbringlich mitnehmen.
alter table public.departments add column archived_at timestamptz;
alter table public.teams add column archived_at timestamptz;

create or replace function public.prevent_last_department_delete() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.departments where organization_id = old.organization_id and id <> old.id) = 0 then
    raise exception 'the last department of an organization cannot be deleted';
  end if;
  return old;
end; $$;
create trigger departments_protect_last before delete on public.departments
  for each row execute function public.prevent_last_department_delete();

create or replace function public.prevent_department_delete_with_content() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.submissions where department_id = old.id)
    or exists (select 1 from public.posts where department_id = old.id) then
    raise exception 'a department with existing posts cannot be deleted, archive it instead';
  end if;
  return old;
end; $$;
create trigger departments_protect_content before delete on public.departments
  for each row execute function public.prevent_department_delete_with_content();

create or replace function public.prevent_team_delete_with_content() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.submissions where team_id = old.id)
    or exists (select 1 from public.posts where team_id = old.id) then
    raise exception 'a team with existing posts cannot be deleted, archive it instead';
  end if;
  return old;
end; $$;
create trigger teams_protect_content before delete on public.teams
  for each row execute function public.prevent_team_delete_with_content();

-- Der letzte Vereinsinhaber darf nicht verschwinden -- ohne diesen Trigger koennte ein
-- Rollenwechsel (intern: delete+insert, siehe Plan 010 "Mitgliedschaften") einen Verein
-- eigentuemerlos zuruecklassen.
create or replace function public.prevent_last_owner_removal() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if old.role = 'organization_owner' and (
    select count(*) from public.organization_memberships
    where organization_id = old.organization_id and role = 'organization_owner' and id <> old.id
  ) = 0 then
    raise exception 'the last organization_owner cannot be removed';
  end if;
  return old;
end; $$;
create trigger organization_memberships_protect_last_owner before delete on public.organization_memberships
  for each row execute function public.prevent_last_owner_removal();

-- 2. Einladungen: Team-Ebene, Widerruf, Rate-Limit fuer erneutes Senden.
alter table public.invitations add column team_id uuid;
alter table public.invitations add column revoked_at timestamptz;
alter table public.invitations add column last_sent_at timestamptz not null default now();
alter table public.invitations add column send_count integer not null default 1 check (send_count between 1 and 10);

alter table public.invitations drop constraint invitations_organization_id_department_id_fkey;
alter table public.invitations add constraint invitations_department_fk
  foreign key (organization_id, department_id)
  references public.departments(organization_id, id) on delete cascade;
alter table public.invitations add constraint invitations_team_fk
  foreign key (organization_id, department_id, team_id)
  references public.teams(organization_id, department_id, id) on delete cascade;

-- Genau eine Ebene pro Einladung: Verein, Verein+Abteilung, oder Verein+Abteilung+Team.
alter table public.invitations add constraint invitations_scope_check check (
  (department_id is null and team_id is null) or
  (department_id is not null and team_id is null) or
  (department_id is not null and team_id is not null)
);
-- organization_owner ist nicht einladbar, nur uebertragbar (siehe authz.can_assign_role unten).
-- Die Rolle muss zusaetzlich zur Ebene passen, sonst schlaegt der Enum-Cast in
-- accept_invitation() beim Anlegen der Mitgliedschaft fehl.
alter table public.invitations add constraint invitations_role_matches_scope check (
  (team_id is not null and role = any(array['team_manager', 'contributor', 'viewer'])) or
  (team_id is null and department_id is not null and role = any(array['department_admin', 'editor', 'approver', 'contributor', 'viewer'])) or
  (department_id is null and role = any(array['organization_admin', 'social_manager', 'billing_admin', 'organization_viewer']))
);
-- Erzwingt serverseitig, was die Contracts-Schemas clientseitig bereits normalisieren --
-- accept_invitation()'s E-Mail-Abgleich darf sich nicht auf diese Normalisierung verlassen,
-- ohne dass die Spalte sie selbst garantiert.
alter table public.invitations add constraint invitations_email_lowercase check (email = lower(email));

-- Verhindert doppelte offene Einladungen fuer dieselbe Adresse im selben Scope. Wichtiger
-- Nebeneffekt: "erneut senden" ist dadurch ein Update der bestehenden Zeile, kein Insert.
create unique index invitations_open_unique
  on public.invitations (organization_id, email, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where accepted_at is null and revoked_at is null;

create or replace function public.enforce_invitation_resend_rate_limit() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.last_sent_at is distinct from old.last_sent_at and old.last_sent_at > now() - interval '1 hour' then
    raise exception 'an invitation can be resent at most once per hour';
  end if;
  return new;
end; $$;
create trigger invitations_resend_rate_limit before update on public.invitations
  for each row execute function public.enforce_invitation_resend_rate_limit();

-- 3. Verwaltungsrechte je Ebene (siehe packages/authorization fuer das TS-Gegenstueck).
-- organization_owner (immer "true") und organization_admin (immer "permission <> billing.manage")
-- erhalten neue Permissions automatisch, ohne dass ihre case-Zweige unten angepasst werden muessen.
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
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','analytics.view'])
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
        when 'team_manager' then permission = any(array['post.create','post.edit','post.submit','analytics.view','member.invite','member.remove'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.teams team
    where team.id = target_team_id
      and authz.has_department_permission(team.department_id, permission)
  );
$$;
revoke all on function authz.has_team_permission(uuid, text) from public;
grant execute on function authz.has_team_permission(uuid, text) to authenticated, service_role;

-- Schliesst eine beim Mandantentrennung-Review dieses Pakets gefundene Luecke aus Paket 008
-- (2026080401_auth_bootstrap.sql): has_team_permission/has_team_membership/membership_scopes
-- hatten nie ein "revoke all ... from public", der pauschale Revoke in
-- 202608020001_initial_tenant_foundation.sql erfasste nur zu dem Zeitpunkt bereits existierende
-- authz-Funktionen. Praktische Auswirkung war gering (alle drei sind strikt an auth.uid()
-- gebunden), aber PUBLIC/anon konnten sie ausfuehren. Eine bereits angewendete Migration wird
-- nicht nachtraeglich geaendert, deshalb hier statt in 2026080401.
revoke all on function authz.has_team_membership(uuid) from public;
grant execute on function authz.has_team_membership(uuid) to authenticated, service_role;
revoke all on function authz.membership_scopes() from public;
grant execute on function authz.membership_scopes() to authenticated, service_role;

-- Eskalationsschutz: niemand darf eine Rolle vergeben, die maechtiger ist als die eigene,
-- organization_owner ist nie ueber diesen Weg vergebbar (nur Uebertragung, ausserhalb dieses
-- Pakets). Der Rang spiegelt packages/authorization's roleRank -- beide muessen bei einer
-- neuen Rolle gemeinsam angepasst werden, wie bereits bei den Permission-Listen oben ueblich.
create or replace function authz.role_rank(role text) returns integer
language sql immutable set search_path = pg_catalog as $$
  select case role
    when 'organization_owner' then 100
    when 'organization_admin' then 90
    when 'department_admin' then 50
    when 'team_manager' then 40
    when 'social_manager' then 30
    when 'billing_admin' then 30
    when 'editor' then 20
    when 'approver' then 20
    when 'contributor' then 10
    when 'organization_viewer' then 5
    when 'viewer' then 5
    else 0
  end;
$$;

-- Hoechster Rang, den auth.uid() im gegebenen Scope-Pfad haelt -- gemeinsame Grundlage fuer
-- can_assign_role (Vergeben) und can_remove_role (Entfernen/Herabstufen) unten.
create or replace function authz.actor_max_role_rank(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid
) returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select max(rank) from (
      select authz.role_rank(membership.role::text) as rank
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = auth.uid()
        and (membership.expires_at is null or membership.expires_at > now())
      union all
      select authz.role_rank(membership.role::text)
      from public.department_memberships membership
      where target_department_id is not null
        and membership.department_id = target_department_id
        and membership.user_id = auth.uid()
        and (membership.expires_at is null or membership.expires_at > now())
      union all
      select authz.role_rank(membership.role::text)
      from public.team_memberships membership
      where target_team_id is not null
        and membership.team_id = target_team_id
        and membership.user_id = auth.uid()
        and (membership.expires_at is null or membership.expires_at > now())
    ) ranks
  ), 0);
$$;

create or replace function authz.can_assign_role(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, role text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role <> 'organization_owner'
    and authz.role_rank(role) <= authz.actor_max_role_rank(target_organization_id, target_department_id, target_team_id);
$$;

-- Eskalationsschutz gilt auch beim Entfernen/Herabstufen (siehe packages/authorization's
-- canRemoveRole fuer die Begruendung und das TS-Gegenstueck) -- anders als can_assign_role
-- gibt es hier KEINE organization_owner-Ausnahme: ein organization_owner darf einen anderen
-- organization_owner entfernen (Rang 100 <= 100).
create or replace function authz.can_remove_role(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, role text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select authz.role_rank(role) <= authz.actor_max_role_rank(target_organization_id, target_department_id, target_team_id);
$$;

revoke all on function authz.role_rank(text) from public;
revoke all on function authz.actor_max_role_rank(uuid, uuid, uuid) from public;
revoke all on function authz.can_assign_role(uuid, uuid, uuid, text) from public;
revoke all on function authz.can_remove_role(uuid, uuid, uuid, text) from public;
grant execute on function authz.role_rank(text) to authenticated, service_role;
grant execute on function authz.actor_max_role_rank(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function authz.can_assign_role(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function authz.can_remove_role(uuid, uuid, uuid, text) to authenticated, service_role;

-- 4. RLS: Struktur- und Mitgliedschaftsaenderungen liefen bisher ausschliesslich ueber die
-- Service Role (nur SELECT-Policies existierten). Jetzt ergaenzt um UPDATE/DELETE, damit die
-- API mit dem Nutzertoken schreiben kann (RLS bleibt die zweite, unabhaengige Pruefebene neben
-- requirePermission in apps/api). Departments haben keine INSERT-Policy: die Slug-Vergabe mit
-- Kollisions-Retry (siehe create_department() unten) braucht denselben security-definer-Ansatz
-- wie create_organization(), sonst waere die Erzeugung nicht race-safe.
create policy departments_update on public.departments for update to authenticated
  using (authz.has_department_permission(id, 'department.manage'))
  with check (authz.has_department_permission(id, 'department.manage'));
create policy departments_delete on public.departments for delete to authenticated
  using (authz.has_department_permission(id, 'department.manage'));

create policy teams_insert on public.teams for insert to authenticated
  with check (authz.has_department_permission(department_id, 'team.manage'));
create policy teams_update on public.teams for update to authenticated
  using (authz.has_department_permission(department_id, 'team.manage'))
  with check (authz.has_department_permission(department_id, 'team.manage'));
create policy teams_delete on public.teams for delete to authenticated
  using (authz.has_department_permission(department_id, 'team.manage'));

create policy organization_memberships_insert on public.organization_memberships for insert to authenticated
  with check (
    authz.has_organization_permission(organization_id, 'member.invite')
    and authz.can_assign_role(organization_id, null, null, role::text)
  );
create policy organization_memberships_delete on public.organization_memberships for delete to authenticated
  using (
    authz.has_organization_permission(organization_id, 'member.remove')
    and authz.can_remove_role(organization_id, null, null, role::text)
  );

create policy department_memberships_insert on public.department_memberships for insert to authenticated
  with check (
    authz.has_department_permission(department_id, 'member.invite')
    and authz.can_assign_role(organization_id, department_id, null, role::text)
  );
create policy department_memberships_delete on public.department_memberships for delete to authenticated
  using (
    authz.has_department_permission(department_id, 'member.remove')
    and authz.can_remove_role(organization_id, department_id, null, role::text)
  );

create policy team_memberships_insert on public.team_memberships for insert to authenticated
  with check (
    authz.has_team_permission(team_id, 'member.invite')
    and authz.can_assign_role(organization_id, department_id, team_id, role::text)
  );
create policy team_memberships_delete on public.team_memberships for delete to authenticated
  using (
    authz.has_team_permission(team_id, 'member.remove')
    and authz.can_remove_role(organization_id, department_id, team_id, role::text)
  );

-- Team-Einladungen erweitern die bestehende Select-Policy; Insert/Update tragen dieselbe
-- Eskalationspruefung wie die Mitgliedschaftstabellen oben.
alter policy invitations_select_admin on public.invitations
  using (
    authz.has_organization_permission(organization_id, 'member.invite')
    or (department_id is not null and authz.has_department_permission(department_id, 'member.invite'))
    or (team_id is not null and authz.has_team_permission(team_id, 'member.invite'))
  );

create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    invited_by = auth.uid()
    and (
      (team_id is not null and authz.has_team_permission(team_id, 'member.invite'))
      or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'member.invite'))
      or (department_id is null and authz.has_organization_permission(organization_id, 'member.invite'))
    )
    and authz.can_assign_role(organization_id, department_id, team_id, role)
  );
-- Resend (last_sent_at/token_hash/expires_at/send_count) und Revoke (revoked_at) sind beide
-- Updates derselben Zeile -- eine Policy fuer beide, die Rate-Limit-Pruefung bleibt der Trigger.
-- Der can_assign_role-Check gegen die (von resend/revoke nie veraenderte) role-Spalte ist heute
-- durch invitations_role_matches_scope bereits indirekt abgedeckt, wird hier aber explizit
-- wiederholt statt implizit vorausgesetzt -- konsistent mit invitations_insert, falls
-- member.invite jemals an eine Rolle unterhalb der Scope-Decke vergeben wird.
create policy invitations_update on public.invitations for update to authenticated
  using (
    (team_id is not null and authz.has_team_permission(team_id, 'member.invite'))
    or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'member.invite'))
    or (department_id is null and authz.has_organization_permission(organization_id, 'member.invite'))
  )
  with check (
    (
      (team_id is not null and authz.has_team_permission(team_id, 'member.invite'))
      or (team_id is null and department_id is not null and authz.has_department_permission(department_id, 'member.invite'))
      or (department_id is null and authz.has_organization_permission(organization_id, 'member.invite'))
    )
    and authz.can_assign_role(organization_id, department_id, team_id, role)
  );

grant update, delete on table public.departments to authenticated;
grant insert, update, delete on table public.teams to authenticated;
grant insert, delete on table public.organization_memberships, public.department_memberships, public.team_memberships to authenticated;
grant insert, update on table public.invitations to authenticated;

-- profiles_select_self (2026080401_auth_bootstrap.sql) only ever let a user read their own row --
-- the members roster (GET /v1/organizations/:id/members) needs display_name for co-members too,
-- and department_memberships_select/team_memberships_select already restrict which rows a
-- non-admin can even see, so this only ever reveals a name for someone whose membership row is
-- already visible.
create or replace function authz.shares_organization_with(target_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from (
      select organization_id from public.organization_memberships where user_id = auth.uid()
      union select organization_id from public.department_memberships where user_id = auth.uid()
      union select organization_id from public.team_memberships where user_id = auth.uid()
    ) mine
    where mine.organization_id in (
      select organization_id from public.organization_memberships where user_id = target_user_id
      union select organization_id from public.department_memberships where user_id = target_user_id
      union select organization_id from public.team_memberships where user_id = target_user_id
    )
  );
$$;
revoke all on function authz.shares_organization_with(uuid) from public;
grant execute on function authz.shares_organization_with(uuid) to authenticated, service_role;

create policy profiles_select_co_member on public.profiles for select to authenticated
  using (id = auth.uid() or authz.shares_organization_with(id));

-- 4b. Abteilungen anlegen braucht denselben Slug-Kollisions-Retry wie create_organization()
-- (dort nur fuer die erste Abteilung unkritisch, hier fuer jede weitere nicht mehr). Deshalb
-- security definer statt RLS-Insert-Policy; die Berechtigungspruefung uebernimmt die Funktion
-- selbst.
create or replace function public.create_department(target_organization_id uuid, department_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  candidate_slug text;
  suffix integer := 0;
  new_department_id uuid;
begin
  if not authz.has_organization_permission(target_organization_id, 'department.manage') then
    raise exception 'insufficient_permission';
  end if;
  if char_length(trim(coalesce(department_name, ''))) = 0 then
    raise exception 'department name is required';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(department_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'abteilung'; end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.departments (organization_id, name, slug)
      values (target_organization_id, trim(department_name), candidate_slug)
      returning id into new_department_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      -- Schuetzt gegen eine Endlosschleife, falls eine andere Unique-Bedingung auf
      -- public.departments verletzt wird, die der Slug-Suffix nicht beheben kann.
      if suffix > 100 then
        raise exception 'could not generate a unique department slug';
      end if;
      candidate_slug := base_slug || '-' || suffix;
    end;
  end loop;

  return new_department_id;
end;
$$;
revoke all on function public.create_department(uuid, text) from public;
grant execute on function public.create_department(uuid, text) to authenticated, service_role;

-- 4c. "Ist die Adresse bereits Mitglied im Zielscope" (Plan 010, Einladungsflow Schritt 3) laesst
-- sich nur durch auth.users pruefen, das PostgREST nicht exponiert (siehe supabase/config.toml
-- schemas) -- deshalb ein schmaler security-definer-Helfer, analog zu bootstrap_platform_admin().
-- Ohne eigene Berechtigungspruefung waere das ein Cross-Tenant-Mitgliedschafts-Orakel: jeder
-- authentifizierte Nutzer koennte fuer eine beliebige fremde organization_id/E-Mail-Adresse
-- abfragen, ob eine Mitgliedschaft existiert (beim Mandantentrennung-Review dieses Pakets
-- gefunden). Deshalb dieselbe member.invite-Pruefung wie fuer das eigentliche Anlegen der
-- Einladung, bevor ueberhaupt etwas ueber den Zielscope preisgegeben wird.
create or replace function public.email_has_membership(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, target_email text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
  caller_authorized boolean;
begin
  if target_team_id is not null then
    caller_authorized := authz.has_team_permission(target_team_id, 'member.invite');
  elsif target_department_id is not null then
    caller_authorized := authz.has_department_permission(target_department_id, 'member.invite');
  else
    caller_authorized := authz.has_organization_permission(target_organization_id, 'member.invite');
  end if;
  if not caller_authorized then
    raise exception 'insufficient_permission';
  end if;

  select id into target_user_id from auth.users where lower(email) = lower(target_email);
  if target_user_id is null then return false; end if;
  if target_team_id is not null then
    return exists (select 1 from public.team_memberships where team_id = target_team_id and user_id = target_user_id);
  elsif target_department_id is not null then
    return exists (select 1 from public.department_memberships where department_id = target_department_id and user_id = target_user_id);
  else
    return exists (select 1 from public.organization_memberships where organization_id = target_organization_id and user_id = target_user_id);
  end if;
end;
$$;
revoke all on function public.email_has_membership(uuid, uuid, uuid, text) from public;
grant execute on function public.email_has_membership(uuid, uuid, uuid, text) to authenticated, service_role;

-- 5. Einladung annehmen ist keine rollenbasierte Berechtigung, sondern durch den Rohtoken
-- selbst autorisiert -- deshalb security definer statt RLS-Policy, analog zu
-- create_organization()/bootstrap_platform_admin().
create or replace function public.accept_invitation(raw_token text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation record;
  actor_email text;
  actor_profile_id uuid;
begin
  actor_profile_id := auth.uid();
  if actor_profile_id is null then
    raise exception 'accept_invitation requires an authenticated user';
  end if;

  select * into invitation from public.invitations
    where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
    for update;

  if not found
    or invitation.accepted_at is not null
    or invitation.revoked_at is not null
    or invitation.expires_at < now()
  then
    raise exception 'invitation_not_found_or_expired';
  end if;

  select email into actor_email from auth.users where id = actor_profile_id;
  if actor_email is null or lower(actor_email) <> lower(invitation.email) then
    raise exception 'invitation_email_mismatch';
  end if;

  if invitation.team_id is not null then
    insert into public.team_memberships (organization_id, department_id, team_id, user_id, role)
      values (invitation.organization_id, invitation.department_id, invitation.team_id, actor_profile_id, invitation.role::public.team_role)
      on conflict (team_id, user_id, role) do nothing;
    -- Ohne Abteilungsmitgliedschaft greift keine Inhalts-Policy fuer das Team (siehe Plan 010,
    -- Risiken) -- deshalb zusaetzlich eine viewer-Mitgliedschaft in der Abteilung.
    insert into public.department_memberships (organization_id, department_id, user_id, role)
      values (invitation.organization_id, invitation.department_id, actor_profile_id, 'viewer')
      on conflict (department_id, user_id, role) do nothing;
  elsif invitation.department_id is not null then
    insert into public.department_memberships (organization_id, department_id, user_id, role)
      values (invitation.organization_id, invitation.department_id, actor_profile_id, invitation.role::public.department_role)
      on conflict (department_id, user_id, role) do nothing;
  else
    insert into public.organization_memberships (organization_id, user_id, role)
      values (invitation.organization_id, actor_profile_id, invitation.role::public.organization_role)
      on conflict (organization_id, user_id, role) do nothing;
  end if;

  update public.invitations set accepted_at = now() where id = invitation.id;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id)
    values (invitation.organization_id, actor_profile_id, 'invitation.accepted', 'invitations', invitation.id, gen_random_uuid());

  return jsonb_build_object(
    'organizationId', invitation.organization_id,
    'departmentId', invitation.department_id,
    'teamId', invitation.team_id,
    'role', invitation.role
  );
end;
$$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- 6. Adressbezogenes Rate-Limit fuer Einladungen, unabhaengig vom Lebenszyklus einzelner
-- invitations-Zeilen (beim Geheimnisse-Review dieses Pakets als Umgehungsmoeglichkeit erkannt,
-- siehe Plan 010 "Risiken"): send_count/last_sent_at hingen bisher an der jeweiligen Zeile, ein
-- revoke() gefolgt von einem neuen create() setzte beide Zaehler zurueck. Diese Tabelle zaehlt
-- stattdessen pro (organization_id, normalisierte E-Mail, Scope) ueber die gesamte Zeit, auch
-- ueber widerrufene/abgelaufene Einladungen hinweg.
create table public.invitation_send_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  department_id uuid,
  team_id uuid,
  send_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitation_send_counters_key on public.invitation_send_counters (
  organization_id, email,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
alter table public.invitation_send_counters enable row level security;
-- Ausschliesslich ueber die security-definer-Funktionen unten erreichbar, analog zu
-- invitation_send_counters selbst: kein Grant fuer authenticated/anon.
revoke all on table public.invitation_send_counters from authenticated, anon;

create or replace function authz.register_invitation_send(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, target_email text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := lower(trim(target_email));
  counter record;
begin
  select * into counter from public.invitation_send_counters
    where organization_id = target_organization_id
      and email = normalized_email
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
    for update;

  if found then
    if counter.last_sent_at is not null and counter.last_sent_at > now() - interval '1 hour' then
      raise exception 'an invitation can be resent at most once per hour';
    end if;
    if counter.send_count >= 10 then
      raise exception 'resend_limit_reached';
    end if;
    update public.invitation_send_counters
      set send_count = send_count + 1, last_sent_at = now()
      where organization_id = target_organization_id
        and email = normalized_email
        and department_id is not distinct from target_department_id
        and team_id is not distinct from target_team_id;
  else
    insert into public.invitation_send_counters (organization_id, email, department_id, team_id, send_count, last_sent_at)
      values (target_organization_id, normalized_email, target_department_id, target_team_id, 1, now());
  end if;
end;
$$;
revoke all on function authz.register_invitation_send(uuid, uuid, uuid, text) from public;
grant execute on function authz.register_invitation_send(uuid, uuid, uuid, text) to authenticated, service_role;

-- 7. Einladung anlegen als security-definer-RPC statt eines direkten Inserts ueber RLS: eine
-- abgelaufene, aber noch offene Einladung erfuellt weiterhin invitations_open_unique und
-- blockiert damit eine neue Einladung an dieselbe Adresse bis zum manuellen Widerruf (beim
-- Vertraege-Review dieses Pakets gefunden, siehe Plan 010 "Weitere Aktionen"). Diese Funktion
-- sperrt eine passende offene Zeile per for update, verwirft sie falls abgelaufen und legt die
-- neue Einladung in derselben Transaktion an -- inklusive Rate-Limit-Pruefung. Fuehrt dieselben
-- Berechtigungs-/Eskalationschecks wie invitations_insert selbst durch, da RLS hier umgangen wird.
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
revoke all on function public.create_invitation(uuid, uuid, uuid, text, text, text) from public;
grant execute on function public.create_invitation(uuid, uuid, uuid, text, text, text) to authenticated;

-- Erneutes Senden als security-definer-RPC aus demselben Grund wie create_invitation: das
-- adressbezogene Rate-Limit muss in derselben Transaktion wie das Update selbst geprueft und
-- erhoeht werden. Der bestehende Zeilen-Trigger enforce_invitation_resend_rate_limit bleibt
-- als zusaetzliche, unabhaengige Absicherung bestehen (Trigger feuern unabhaengig davon, ueber
-- welchen Weg geschrieben wird).
create or replace function public.resend_invitation(target_invitation_id uuid, target_token_hash text) returns public.invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation record;
  result public.invitations;
begin
  select * into invitation from public.invitations where id = target_invitation_id for update;
  if not found or invitation.accepted_at is not null or invitation.revoked_at is not null then
    raise exception 'not_found';
  end if;

  if invitation.team_id is not null then
    if not authz.has_team_permission(invitation.team_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  elsif invitation.department_id is not null then
    if not authz.has_department_permission(invitation.department_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  else
    if not authz.has_organization_permission(invitation.organization_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  end if;

  perform authz.register_invitation_send(invitation.organization_id, invitation.department_id, invitation.team_id, invitation.email);

  update public.invitations
    set token_hash = target_token_hash,
        expires_at = now() + interval '14 days',
        last_sent_at = now(),
        send_count = least(send_count + 1, 10)
    where id = target_invitation_id
    returning * into result;

  return result;
end;
$$;
revoke all on function public.resend_invitation(uuid, text) from public;
grant execute on function public.resend_invitation(uuid, text) to authenticated;

-- 8. Rollenwechsel als security-definer-RPC statt Loeschen+Anlegen ueber zwei getrennte
-- PostgREST-Aufrufe (beim Vertraege-Review dieses Pakets als nicht-atomar erkannt): schlaegt der
-- Insert fehl, war die alte Mitgliedschaft bereits geloescht (Rollenverlust ohne Rollback);
-- filtert RLS das Delete still (0 Zeilen getroffen), laeuft der Insert trotzdem und die Person
-- haelt danach zwei Mitgliedschaften. Beide Schritte laufen hier in derselben Transaktion.
-- Wiederholt denselben has_*_permission- und can_remove_role/can_assign_role-Check wie die
-- *_memberships_insert/_delete-RLS-Policies, da diese Funktion RLS umgeht.
create or replace function public.change_membership_role(
  target_scope text, target_membership_id uuid, target_role text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_organization_id uuid;
  member_department_id uuid;
  member_team_id uuid;
  member_user_id uuid;
  member_current_role text;
  new_membership_id uuid;
  new_expires_at timestamptz;
begin
  if target_scope = 'organization' then
    select organization_id, user_id, role::text into member_organization_id, member_user_id, member_current_role
      from public.organization_memberships where id = target_membership_id for update;
  elsif target_scope = 'department' then
    select organization_id, department_id, user_id, role::text into member_organization_id, member_department_id, member_user_id, member_current_role
      from public.department_memberships where id = target_membership_id for update;
  elsif target_scope = 'team' then
    select organization_id, department_id, team_id, user_id, role::text into member_organization_id, member_department_id, member_team_id, member_user_id, member_current_role
      from public.team_memberships where id = target_membership_id for update;
  else
    raise exception 'invalid_scope';
  end if;

  if not found then
    raise exception 'not_found';
  end if;

  if target_scope = 'organization' then
    if not authz.has_organization_permission(member_organization_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  elsif target_scope = 'department' then
    if not authz.has_department_permission(member_department_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  else
    if not authz.has_team_permission(member_team_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  end if;
  if not authz.can_remove_role(member_organization_id, member_department_id, member_team_id, member_current_role) then
    raise exception 'insufficient_permission';
  end if;
  if not authz.can_assign_role(member_organization_id, member_department_id, member_team_id, target_role) then
    raise exception 'insufficient_permission';
  end if;

  if target_scope = 'organization' then
    delete from public.organization_memberships where id = target_membership_id;
    insert into public.organization_memberships (organization_id, user_id, role)
      values (member_organization_id, member_user_id, target_role::public.organization_role)
      returning id, expires_at into new_membership_id, new_expires_at;
  elsif target_scope = 'department' then
    delete from public.department_memberships where id = target_membership_id;
    insert into public.department_memberships (organization_id, department_id, user_id, role)
      values (member_organization_id, member_department_id, member_user_id, target_role::public.department_role)
      returning id, expires_at into new_membership_id, new_expires_at;
  else
    delete from public.team_memberships where id = target_membership_id;
    insert into public.team_memberships (organization_id, department_id, team_id, user_id, role)
      values (member_organization_id, member_department_id, member_team_id, member_user_id, target_role::public.team_role)
      returning id, expires_at into new_membership_id, new_expires_at;
  end if;

  return jsonb_build_object(
    'membershipId', new_membership_id,
    'userId', member_user_id,
    'role', target_role,
    'expiresAt', new_expires_at,
    'fromRole', member_current_role
  );
end;
$$;
revoke all on function public.change_membership_role(text, uuid, text) from public;
grant execute on function public.change_membership_role(text, uuid, text) to authenticated;

commit;
