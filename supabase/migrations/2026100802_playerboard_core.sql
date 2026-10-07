-- Paket 052, PR 1: PlayerBoard als Modul 'playerboard' -- Kader, Kategorien, Trainings, Punkte,
-- Trainingsfotos mit Einwilligungspruefung, vererbbare Einstellungen und die oeffentliche
-- Mannschaftsseite. Siehe plans/052-playerboard-modul.md.
--
-- Jede Tabelle traegt organization_id und zusammengesetzte Fremdschluessel. Jede Lese- und
-- Schreib-Policy verlangt authz.module_enabled(..., 'playerboard') UND die passende Permission:
-- anders als bei den Social-Media-Tabellen (Paket 051, "Keine RLS-Nachruestung") kostet das hier
-- nichts, weil das Modul neu ist.

-- 1. Rechte ---------------------------------------------------------------------------------------
-- training.view, training.manage, playerboard.manage (packages/authorization, permissionModule ->
-- 'playerboard'). organization_owner/organization_admin erhalten sie automatisch ueber
-- has_organization_permission (owner: alles, admin: alles ausser billing.manage).

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
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','directory.read','integration.manage','fixture.manage','event.manage','consent.manage','training.view','training.manage','playerboard.manage'])
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
        when 'team_manager' then permission = any(array['post.create','post.edit','post.submit','analytics.view','member.invite','member.remove','brand.manage','directory.read','training.view','training.manage','playerboard.manage'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
        when 'player' then permission = 'training.view'
      end
  ) or exists (
    select 1 from public.teams team
    where team.id = target_team_id
      and authz.has_department_permission(team.department_id, permission)
  );
$$;

-- Rang 5 wie viewer: ein Spieler vergibt nie eine Rolle (kein member.invite), der Rang schuetzt
-- nur davor, dass er ueber eine kuenftige Luecke maechtigere Rollen vergeben koennte.
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
    when 'player' then 5
    else 0
  end;
$$;

alter table public.invitations drop constraint invitations_role_matches_scope;
alter table public.invitations add constraint invitations_role_matches_scope check (
  (team_id is not null and role = any(array['team_manager', 'contributor', 'viewer', 'player'])) or
  (team_id is null and department_id is not null and role = any(array['department_admin', 'editor', 'approver', 'contributor', 'viewer'])) or
  (department_id is null and role = any(array['organization_admin', 'social_manager', 'billing_admin', 'organization_viewer']))
);

-- 2. Tabellen -------------------------------------------------------------------------------------

-- Vererbbare Einstellungen je Ebene (Muster policy_settings, Paket 023). null = erben.
create table public.playerboard_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid,
  team_id uuid,
  season_start date,
  stats_visibility text check (stats_visibility in ('team', 'department', 'organization')),
  overridable_fields text[] not null default '{}'
    check (overridable_fields <@ array['season_start', 'stats_visibility']),
  team_categories_allowed boolean,
  public_sharing_allowed boolean,
  -- nur scope = 'team':
  public_points_enabled boolean,
  public_veo_stats_enabled boolean,
  public_photos_enabled boolean,
  public_slug text check (public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(public_slug) <= 80),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department' and department_id is not null and team_id is null)
      or (scope = 'team' and department_id is not null and team_id is not null)),
  check (scope = 'team' or (public_points_enabled is null and public_veo_stats_enabled is null
                            and public_photos_enabled is null and public_slug is null)),
  unique (organization_id, id),
  unique (organization_id, public_slug),
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade
);
create unique index playerboard_settings_org_unique on public.playerboard_settings (organization_id) where scope = 'organization';
create unique index playerboard_settings_dep_unique on public.playerboard_settings (organization_id, department_id) where scope = 'department';
create unique index playerboard_settings_team_unique on public.playerboard_settings (organization_id, team_id) where scope = 'team';

-- Kader: verweist zwingend auf eine Verzeichnisperson (Name, Geburtsjahr, Minderjaehrigkeit,
-- E-Mail, Konto bleiben dort). Loeschen der Verzeichnisperson (Betroffenenanfrage) nimmt Kader,
-- Punkte und Fotozuordnungen mit.
create table public.playerboard_players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid not null,
  directory_person_id uuid not null,
  jersey_number integer check (jersey_number between 0 and 99),
  position text check (char_length(position) <= 40),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (team_id, directory_person_id),
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, directory_person_id) references public.directory_people(organization_id, id) on delete cascade
);
create index playerboard_players_team_idx on public.playerboard_players (organization_id, team_id);
create index playerboard_players_person_idx on public.playerboard_players (organization_id, directory_person_id);

create table public.playerboard_point_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid,
  team_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  active boolean not null default true,
  sort_order integer not null default 0,
  value_min integer not null default 0,
  value_max integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value_min < value_max),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department' and department_id is not null and team_id is null)
      or (scope = 'team' and department_id is not null and team_id is not null)),
  unique (organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade
);
create index playerboard_point_categories_scope_idx on public.playerboard_point_categories (organization_id, scope, department_id, team_id);

create table public.playerboard_trainings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid not null,
  training_date date not null,
  title text check (char_length(title) <= 120),
  status text not null default 'draft' check (status in ('draft', 'saved')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade
);
create index playerboard_trainings_team_date_idx on public.playerboard_trainings (organization_id, team_id, training_date desc);

-- Notizen getrennt von den Trainings: Wer die Werte einer Mannschaft nur ueber stats_visibility
-- sieht, darf Datum, Titel und Status eines Trainings lesen, die Notiz aber nicht. RLS schuetzt
-- Zeilen, keine Spalten -- eine eigene Tabelle mit strengerer Policy ist die einfachste sichere
-- Trennung (statt spaltenweiser Grants, an denen jedes "select *" scheitert).
create table public.playerboard_training_notes (
  organization_id uuid not null,
  training_id uuid primary key,
  note text not null check (char_length(note) <= 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, training_id) references public.playerboard_trainings(organization_id, id) on delete cascade
);

create table public.playerboard_point_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  training_id uuid not null,
  player_id uuid not null,
  category_id uuid not null,
  value integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_id, player_id, category_id),
  foreign key (organization_id, training_id) references public.playerboard_trainings(organization_id, id) on delete cascade,
  foreign key (organization_id, player_id) references public.playerboard_players(organization_id, id) on delete cascade,
  -- Eine Kategorie mit Punkten wird deaktiviert, nicht geloescht (vorhandene Punkte zaehlen weiter).
  foreign key (organization_id, category_id) references public.playerboard_point_categories(organization_id, id) on delete restrict
);
create index playerboard_point_entries_player_idx on public.playerboard_point_entries (organization_id, player_id);
create index playerboard_point_entries_category_idx on public.playerboard_point_entries (organization_id, category_id);

