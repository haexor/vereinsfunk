begin;

-- Paket 014: Integrationsrahmen und Mitgliederverzeichnis. Plan-Dateiname war
-- 2026080407_integration_framework.sql -- dieser Zeitstempel liegt vor allen
-- 2026080501..2026080702-Migrationen aus den Paketen 009-013 (gleiches Muster wie bereits bei
-- 2026080606, 2026080701 und 2026080702 dokumentiert). Der tatsaechliche Dateiname folgt der
-- naechsten freien Zeitscheibe.
--
-- HTTP- und Webhook-Transport sind bewusst nur als Enum-Werte vorgesehen, nicht implementiert
-- (siehe plans/014, Abschnitt "Entscheidungen vor der Umsetzung"): kein Zielsystem mit
-- dokumentiertem Testzugang bekannt. credentials_secret_id bleibt deshalb ein unbenutzter,
-- vorbereiteter Spaltenplatz ohne eigene Sekrettabelle -- die entsteht erst mit dem HTTP-Adapter.

-- 0. Neue Verwaltungsrechte je Ebene ------------------------------------------------------------
--
-- organization_owner/organization_admin erhalten directory.read und integration.manage
-- automatisch (siehe authz.has_organization_permission: "true" bzw. "permission <> billing.manage"),
-- ohne dass diese Funktion angefasst werden muss. team_manager bekommt nur directory.read --
-- integration_sources kennt keine Team-Ebene (department_id ist die feinste Scope-Spalte), ein
-- Team-Verwalter kann also nie eine Quelle verwalten. Volle Funktionskopien aus
-- 2026080702_brand_assets_and_fonts.sql, nur die betroffenen Arrays erweitert (siehe
-- packages/authorization fuer das TS-Gegenstueck).
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
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','directory.read','integration.manage'])
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
        when 'team_manager' then permission = any(array['post.create','post.edit','post.submit','analytics.view','member.invite','member.remove','brand.manage','directory.read'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.teams team
    where team.id = target_team_id
      and authz.has_department_permission(team.department_id, permission)
  );
$$;

-- 1. Integrationsrahmen: Quellen, Sync-Laeufe, Konflikte ------------------------------------------
create type public.integration_domain as enum ('people','teams','fixtures','events');
-- Deckungsgleich mit SourceTransport.kind (packages/integrations). Handgepflegte Datensaetze sind
-- keine Quelle, sondern tragen source_id = null -- deshalb kein 'manual' im Enum.
create type public.integration_transport as enum ('file','http','ical','webhook');

create table public.integration_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transport public.integration_transport not null,
  provider_key text not null,                    -- 'csv','ical','easyverein', …
  display_name text not null check (char_length(display_name) between 1 and 160),
  -- cardinality, nicht array_length: array_length('{}', 1) ist NULL, und ein
  -- CHECK mit NULL gilt als erfuellt -- der leere Wert umgeht die Grenze sonst.
  enabled_domains public.integration_domain[] not null
    check (cardinality(enabled_domains) between 1 and 4),
  department_id uuid,                            -- optional auf eine Abteilung begrenzt
  endpoint_url text,
  credentials_secret_id uuid,                    -- packages/secrets, nie Klartext; unbenutzt bis HTTP-Adapter
  field_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(field_mapping) = 'object'),
  sync_cron text,                                -- null = nur manuell
  loss_threshold_percent integer not null default 30 check (loss_threshold_percent between 1 and 100),
  enabled boolean not null default true,
  last_sync_at timestamptz, last_sync_status text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade
);

create table public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, source_id uuid not null,
  domain public.integration_domain not null,
  mode text not null check (mode in ('dry_run','apply')),
  status text not null default 'running'
    check (status in ('running','succeeded','failed','cancelled','aborted_loss_threshold')),
  created_count integer not null default 0, updated_count integer not null default 0,
  retired_count integer not null default 0, skipped_count integer not null default 0,
  conflict_count integer not null default 0,
  error_class text, correlation_id uuid not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  triggered_by uuid references public.profiles(id),
  unique (organization_id, id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);

create table public.integration_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, sync_run_id uuid not null,
  source_id uuid not null,
  domain public.integration_domain not null,
  external_id text, local_id uuid, label text not null,
  field text not null, current_value text, incoming_value text,
  kind text not null check (kind in ('ambiguous_match','unknown_structure','value_conflict','invalid_record')),
  -- Stabiler Wiedererkennungsschluessel ueber Laufgrenzen hinweg, damit
  -- ignore_permanently beim naechsten Lauf ueberhaupt greifen kann.
  fingerprint text not null,
  resolution text not null default 'pending'
    check (resolution in ('pending','keep_current','take_incoming','ignore_permanently')),
  resolved_by uuid references public.profiles(id), resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, sync_run_id)
    references public.integration_sync_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);
-- Dauerhaft ignorierte Konflikte werden nicht neu angelegt, sondern gefunden.
create unique index integration_sync_conflicts_ignored_unique
  on public.integration_sync_conflicts (organization_id, source_id, fingerprint)
  where resolution = 'ignore_permanently';