create table public.playerboard_training_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  training_id uuid not null,
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  public boolean not null default false,
  consent_review_status text not null default 'pending'
    check (consent_review_status in ('pending', 'approved', 'blocked')),
  all_recognizable_people_listed boolean not null default false,
  consent_reviewed_by uuid references public.profiles(id) on delete set null,
  consent_reviewed_at timestamptz,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  -- Oeffentlich nur nach erfolgreicher Einzelbildpruefung (Abschnitt 6 unten).
  check (not public or (consent_review_status = 'approved' and all_recognizable_people_listed)),
  unique (organization_id, id),
  foreign key (organization_id, training_id) references public.playerboard_trainings(organization_id, id) on delete cascade
);
create index playerboard_training_photos_training_idx on public.playerboard_training_photos (organization_id, training_id);

create table public.playerboard_training_photo_people (
  organization_id uuid not null,
  photo_id uuid not null,
  directory_person_id uuid not null,
  consent_record_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, directory_person_id),
  foreign key (organization_id, photo_id) references public.playerboard_training_photos(organization_id, id) on delete cascade,
  foreign key (organization_id, directory_person_id) references public.directory_people(organization_id, id) on delete cascade,
  foreign key (organization_id, consent_record_id) references public.consent_records(organization_id, id) on delete restrict
);
create index playerboard_training_photo_people_consent_idx on public.playerboard_training_photo_people (organization_id, consent_record_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'playerboard_settings', 'playerboard_players', 'playerboard_point_categories', 'playerboard_trainings',
    'playerboard_training_notes', 'playerboard_point_entries', 'playerboard_training_photos',
    'playerboard_training_photo_people'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
  foreach table_name in array array[
    'playerboard_settings', 'playerboard_players', 'playerboard_point_categories', 'playerboard_trainings',
    'playerboard_training_notes', 'playerboard_point_entries'
  ] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

-- 3. Vererbung der Einstellungen ------------------------------------------------------------------
-- Zwei Regelarten (Plan, "Vererbung"):
--   * ersetzbar (season_start, stats_visibility): ein gesetzter Wert bindet alle Ebenen darunter,
--     es sei denn, die Ebene gibt das Feld ueber overridable_fields frei. Eine Freigabe reicht nur
--     eine Ebene tief, und nur eine selbst freie Ebene kann weiter freigeben.
--   * nur verschaerfen (team_categories_allowed, public_sharing_allowed): false auf irgendeiner
--     Ebene des Pfads gewinnt, Standard true.
-- Ergebnis als text, die Aufrufer casten. Interne Aufloesung ohne Mitgliedschaftspruefung, nur fuer
-- die security-definer-Funktionen dieses Moduls; nach aussen geht authz.playerboard_setting unten.
create or replace function authz.resolve_playerboard_setting(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, field text
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  level_row public.playerboard_settings;
  levels public.policy_scope[] := array['organization'::public.policy_scope];
  level public.policy_scope;
  current_value text;
  level_value text;
  level_open boolean := true;
  tightened boolean := false;
begin
  if field not in ('season_start', 'stats_visibility', 'team_categories_allowed', 'public_sharing_allowed') then
    raise exception 'unknown_playerboard_setting: %', field;
  end if;
  if target_department_id is not null then levels := levels || 'department'::public.policy_scope; end if;
  if target_team_id is not null then levels := levels || 'team'::public.policy_scope; end if;

  foreach level in array levels loop
    select * into level_row from public.playerboard_settings s
      where s.organization_id = target_organization_id
        and s.scope = level
        and (level <> 'department' or s.department_id = target_department_id)
        and (level <> 'team' or s.team_id = target_team_id);
    if not found then
      -- Ohne eigene Zeile gibt die Ebene nichts frei: ein bereits gesetzter Wert bleibt bindend.
      if current_value is not null then level_open := false; end if;
      continue;
    end if;

    if field in ('team_categories_allowed', 'public_sharing_allowed') then
      level_value := case field
        when 'team_categories_allowed' then level_row.team_categories_allowed::text
        else level_row.public_sharing_allowed::text
      end;
      if level_value = 'false' then tightened := true; end if;
      continue;
    end if;

    level_value := case field
      when 'season_start' then level_row.season_start::text
      else level_row.stats_visibility
    end;
    if level_open and level_value is not null then
      current_value := level_value;
    end if;
    -- Darunter frei nur, solange noch nichts gesetzt ist, oder wenn diese (selbst freie) Ebene das
    -- Feld ausdruecklich freigibt.
    level_open := current_value is null or (level_open and field = any(level_row.overridable_fields));
  end loop;

  if field in ('team_categories_allowed', 'public_sharing_allowed') then
    return (not tightened)::text;
  end if;
  if field = 'stats_visibility' then
    return coalesce(current_value, 'team');
  end if;
  return current_value;
end;
$$;
revoke all on function authz.resolve_playerboard_setting(uuid, uuid, uuid, text) from public;

-- Fuer RLS-Policies und die API. Die Funktion liegt im per PostgREST erreichbaren Schema authz:
-- ein Nichtmitglied bekommt null statt der Einstellungen eines fremden Vereins (wie
-- authz.module_enabled).
create or replace function authz.playerboard_setting(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, field text
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (coalesce(auth.role(), '') = 'service_role' or authz.is_any_member_of_organization(target_organization_id))
      and authz.module_enabled(target_organization_id, target_department_id, target_team_id, 'playerboard')
      then authz.resolve_playerboard_setting(target_organization_id, target_department_id, target_team_id, field)
  end;
$$;
revoke all on function authz.playerboard_setting(uuid, uuid, uuid, text) from public;
grant execute on function authz.playerboard_setting(uuid, uuid, uuid, text) to authenticated, service_role;

-- 4. Sichtbarkeit ---------------------------------------------------------------------------------

-- Mitglied irgendeiner Ebene INNERHALB der Abteilung (Abteilungs- oder Mannschaftsmitgliedschaft),
-- ausdruecklich ohne reine Vereinsrollen -- die sind erst bei stats_visibility = 'organization' dran.
create or replace function authz.is_member_within_department(target_department_id uuid) returns boolean
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
     where membership.department_id = target_department_id
       and membership.user_id = auth.uid()
       and (membership.expires_at is null or membership.expires_at > now())
  );
$$;
revoke all on function authz.is_member_within_department(uuid) from public;
grant execute on function authz.is_member_within_department(uuid) to authenticated, service_role;

-- Kennzahlen einer Mannschaft (gespeicherte Trainings, Punkte, Rangliste, Kader mit Namen, ab 053
-- Veo-Werte): training.view auf die Mannschaft oder die wirksame stats_visibility.
create or replace function authz.can_view_playerboard_stats(target_team_id uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teams team
     where team.id = target_team_id
       and authz.module_enabled(team.organization_id, team.department_id, team.id, 'playerboard')
       and (
         authz.has_team_permission(team.id, 'training.view')
         or case authz.resolve_playerboard_setting(team.organization_id, team.department_id, team.id, 'stats_visibility')
              when 'department' then authz.is_member_within_department(team.department_id)
              when 'organization' then authz.is_any_member_of_organization(team.organization_id)
              else false
            end
       )
  );
$$;
revoke all on function authz.can_view_playerboard_stats(uuid) from public;
grant execute on function authz.can_view_playerboard_stats(uuid) to authenticated, service_role;

-- Mannschaftsinterne Inhalte (Entwuerfe ausgenommen: Notizen, Fotos) und Schreibrechte.
create or replace function authz.has_playerboard_team_permission(target_team_id uuid, permission text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teams team
     where team.id = target_team_id
       and authz.module_enabled(team.organization_id, team.department_id, team.id, 'playerboard')
       and authz.has_team_permission(team.id, permission)
  );
$$;
revoke all on function authz.has_playerboard_team_permission(uuid, text) from public;
grant execute on function authz.has_playerboard_team_permission(uuid, text) to authenticated, service_role;

-- playerboard.manage auf genau der Ebene einer Einstellungs- oder Kategorienzeile.
create or replace function authz.can_manage_playerboard_level(
  target_organization_id uuid, target_scope public.policy_scope, target_department_id uuid, target_team_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select authz.module_enabled(target_organization_id, target_department_id, target_team_id, 'playerboard')
    and case target_scope
      when 'organization' then authz.has_organization_permission(target_organization_id, 'playerboard.manage')
      when 'department' then authz.has_department_permission(target_department_id, 'playerboard.manage')
      else authz.has_team_permission(target_team_id, 'playerboard.manage')
    end;
$$;
revoke all on function authz.can_manage_playerboard_level(uuid, public.policy_scope, uuid, uuid) from public;
grant execute on function authz.can_manage_playerboard_level(uuid, public.policy_scope, uuid, uuid) to authenticated, service_role;

-- 5. Kategorien -----------------------------------------------------------------------------------
-- Wirksam fuer eine Mannschaft: aktive Kategorien von Verein ∪ Abteilung ∪ Mannschaft (letztere nur,
-- wenn team_categories_allowed). Vorgegebene Kategorien kann eine Mannschaft nicht ausblenden.
create or replace function authz.playerboard_effective_categories(target_team_id uuid)
returns setof public.playerboard_point_categories
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select category.*
    from public.teams team
    join public.playerboard_point_categories category on category.organization_id = team.organization_id
   where team.id = target_team_id
     and category.active
     and (
       category.scope = 'organization'
       or (category.scope = 'department' and category.department_id = team.department_id)
       or (category.scope = 'team' and category.team_id = team.id
           and authz.resolve_playerboard_setting(team.organization_id, team.department_id, team.id, 'team_categories_allowed') = 'true')
     )
   order by case category.scope when 'organization' then 0 when 'department' then 1 else 2 end, category.sort_order, category.name;
$$;
revoke all on function authz.playerboard_effective_categories(uuid) from public;

-- Fuer die Oberflaeche: nur wer die Kennzahlen sieht oder Trainings pflegt.
create or replace function public.playerboard_effective_categories(target_team_id uuid)
returns setof public.playerboard_point_categories
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select effective.*
    from authz.playerboard_effective_categories(target_team_id) effective
   where coalesce(auth.role(), '') = 'service_role'
      or authz.can_view_playerboard_stats(target_team_id)
      or authz.has_playerboard_team_permission(target_team_id, 'training.manage');
$$;
revoke all on function public.playerboard_effective_categories(uuid) from public;
grant execute on function public.playerboard_effective_categories(uuid) to authenticated, service_role;

-- 6. Konsistenz-Trigger ---------------------------------------------------------------------------

-- Kein Training in der Zukunft (Zeitzone des Vereins), wie in playerboard. security definer: ein
-- Trainer ohne Vereinsrolle sieht die organizations-Zeile per RLS nicht, die Zeitzone waere null und
-- die Pruefung fiele still aus (beim pgTAP-Test dieses Pakets gefunden).
create or replace function public.playerboard_training_date_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  local_today date;
begin
  select (now() at time zone organization.timezone)::date into local_today
    from public.organizations organization where organization.id = new.organization_id;
  if new.training_date > local_today then
    raise exception 'training_date_in_future';
  end if;
  return new;
end;
$$;
create trigger playerboard_trainings_date_guard
  before insert or update of training_date on public.playerboard_trainings
  for each row execute function public.playerboard_training_date_guard();

create or replace function public.playerboard_training_identity_immutable_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.department_id is distinct from old.department_id
     or new.team_id is distinct from old.team_id then
    raise exception 'playerboard_training_identity_immutable';
  end if;
  return new;
end;
$$;
create trigger playerboard_trainings_immutable_guard
  before update on public.playerboard_trainings
  for each row execute function public.playerboard_training_identity_immutable_guard();

-- Punkte: Spieler gehoert zur Mannschaft des Trainings, Kategorie ist fuer diese Mannschaft wirksam
-- (bei einer bestehenden Zeile mit unveraenderter Kategorie genuegt, dass sie zur Mannschaft
-- gehoert -- eine spaeter deaktivierte Kategorie bleibt korrigierbar), value im Wertebereich.
create or replace function public.playerboard_point_entry_guard() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  training_team uuid;
  training_department uuid;
  player_team uuid;
  category public.playerboard_point_categories;
begin
  select team_id, department_id into training_team, training_department
    from public.playerboard_trainings where organization_id = new.organization_id and id = new.training_id;
  select team_id into player_team
    from public.playerboard_players where organization_id = new.organization_id and id = new.player_id;
  if player_team is distinct from training_team then
    raise exception 'player_not_in_training_team';
  end if;

  select * into category from public.playerboard_point_categories
   where organization_id = new.organization_id and id = new.category_id;
  if not (
    category.scope = 'organization'
    or (category.scope = 'department' and category.department_id = training_department)
    or (category.scope = 'team' and category.team_id = training_team)
  ) then
    raise exception 'category_not_effective';
  end if;
  if (tg_op = 'INSERT' or new.category_id <> old.category_id) and not exists (
    select 1 from authz.playerboard_effective_categories(training_team) effective where effective.id = new.category_id
  ) then
    raise exception 'category_not_effective';
  end if;
  if new.value < category.value_min or new.value > category.value_max then
    raise exception 'point_value_out_of_range';
  end if;
  return new;
end;
$$;
create trigger playerboard_point_entries_guard
  before insert or update on public.playerboard_point_entries
  for each row execute function public.playerboard_point_entry_guard();

-- Kader: Rueckennummer, Position und aktiv -- Team und Person einer Zeile aendern sich nicht.
create or replace function public.playerboard_player_immutable_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id <> old.organization_id or new.team_id <> old.team_id
     or new.department_id <> old.department_id or new.directory_person_id <> old.directory_person_id then
    raise exception 'playerboard_player_identity_immutable';
  end if;
  return new;
end;
$$;
create trigger playerboard_players_immutable_guard
  before update on public.playerboard_players
  for each row execute function public.playerboard_player_immutable_guard();

-- Fotos starten immer privat und ungeprueft -- egal, was ein Einfuegeweg mitschickt.
create or replace function public.playerboard_photo_insert_defaults() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.public := false;
  new.consent_review_status := 'pending';
  new.all_recognizable_people_listed := false;
  new.consent_reviewed_by := null;
  new.consent_reviewed_at := null;
  return new;
end;
$$;
create trigger playerboard_training_photos_insert_defaults
  before insert on public.playerboard_training_photos
  for each row execute function public.playerboard_photo_insert_defaults();

-- 7. RLS ------------------------------------------------------------------------------------------

-- Einstellungen: vereinsweit lesbar (wie policy_settings), damit jede Ebene ihre Vererbung
-- einordnen kann; schreiben mit playerboard.manage auf genau dieser Ebene.
create policy playerboard_settings_select on public.playerboard_settings for select to authenticated
  using (
    authz.module_enabled(organization_id, department_id, team_id, 'playerboard')
    and authz.is_any_member_of_organization(organization_id)
  );
create policy playerboard_settings_insert on public.playerboard_settings for insert to authenticated
  with check (updated_by = auth.uid() and authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id));
create policy playerboard_settings_update on public.playerboard_settings for update to authenticated
  using (authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id))
  with check (updated_by = auth.uid() and authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id));