create index integration_sources_scope_idx on public.integration_sources(organization_id, department_id);
create index integration_sync_runs_source_idx on public.integration_sync_runs(organization_id, source_id, started_at desc);
create index integration_sync_conflicts_run_idx on public.integration_sync_conflicts(organization_id, sync_run_id, resolution);

-- 2. Mitgliederverzeichnis ------------------------------------------------------------------------
create type public.directory_person_status as enum ('active','inactive','left','unknown');

create table public.directory_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid, team_id uuid,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name  text not null check (char_length(last_name)  between 1 and 80),
  birth_year integer check (birth_year between 1900 and 2100),
  is_minor boolean not null default false,
  status public.directory_person_status not null default 'active',
  left_at date,
  -- "seit wann dabei" (Abschnitt 5 des Plans, Nutzeranforderung vom 2026-08-05) -- heute existierte
  -- nur left_at.
  joined_at date,
  guardian_name text, guardian_email text check (guardian_email = lower(guardian_email)),
  -- Verknuepfung zu einem App-Konto (Abschnitt 5): eine Verzeichnisperson kann ein Konto haben,
  -- muss aber nicht. profiles ist keine mandantenbezogene Tabelle (kein organization_id), daher
  -- ein einfacher Fremdschluessel ohne Verbundschluessel -- wie invitations.invited_by.
  profile_id uuid references public.profiles(id) on delete set null,
  -- Gesetzt vom taeglichen Cron (siehe recompute_directory_minor_status unten), wenn is_minor durch
  -- Zeitablauf von true auf false wechselt. Traegt die "Volljaehrig geworden -- Einwilligung
  -- pruefen"-Liste, bis Paket 015 einen echten Bestaetigungs-/Abschlussschritt dafuer baut -- bis
  -- dahin bleibt der Zeitstempel bewusst stehen, statt eine ungefragte Abhak-Mechanik zu erfinden.
  became_adult_at timestamptz,
  source_id uuid, external_id text, source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Spaltenliste bei SET NULL ist Pflicht: ohne sie setzt PostgreSQL *alle*
  -- Spalten des Fremdschluessels auf NULL, also auch organization_id -- die ist
  -- not null, und das Loeschen der Abteilung wuerde daran scheitern.
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete set null (department_id),
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete set null (team_id),
  foreign key (organization_id, source_id) references public.integration_sources(organization_id, id) on delete set null (source_id),
  check (not is_minor or guardian_email is not null or status <> 'active')
);

create unique index directory_people_external_unique
  on public.directory_people (organization_id, source_id, external_id)
  where source_id is not null and external_id is not null;
create index directory_people_scope_idx on public.directory_people(organization_id, department_id, team_id, status);

-- Verknuepfung zur Medienwelt, minimal.
alter table public.consent_records add column directory_person_id uuid;
alter table public.consent_records add constraint consent_records_person_fk
  foreign key (organization_id, directory_person_id)
  references public.directory_people(organization_id, id) on delete restrict;

-- 3. Minderjaehrigkeit: taeglicher Abgleich ---------------------------------------------------
--
-- Entscheidung aus plans/014 "Entscheidungen vor der Umsetzung": das ganze Kalenderjahr des
-- 18. Geburtstags gilt noch als minderjaehrig -- eine Person wird also erst ab dem 1. Januar des
-- Folgejahres als erwachsen gefuehrt. Nur die Richtung minderjaehrig -> volljaehrig wird
-- automatisch geschrieben: der CHECK oben verlangt guardian_email fuer eine aktive minderjaehrige
-- Person, und diese Funktion wuerde bei einer Korrektur in die andere Richtung (z. B. ein
-- nachtraeglich eingetragenes Geburtsjahr macht eine bereits ohne Elternkontakt gefuehrte Person
-- minderjaehrig) genau an diesem CHECK scheitern -- das ist eine Dateninkonsistenz, die einen
-- Menschen braucht, kein automatischer Schreibvorgang.
create or replace function public.recompute_directory_minor_status()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected record;
begin
  for affected in
    select person.id, person.organization_id
    from public.directory_people person
    join public.organizations org on org.id = person.organization_id
    where person.is_minor = true
      and person.birth_year is not null
      and extract(year from (now() at time zone org.timezone))::int > person.birth_year + 18
  loop
    update public.directory_people
    set is_minor = false, became_adult_at = now(), updated_at = now()
    where id = affected.id;
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (affected.organization_id, null, 'directory_person.became_adult', 'directory_people', affected.id, gen_random_uuid(), '{}'::jsonb);
  end loop;
end;
$$;
revoke all on function public.recompute_directory_minor_status() from public;
grant execute on function public.recompute_directory_minor_status() to service_role;
comment on function public.recompute_directory_minor_status() is
  'Taeglicher Abgleich von is_minor gegen birth_year. Wartet wie mark_stalled_approval_stages() (011) und flag_channels_needing_reconnect() (012) auf den Hatchet-Cron aus Paket 004.';