create policy playerboard_settings_delete on public.playerboard_settings for delete to authenticated
  using (authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id));

-- Kader: sichtbar wie die Kennzahlen, gepflegt mit training.manage. Die Verzeichnisperson muss fuer
-- den Schreibenden ueber dessen eigene RLS lesbar sein (directory_people_select verlangt
-- directory.read in ihrem Scope) -- ein Trainer kann so keine fremde Person in seinen Kader holen.
create policy playerboard_players_select on public.playerboard_players for select to authenticated
  using (authz.can_view_playerboard_stats(team_id));
create policy playerboard_players_insert on public.playerboard_players for insert to authenticated
  with check (
    authz.has_playerboard_team_permission(team_id, 'training.manage')
    and exists (select 1 from public.directory_people person where person.organization_id = playerboard_players.organization_id and person.id = playerboard_players.directory_person_id)
  );
create policy playerboard_players_update on public.playerboard_players for update to authenticated
  using (authz.has_playerboard_team_permission(team_id, 'training.manage'))
  with check (authz.has_playerboard_team_permission(team_id, 'training.manage'));
create policy playerboard_players_delete on public.playerboard_players for delete to authenticated
  using (authz.has_playerboard_team_permission(team_id, 'training.manage'));

-- Kategorien: Namen und Wertebereiche sind nicht sensibel, vereinsweit lesbar; geschrieben mit
-- playerboard.manage auf der eigenen Ebene, Mannschaftskategorien nur bei team_categories_allowed.
create policy playerboard_point_categories_select on public.playerboard_point_categories for select to authenticated
  using (
    authz.module_enabled(organization_id, department_id, team_id, 'playerboard')
    and authz.is_any_member_of_organization(organization_id)
  );
create policy playerboard_point_categories_insert on public.playerboard_point_categories for insert to authenticated
  with check (
    authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id)
    and (scope <> 'team' or authz.playerboard_setting(organization_id, department_id, team_id, 'team_categories_allowed') = 'true')
  );
create policy playerboard_point_categories_update on public.playerboard_point_categories for update to authenticated
  using (authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id))
  with check (authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id));
create policy playerboard_point_categories_delete on public.playerboard_point_categories for delete to authenticated
  using (authz.can_manage_playerboard_level(organization_id, scope, department_id, team_id));

-- Trainings: gespeicherte fuer alle, die die Kennzahlen sehen; Entwuerfe nur mit training.manage.
create policy playerboard_trainings_select on public.playerboard_trainings for select to authenticated
  using (
    (status = 'saved' and authz.can_view_playerboard_stats(team_id))
    or authz.has_playerboard_team_permission(team_id, 'training.manage')
  );
create policy playerboard_trainings_insert on public.playerboard_trainings for insert to authenticated
  with check (created_by = auth.uid() and authz.has_playerboard_team_permission(team_id, 'training.manage'));
create policy playerboard_trainings_update on public.playerboard_trainings for update to authenticated
  using (authz.has_playerboard_team_permission(team_id, 'training.manage'))
  with check (authz.has_playerboard_team_permission(team_id, 'training.manage'));
create policy playerboard_trainings_delete on public.playerboard_trainings for delete to authenticated
  using (authz.has_playerboard_team_permission(team_id, 'training.manage'));

-- Notizen: mannschaftsintern (training.view), auch bei weiter gefasster stats_visibility nicht.
create policy playerboard_training_notes_select on public.playerboard_training_notes for select to authenticated
  using (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_training_notes.organization_id and training.id = playerboard_training_notes.training_id
       and ((training.status = 'saved' and authz.has_playerboard_team_permission(training.team_id, 'training.view'))
            or authz.has_playerboard_team_permission(training.team_id, 'training.manage'))
  ));