-- 4. Row Level Security ---------------------------------------------------------------------
--
-- Schreiben laeuft fuer alle vier Tabellen ausschliesslich ueber die API mit Service Role:
-- Quellen-Validierung (Endpunkt-URL, Feld-Zuordnung), Sync-Ausfuehrung und
-- Konfliktaufloesung (resolved_by muss der tatsaechliche Aufrufer sein, nicht Client-Eingabe)
-- sind serverseitige Logik -- deshalb keine insert/update-Policy fuer authenticated, analog
-- invitations/consent_records/brand_assets.
alter table public.integration_sources enable row level security;
alter table public.integration_sources force row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.integration_sync_runs force row level security;
alter table public.integration_sync_conflicts enable row level security;
alter table public.integration_sync_conflicts force row level security;
alter table public.directory_people enable row level security;
alter table public.directory_people force row level security;

-- Security-definer-Huelle statt direktem EXISTS gegen integration_sources: eine RLS-Unterabfrage
-- gegen eine andere RLS-geschuetzte Tabelle unterliegt sonst DEREN eigener SELECT-Policy und wuerde
-- fuer genau die Person scheitern, die sie eigentlich durchlassen soll (Fund aus Paket 012,
-- channel_scopes_insert vs. social_connections). security definer umgeht das, weil die Funktion mit
-- den Rechten ihres Eigentuemers laeuft, nicht mit denen des Aufrufers.
create or replace function authz.can_manage_integration_source(target_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.integration_sources source
    where source.id = target_source_id
      and (
        authz.has_organization_permission(source.organization_id, 'integration.manage')
        or (source.department_id is not null and authz.has_department_permission(source.department_id, 'integration.manage'))
      )
  );
$$;
revoke all on function authz.can_manage_integration_source(uuid) from public;
grant execute on function authz.can_manage_integration_source(uuid) to authenticated, service_role;

create policy integration_sources_select on public.integration_sources for select to authenticated
  using (authz.can_manage_integration_source(id));
create policy integration_sync_runs_select on public.integration_sync_runs for select to authenticated
  using (authz.can_manage_integration_source(source_id));
create policy integration_sync_conflicts_select on public.integration_sync_conflicts for select to authenticated
  using (authz.can_manage_integration_source(source_id));

-- Lesen von directory_people: department_admin/team_manager der zugeordneten Einheit, plus
-- organization_admin/organization_owner -- ausdruecklich NICHT jedes Vereinsmitglied. Eine Person
-- ohne Abteilung/Mannschaft (department_id/team_id beide null) ist ausschliesslich fuer die
-- Vereinsebene sichtbar, weil es keine untergeordnete Ebene gibt, gegen die geprueft werden koennte.
create policy directory_people_select on public.directory_people for select to authenticated using (
  authz.has_organization_permission(organization_id, 'directory.read')
  or (department_id is not null and authz.has_department_permission(department_id, 'directory.read'))
  or (team_id is not null and authz.has_team_permission(team_id, 'directory.read'))
);

-- Spaltenrechte: guardian_name/guardian_email sind nicht Teil des Standard-Grants. Die API liest
-- sie ueber den Service-Role-Client, nachdem sie department.manage (oder hoeher) selbst geprueft
-- hat -- analog zum Auslesen von social_connection_secrets in Paket 012. Kein eigenes RPC dafuer:
-- die Pruefung braucht keine SQL-Logik, die nicht schon rolesForScope/hasPermission in der API
-- leistet, und ein zusaetzliches security-definer-RPC waere eine weitere Flaeche, auf der ein
-- Aufrufer sicherheitsrelevante Parameter unterschieben koennte (siehe wiederkehrender Fund aus
-- 011/012).
revoke select on public.directory_people from authenticated;
grant select (
  id, organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor,
  status, left_at, joined_at, profile_id, became_adult_at, source_id, external_id,
  source_updated_at, created_at, updated_at
) on public.directory_people to authenticated;
grant all privileges on public.directory_people to service_role;

-- credentials_secret_id ist unbenutzt, bis der HTTP-Adapter kommt, wird aber schon jetzt aus dem
-- Grant ausgeschlossen -- dieselbe Vorsicht wie bei token_ciphertext auf social_connections (012),
-- damit eine spaetere Befuellung nicht zusaetzlich eine Migration braucht, nur um sie zu verbergen.
revoke select on public.integration_sources from authenticated;
grant select (
  id, organization_id, transport, provider_key, display_name, enabled_domains, department_id,
  endpoint_url, field_mapping, sync_cron, loss_threshold_percent, enabled, last_sync_at,
  last_sync_status, created_by, created_at, updated_at
) on public.integration_sources to authenticated;
grant all privileges on public.integration_sources to service_role;

grant select on public.integration_sync_runs to authenticated;
grant all privileges on public.integration_sync_runs to service_role;
grant select on public.integration_sync_conflicts to authenticated;
grant all privileges on public.integration_sync_conflicts to service_role;

create trigger set_integration_sources_updated_at before update on public.integration_sources for each row execute function public.set_updated_at();
create trigger set_directory_people_updated_at before update on public.directory_people for each row execute function public.set_updated_at();

commit;