create policy playerboard_training_notes_write on public.playerboard_training_notes for all to authenticated
  using (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_training_notes.organization_id and training.id = playerboard_training_notes.training_id
       and authz.has_playerboard_team_permission(training.team_id, 'training.manage')
  ))
  with check (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_training_notes.organization_id and training.id = playerboard_training_notes.training_id
       and authz.has_playerboard_team_permission(training.team_id, 'training.manage')
  ));

-- Punkte: wie die Trainings, zu denen sie gehoeren.
create policy playerboard_point_entries_select on public.playerboard_point_entries for select to authenticated
  using (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_point_entries.organization_id and training.id = playerboard_point_entries.training_id
       and ((training.status = 'saved' and authz.can_view_playerboard_stats(training.team_id))
            or authz.has_playerboard_team_permission(training.team_id, 'training.manage'))
  ));
create policy playerboard_point_entries_write on public.playerboard_point_entries for all to authenticated
  using (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_point_entries.organization_id and training.id = playerboard_point_entries.training_id
       and authz.has_playerboard_team_permission(training.team_id, 'training.manage')
  ))
  with check (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_point_entries.organization_id and training.id = playerboard_point_entries.training_id
       and authz.has_playerboard_team_permission(training.team_id, 'training.manage')
  ));

-- Fotos: mannschaftsintern wie Notizen. Einfuegen und Loeschen mit training.manage; Status,
-- Personenliste und "oeffentlich" aendern ausschliesslich die RPCs in Abschnitt 8.
create policy playerboard_training_photos_select on public.playerboard_training_photos for select to authenticated
  using (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_training_photos.organization_id and training.id = playerboard_training_photos.training_id
       and ((training.status = 'saved' and authz.has_playerboard_team_permission(training.team_id, 'training.view'))
            or authz.has_playerboard_team_permission(training.team_id, 'training.manage'))
  ));
create policy playerboard_training_photos_insert on public.playerboard_training_photos for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_training_photos.organization_id and training.id = playerboard_training_photos.training_id
       and authz.has_playerboard_team_permission(training.team_id, 'training.manage')
       -- Speicherpfad im Bucket playerboard-training-photos: {organization_id}/{team_id}/{training_id}/{uuid}
       and playerboard_training_photos.storage_path like training.organization_id::text || '/' || training.team_id::text || '/' || training.id::text || '/%'
  ));
create policy playerboard_training_photos_delete on public.playerboard_training_photos for delete to authenticated
  using (exists (
    select 1 from public.playerboard_trainings training
     where training.organization_id = playerboard_training_photos.organization_id and training.id = playerboard_training_photos.training_id
       and authz.has_playerboard_team_permission(training.team_id, 'training.manage')
  ));

create policy playerboard_training_photo_people_select on public.playerboard_training_photo_people for select to authenticated
  using (exists (
    select 1
      from public.playerboard_training_photos photo
      join public.playerboard_trainings training
        on training.organization_id = photo.organization_id and training.id = photo.training_id
     where photo.organization_id = playerboard_training_photo_people.organization_id
       and photo.id = playerboard_training_photo_people.photo_id
       and ((training.status = 'saved' and authz.has_playerboard_team_permission(training.team_id, 'training.view'))
            or authz.has_playerboard_team_permission(training.team_id, 'training.manage'))
  ));

grant select, insert, update, delete on public.playerboard_settings, public.playerboard_players,
  public.playerboard_point_categories, public.playerboard_trainings, public.playerboard_training_notes,
  public.playerboard_point_entries to authenticated;
grant select, delete on public.playerboard_training_photos to authenticated;
grant insert (id, organization_id, training_id, storage_path, content_type, size_bytes, uploaded_by) on public.playerboard_training_photos to authenticated;
grant select on public.playerboard_training_photo_people to authenticated;
grant all privileges on public.playerboard_settings, public.playerboard_players, public.playerboard_point_categories,
  public.playerboard_trainings, public.playerboard_training_notes, public.playerboard_point_entries,
  public.playerboard_training_photos, public.playerboard_training_photo_people to service_role;

-- Privater Bucket ohne Policies fuer authenticated: Hoch- und Herunterladen nur ueber signierte URLs,
-- die die API nach eigener Rechtepruefung ausstellt (Muster Medien-Grant, Paket 025).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('playerboard-training-photos', 'playerboard-training-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- 8. Einwilligungspruefung je Foto ----------------------------------------------------------------

-- SQL-Spiegel von evaluateConsent() (packages/domain/src/consent.ts) fuer Zweck 'website',
-- Medienart 'photo', Kontext 'training' und die Abteilung der Mannschaft. Strenger als dort bei
-- ausgetretenen Personen: fuer eine oeffentliche Seite zaehlt left_at immer, unabhaengig von
-- consentExpiresOnLeave.
create or replace function authz.playerboard_photo_consent_valid(
  target_consent_record_id uuid, target_directory_person_id uuid, target_department_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.consent_records record
      join public.directory_people person
        on person.organization_id = record.organization_id and person.id = record.directory_person_id
     where record.id = target_consent_record_id
       and record.directory_person_id = target_directory_person_id
       and record.revoked_at is null
       and record.superseded_by is null
       and (record.valid_from is null or record.valid_from <= now())
       and (record.valid_until is null or record.valid_until > now())
       and not (person.is_minor and record.signer_role is distinct from 'guardian')
       and (record.signer_role is distinct from 'guardian' or record.guardian_confirmed)
       and person.left_at is null
       and person.status <> 'left'
       and coalesce(record.scope_structured->'purposes', '[]'::jsonb) ? 'website'
       and coalesce(record.scope_structured->'mediaKinds', '[]'::jsonb) ? 'photo'
       and (jsonb_typeof(record.scope_structured->'contexts') is distinct from 'array' or record.scope_structured->'contexts' ? 'training')
       and (jsonb_typeof(record.scope_structured->'departmentIds') is distinct from 'array' or record.scope_structured->'departmentIds' ? target_department_id::text)
  );
$$;
revoke all on function authz.playerboard_photo_consent_valid(uuid, uuid, uuid) from public;

-- Verbindlicher Einzelbild-Review (Plan, "Fotos"): jede erkennbare Person mit gueltiger
-- Einwilligung, ausdrueckliche Bestaetigung der Vollstaendigkeit. Erst dann 'approved' und auf
-- Wunsch oeffentlich. target_people: [{"directoryPersonId": uuid, "consentRecordId": uuid}, ...];
-- eine leere Liste heisst "keine erkennbare Person".
-- Wer pruefen darf: training.manage auf der Mannschaft oder consent.manage in deren Abteilung.
create or replace function public.playerboard_review_photo_consent(
  target_photo_id uuid, target_people jsonb, all_recognizable_people_listed boolean, make_public boolean
) returns public.playerboard_training_photos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  photo public.playerboard_training_photos;
  training public.playerboard_trainings;
  entry jsonb;
  person_id uuid;
  consent_id uuid;
  invalid jsonb := '[]'::jsonb;
  result public.playerboard_training_photos;
begin
  select * into photo from public.playerboard_training_photos where id = target_photo_id for update;
  if not found then
    raise exception 'photo_not_found';
  end if;
  select * into training from public.playerboard_trainings
   where organization_id = photo.organization_id and id = photo.training_id;
  if not (
    authz.has_playerboard_team_permission(training.team_id, 'training.manage')
    or (authz.module_enabled(training.organization_id, training.department_id, training.team_id, 'playerboard')
        and authz.has_department_permission(training.department_id, 'consent.manage'))
  ) then
    raise exception 'insufficient_permission';
  end if;
  if not coalesce(all_recognizable_people_listed, false) then
    raise exception 'recognizable_people_not_confirmed';
  end if;
  if coalesce(jsonb_typeof(target_people), '') <> 'array' then
    raise exception 'invalid_people';
  end if;
  if (select count(*) from jsonb_array_elements(target_people)) <>
     (select count(distinct value->>'directoryPersonId') from jsonb_array_elements(target_people)) then
    raise exception 'invalid_people';
  end if;

  for entry in select value from jsonb_array_elements(target_people) loop
    person_id := (entry->>'directoryPersonId')::uuid;
    consent_id := (entry->>'consentRecordId')::uuid;
    if person_id is null or consent_id is null
       or not exists (select 1 from public.directory_people p where p.organization_id = photo.organization_id and p.id = person_id)
       or not authz.playerboard_photo_consent_valid(consent_id, person_id, training.department_id) then
      invalid := invalid || jsonb_build_object('directoryPersonId', entry->'directoryPersonId', 'consentRecordId', entry->'consentRecordId');
    end if;
  end loop;
  if jsonb_array_length(invalid) > 0 then
    raise exception 'photo_consent_invalid' using detail = invalid::text;
  end if;

  delete from public.playerboard_training_photo_people where photo_id = photo.id;
  insert into public.playerboard_training_photo_people (organization_id, photo_id, directory_person_id, consent_record_id)
    select photo.organization_id, photo.id, (value->>'directoryPersonId')::uuid, (value->>'consentRecordId')::uuid
      from jsonb_array_elements(target_people);

  update public.playerboard_training_photos set
    consent_review_status = 'approved',
    all_recognizable_people_listed = true,
    consent_reviewed_by = auth.uid(),
    consent_reviewed_at = now(),
    public = coalesce(make_public, false)
  where id = photo.id
  returning * into result;
  return result;
end;
$$;
revoke all on function public.playerboard_review_photo_consent(uuid, jsonb, boolean, boolean) from public;
grant execute on function public.playerboard_review_photo_consent(uuid, jsonb, boolean, boolean) to authenticated;

-- Einzelnes Foto oeffentlich zeigen oder ausnehmen. Ausnehmen geht immer, Zeigen nur nach
-- bestandenem Review (der CHECK auf der Tabelle erzwingt das zusaetzlich).
create or replace function public.playerboard_set_photo_public(target_photo_id uuid, make_public boolean)
returns public.playerboard_training_photos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  photo public.playerboard_training_photos;
  team uuid;
  result public.playerboard_training_photos;
begin
  select * into photo from public.playerboard_training_photos where id = target_photo_id for update;
  if not found then
    raise exception 'photo_not_found';
  end if;
  select team_id into team from public.playerboard_trainings where organization_id = photo.organization_id and id = photo.training_id;
  if not authz.has_playerboard_team_permission(team, 'training.manage') then
    raise exception 'insufficient_permission';
  end if;
  if make_public and photo.consent_review_status <> 'approved' then
    raise exception 'photo_consent_not_approved';
  end if;
  update public.playerboard_training_photos set public = make_public where id = photo.id returning * into result;
  return result;
end;
$$;
revoke all on function public.playerboard_set_photo_public(uuid, boolean) from public;
grant execute on function public.playerboard_set_photo_public(uuid, boolean) to authenticated;

-- Widerruf, Abloesung oder Aenderung von Gueltigkeit/Umfang einer Einwilligung sperrt alle Fotos,
-- deren Review sich auf sie stuetzt, und macht sie privat. Ein Ablauf allein (valid_until
-- verstreicht) loest keinen Trigger aus -- deshalb prueft playerboard_public_photos() die
-- Einwilligungen zusaetzlich bei jedem Abruf.
create or replace function public.playerboard_block_photos_for_consent_change() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.revoked_at is distinct from old.revoked_at
     or new.superseded_by is distinct from old.superseded_by
     or new.valid_from is distinct from old.valid_from
     or new.valid_until is distinct from old.valid_until
     or new.scope_structured is distinct from old.scope_structured
     or new.directory_person_id is distinct from old.directory_person_id then
    update public.playerboard_training_photos photo set consent_review_status = 'blocked', public = false
     where photo.organization_id = new.organization_id
       and photo.consent_review_status <> 'blocked'
       and exists (
         select 1 from public.playerboard_training_photo_people link
          where link.organization_id = new.organization_id and link.photo_id = photo.id and link.consent_record_id = new.id
       );
  end if;
  return new;
end;
$$;
create trigger consent_records_block_playerboard_photos
  after update on public.consent_records
  for each row execute function public.playerboard_block_photos_for_consent_change();

-- 9. Einladung eines Kaderspielers ----------------------------------------------------------------
-- Eine Einladung kann an eine Verzeichnisperson gebunden sein. Beim Annehmen wird das Konto mit
-- der Person verknuepft (nur wenn sie noch keines hat).
alter table public.invitations add column directory_person_id uuid;
alter table public.invitations add constraint invitations_directory_person_fk
  foreign key (organization_id, directory_person_id)
  references public.directory_people(organization_id, id) on delete set null (directory_person_id);
alter table public.invitations add constraint invitations_directory_person_team_check
  check (directory_person_id is null or team_id is not null);

drop function public.create_invitation(uuid, uuid, uuid, text, text, text);
create or replace function public.create_invitation(
  target_organization_id uuid,
  target_department_id uuid,
  target_team_id uuid,
  target_email text,
  target_role text,
  target_token_hash text,
  target_directory_person_id uuid default null
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
  -- Paket 052: nur eine Person aus dem Kader genau dieser Mannschaft.
  if target_directory_person_id is not null and not exists (
    select 1 from public.playerboard_players player
     where player.organization_id = target_organization_id
       and player.team_id = target_team_id
       and player.directory_person_id = target_directory_person_id
  ) then
    raise exception 'directory_person_not_in_team';
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
    insert into public.invitations (organization_id, department_id, team_id, email, role, token_hash, invited_by, expires_at, directory_person_id)
      values (target_organization_id, target_department_id, target_team_id, normalized_email, target_role, target_token_hash, auth.uid(), now() + interval '14 days', target_directory_person_id)
      returning * into result;
  exception when unique_violation then
    raise exception 'invitation_already_open';
  end;

  return result;
end;
$$;
revoke all on function public.create_invitation(uuid, uuid, uuid, text, text, text, uuid) from public;
grant execute on function public.create_invitation(uuid, uuid, uuid, text, text, text, uuid) to authenticated;

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
  elsif invitation.department_id is not null then
    insert into public.department_memberships (organization_id, department_id, user_id, role)
      values (invitation.organization_id, invitation.department_id, actor_profile_id, invitation.role::public.department_role)
      on conflict (department_id, user_id, role) do nothing;
  else
    insert into public.organization_memberships (organization_id, user_id, role)
      values (invitation.organization_id, actor_profile_id, invitation.role::public.organization_role)
      on conflict (organization_id, user_id, role) do nothing;
  end if;

  -- Paket 052: Konto mit der Kader-Person verknuepfen, ohne eine bestehende Verknuepfung zu
  -- ueberschreiben.
  if invitation.directory_person_id is not null then
    update public.directory_people set profile_id = actor_profile_id
     where organization_id = invitation.organization_id and id = invitation.directory_person_id and profile_id is null;
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

-- 10. Speicherkontingent --------------------------------------------------------------------------
-- Trainingsfotos zaehlen auf das Speicherkontingent des Vereins (Paket 021), je Abteilung und
-- Mannschaft ueber das Training.
create or replace function public.storage_usage_bytes(
  target_organization uuid, target_department uuid default null, target_team uuid default null
) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select sum(asset.byte_size) from public.media_assets asset
     where asset.organization_id = target_organization
       and target_team is null
       and (target_department is null or asset.department_id = target_department)
       and asset.upload_status <> 'deleted'
  ), 0)
  + coalesce((
    select sum(derivative.byte_size)
      from public.media_derivatives derivative
      join public.media_assets asset
        on asset.organization_id = derivative.organization_id and asset.id = derivative.media_asset_id
     where derivative.organization_id = target_organization
       and target_team is null
       and (target_department is null or asset.department_id = target_department)
       and asset.upload_status <> 'deleted'
  ), 0)
  + coalesce((
    select sum(brand.byte_size) from public.brand_assets brand
     where brand.organization_id = target_organization
       and (target_department is null or brand.department_id = target_department)
       and (target_team is null or brand.team_id = target_team)
  ), 0)
  + coalesce((
    select sum(photo.size_bytes)
      from public.playerboard_training_photos photo
      join public.playerboard_trainings training
        on training.organization_id = photo.organization_id and training.id = photo.training_id
     where photo.organization_id = target_organization
       and (target_department is null or training.department_id = target_department)
       and (target_team is null or training.team_id = target_team)
  ), 0);
$$;

-- 11. Rangliste und Kader fuer Berechtigte --------------------------------------------------------

-- Summen je Spieler und Kategorie aus gespeicherten Trainings im Zeitraum, mit geteilten Raengen
-- (1, 2, 2, 4). Aktive Spieler erscheinen auch mit 0 Punkten, inaktive nur mit Punkten im Zeitraum.
-- Ohne Pruefung -- die beiden oeffentlichen Varianten darunter pruefen selbst.
create or replace function authz.playerboard_ranking_rows(target_team_id uuid, from_date date, to_date date)
returns table (player_id uuid, directory_person_id uuid, jersey_number integer, rank bigint, total bigint, category_totals jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with entries as (
    select entry.player_id, entry.category_id, sum(entry.value)::bigint as points
      from public.playerboard_point_entries entry
      join public.playerboard_trainings training
        on training.organization_id = entry.organization_id and training.id = entry.training_id
     where training.team_id = target_team_id
       and training.status = 'saved'
       and (from_date is null or training.training_date >= from_date)
       and (to_date is null or training.training_date <= to_date)
     group by entry.player_id, entry.category_id
  ), totals as (
    select player.id as player_id, player.directory_person_id, player.jersey_number,
           coalesce(sum(entries.points), 0)::bigint as total,
           coalesce(jsonb_object_agg(entries.category_id, entries.points) filter (where entries.category_id is not null), '{}'::jsonb) as category_totals
      from public.playerboard_players player
      left join entries on entries.player_id = player.id
     where player.team_id = target_team_id
     group by player.id, player.directory_person_id, player.jersey_number, player.active
    having player.active or count(entries.category_id) > 0
  )
  select totals.player_id, totals.directory_person_id, totals.jersey_number,
         rank() over (order by totals.total desc), totals.total, totals.category_totals
    from totals;
$$;
revoke all on function authz.playerboard_ranking_rows(uuid, date, date) from public;

-- Fuer angemeldete Mitglieder mit Sicht auf die Kennzahlen: Rangliste mit Namen. Klarnamen sind
-- vereinsintern ausdruecklich gewollt (Betreiberentscheidung 2026-10-05).
create or replace function public.playerboard_team_ranking(target_team_id uuid, from_date date default null, to_date date default null)
returns table (player_id uuid, first_name text, last_name text, jersey_number integer, rank bigint, total bigint, category_totals jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rows.player_id, person.first_name, person.last_name, rows.jersey_number, rows.rank, rows.total, rows.category_totals
    from authz.playerboard_ranking_rows(target_team_id, from_date, to_date) rows
    join public.directory_people person on person.id = rows.directory_person_id
   where authz.can_view_playerboard_stats(target_team_id)
   order by rows.rank, person.last_name, person.first_name;
$$;
revoke all on function public.playerboard_team_ranking(uuid, date, date) from public;
grant execute on function public.playerboard_team_ranking(uuid, date, date) to authenticated, service_role;

-- Kader mit Namen fuer alle, die die Kennzahlen sehen -- auch Spieler ohne directory.read.
create or replace function public.playerboard_team_roster(target_team_id uuid)
returns table (player_id uuid, directory_person_id uuid, first_name text, last_name text, jersey_number integer, "position" text, active boolean, has_account boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select player.id, player.directory_person_id, person.first_name, person.last_name, player.jersey_number,
         player.position, player.active, person.profile_id is not null
    from public.playerboard_players player
    join public.directory_people person on person.organization_id = player.organization_id and person.id = player.directory_person_id
   where player.team_id = target_team_id
     and authz.can_view_playerboard_stats(target_team_id)
   order by player.active desc, player.jersey_number nulls last, person.last_name, person.first_name;
$$;
revoke all on function public.playerboard_team_roster(uuid) from public;
grant execute on function public.playerboard_team_roster(uuid) to authenticated, service_role;

-- 12. Oeffentliche Mannschaftsseite ---------------------------------------------------------------
-- Ausschliesslich fuer die API (service_role), aufgerufen aus anonymen Endpunkten. Spieler
-- erscheinen nur als playerboard_public_label(); Klarnamen, Geburtsjahre, IDs von Personen,
-- Positionen, E-Mails und Notizen verlassen diese Funktionen nie.

create or replace function public.playerboard_public_label(target_directory_person_id uuid, target_jersey_number integer)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select concat_ws(' ',
           case when target_jersey_number is not null then '#' || target_jersey_number::text end,
           upper(left(btrim(person.first_name), 1)) || '. ' || upper(left(btrim(person.last_name), 1)) || '.')
    from public.directory_people person
   where person.id = target_directory_person_id;
$$;
revoke all on function public.playerboard_public_label(uuid, integer) from public;
grant execute on function public.playerboard_public_label(uuid, integer) to service_role;

-- Die Mannschaft hinter einer oeffentlichen Adresse, nur wenn Modul und public_sharing_allowed
-- entlang des ganzen Pfads es zulassen. Liefert die drei Schalter mit.
create or replace function authz.playerboard_public_team(org_slug text, team_slug text)
returns table (organization_id uuid, department_id uuid, team_id uuid, organization_name text, team_name text,
               points_enabled boolean, veo_stats_enabled boolean, photos_enabled boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization.id, team.department_id, team.id, organization.name, team.name,
         coalesce(settings.public_points_enabled, false), coalesce(settings.public_veo_stats_enabled, false),
         coalesce(settings.public_photos_enabled, false)
    from public.organizations organization
    join public.playerboard_settings settings
      on settings.organization_id = organization.id and settings.scope = 'team' and settings.public_slug = team_slug
    join public.teams team on team.organization_id = organization.id and team.id = settings.team_id
   where organization.slug = org_slug
     and team.archived_at is null
     and authz.module_enabled(organization.id, team.department_id, team.id, 'playerboard')
     and authz.resolve_playerboard_setting(organization.id, team.department_id, team.id, 'public_sharing_allowed') = 'true';
$$;
revoke all on function authz.playerboard_public_team(text, text) from public;

create or replace function public.playerboard_public_team_info(org_slug text, team_slug text)
returns table (organization_name text, team_name text, points_enabled boolean, veo_stats_enabled boolean, photos_enabled boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select team.organization_name, team.team_name, team.points_enabled, team.veo_stats_enabled, team.photos_enabled
    from authz.playerboard_public_team(org_slug, team_slug) team
   where team.points_enabled or team.veo_stats_enabled or team.photos_enabled;
$$;
revoke all on function public.playerboard_public_team_info(text, text) from public;
grant execute on function public.playerboard_public_team_info(text, text) to service_role;

-- Rangliste: Bezeichnung statt Name, Kategorien mit Namen statt IDs.
create or replace function public.playerboard_public_ranking(org_slug text, team_slug text, from_date date default null, to_date date default null)
returns table (rank bigint, label text, total bigint, category_totals jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rows.rank,
         public.playerboard_public_label(rows.directory_person_id, rows.jersey_number),
         rows.total,
         coalesce((
           select jsonb_agg(jsonb_build_object('category', category.name, 'points', (rows.category_totals->>category.id::text)::bigint)
                            order by case category.scope when 'organization' then 0 when 'department' then 1 else 2 end, category.sort_order, category.name)
             from public.playerboard_point_categories category
            where rows.category_totals ? category.id::text
         ), '[]'::jsonb)
    from authz.playerboard_public_team(org_slug, team_slug) team
    cross join lateral authz.playerboard_ranking_rows(team.team_id, from_date, to_date) rows
   where team.points_enabled
   order by rows.rank, 2;
$$;
revoke all on function public.playerboard_public_ranking(text, text, date, date) from public;
grant execute on function public.playerboard_public_ranking(text, text, date, date) to service_role;

-- Fotos: nur gespeicherte Trainings, public, Review bestanden, Personenliste vollstaendig und jede
-- zugeordnete Einwilligung JETZT gueltig. Der Speicherpfad geht nur an die API, die daraus eine
-- kurzlebige signierte URL macht.
create or replace function public.playerboard_public_photos(org_slug text, team_slug text, from_date date default null, to_date date default null)
returns table (photo_id uuid, storage_path text, training_date date, uploaded_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select photo.id, photo.storage_path, training.training_date, photo.uploaded_at
    from authz.playerboard_public_team(org_slug, team_slug) team
    join public.playerboard_trainings training on training.team_id = team.team_id and training.status = 'saved'
    join public.playerboard_training_photos photo
      on photo.organization_id = training.organization_id and photo.training_id = training.id
   where team.photos_enabled
     and photo.public
     and photo.consent_review_status = 'approved'
     and photo.all_recognizable_people_listed
     and (from_date is null or training.training_date >= from_date)
     and (to_date is null or training.training_date <= to_date)
     and not exists (
       select 1 from public.playerboard_training_photo_people link
        where link.organization_id = photo.organization_id and link.photo_id = photo.id
          and not authz.playerboard_photo_consent_valid(link.consent_record_id, link.directory_person_id, training.department_id)
     )
   order by training.training_date desc, photo.uploaded_at desc;
$$;
revoke all on function public.playerboard_public_photos(text, text, date, date) from public;
grant execute on function public.playerboard_public_photos(text, text, date, date) to service_role;
