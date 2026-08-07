begin;

-- Paket 019: Mannschaften, Spielplaene, Ergebnisse und Veranstaltungen. Baut auf dem
-- Integrationsrahmen aus Paket 014 auf (integration_sources, planSync) -- siehe
-- plans/019-mannschaften-spielplaene-und-veranstaltungen.md, "Entscheidungen vor der Umsetzung".
-- Plan-Dateiname war 2026080412_fixtures_and_events.sql -- dieser Zeitstempel liegt vor den
-- bereits gemergten Migrationen bis 2026080703 (gleiches Muster wie bereits bei 2026080606,
-- 2026080701-703 dokumentiert). Der tatsaechliche Dateiname folgt der naechsten freien Zeitscheibe.

-- 0. Neue Verwaltungsrechte fixture.manage/event.manage ----------------------------------------
-- Nur department_admin (automatisch organization_admin/organization_owner ueber die bestehende
-- has_organization_permission-Fallback-Klausel unten), nicht team_manager -- analog zu
-- team.manage/integration.manage: die Mannschaftsebene verwaltet nicht selbst, das tut die
-- Abteilung. Volle Funktionskopie aus 2026080703_integration_framework.sql, nur die betroffenen
-- Arrays erweitert (siehe packages/authorization fuer das TS-Gegenstueck).
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
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','directory.read','integration.manage','fixture.manage','event.manage'])
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

-- 1. Mannschaften: Herkunft und die Merkmale, die fuer Inhalte zaehlen -------------------------
-- archived_at existiert bereits (2026080601_structure_and_invitations.sql) -- hier nicht erneut
-- anlegen, das wuerde an "column already exists" scheitern (Abweichung vom urspruenglichen
-- Plantext, siehe "Entscheidungen vor der Umsetzung").
alter table public.teams
  add column age_group text,
  add column competition text,
  add column source_id uuid,
  add column external_id text,
  add column source_updated_at timestamptz;
-- Spaltenliste bei on delete set null ist Pflicht: ohne sie setzt PostgreSQL *alle* Spalten des
-- Fremdschluessels auf NULL, also auch organization_id -- die ist not null, und das Loeschen der
-- Quelle wuerde daran scheitern.
alter table public.teams add constraint teams_source_fk
  foreign key (organization_id, source_id)
  references public.integration_sources(organization_id, id) on delete set null (source_id);
create unique index teams_external_unique
  on public.teams (organization_id, source_id, external_id)
  where source_id is not null and external_id is not null;

-- Sync-Provenienzspalten duerfen nicht ueber den bestehenden, spaltenlos weiten
-- teams_insert/teams_update-Schreibzugriff (department_admin via team.manage) frei gesetzt oder
-- vortaeuscht werden -- sonst koennte ein Abteilungsadmin per direktem PostgREST-Aufruf eine
-- falsche Sync-Zuordnung eintragen oder teams_external_unique unterlaufen. Es gibt in diesem
-- Paket keine Oberflaeche, die age_group/competition manuell setzt (nur der Sync-Codepfad ueber
-- Service Role) -- deshalb bleiben auch diese beiden aus dem authenticated-Grant aussen vor,
-- statt eine ungenutzte Schreibflaeche zu oeffnen. name/archived_at bleiben unveraendert ueber
-- den bestehenden Endpunkt editierbar.
revoke insert, update on public.teams from authenticated;
grant insert (organization_id, department_id, name) on public.teams to authenticated;
grant update (name, archived_at) on public.teams to authenticated;

-- 2. Spiele --------------------------------------------------------------------------------------
create type public.fixture_status as enum ('scheduled','postponed','cancelled','played','unknown');

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid,
  kind text not null default 'match' check (kind in ('match','friendly','tournament','cup')),
  competition text,
  is_home boolean,
  own_team_label text,
  opponent_name text,
  kickoff_at timestamptz,
  kickoff_time_confirmed boolean not null default true,
  venue_name text,
  venue_address text,
  status public.fixture_status not null default 'scheduled',
  home_score integer check (home_score >= 0),
  away_score integer check (away_score >= 0),
  result_recorded_at timestamptz,
  note text,
  -- Zustand der Anlassvorschlaege (plans/019, Abschnitt 4): zwei Spalten, weil ein Spiel zwei
  -- unabhaengige Vorschlaege erzeugt (vorher Ankuendigung, nachher Ergebnis).
  announcement_dismissed_at timestamptz,
  result_dismissed_at timestamptz,
  source_id uuid,
  external_id text,
  source_updated_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete set null (team_id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete set null (source_id),
  check (status <> 'played' or (home_score is not null and away_score is not null))
);
create unique index fixtures_external_unique
  on public.fixtures (organization_id, source_id, external_id)
  where source_id is not null and external_id is not null;
create index fixtures_calendar_idx
  on public.fixtures (organization_id, department_id, kickoff_at);
create trigger set_fixtures_updated_at before update on public.fixtures for each row execute function public.set_updated_at();

-- 3. Veranstaltungen -------------------------------------------------------------------------------
create table public.club_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid,
  team_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  category text not null default 'other' check (category in
    ('general_meeting','festival','tournament','training_camp','course','social','fundraiser','ceremony','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location_name text,
  location_address text,
  registration_url text,
  status text not null default 'scheduled' check (status in ('scheduled','postponed','cancelled')),
  invitation_dismissed_at timestamptz,
  source_id uuid,
  external_id text,
  source_updated_at timestamptz,
  -- Bei Serien identifiziert UID nur die Serie. Die Instanz braucht RECURRENCE-ID bzw. die
  -- urspruengliche Startzeit, sonst kollabieren alle Einzeltermine einer Wiederholung auf
  -- denselben Schluessel.
  recurrence_key text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- department_id ist nullable (vereinsweite Veranstaltungen, z. B. eine Jahreshauptversammlung).
  -- Ein team_id ohne department_id wuerde die zusammengesetzte Fremdschluessel-Pruefung darunter
  -- unter MATCH SIMPLE trivial bestehen (NULL in einer FK-Spalte macht die Prüfung wirkungslos) --
  -- diese Check-Klausel schliesst genau diese Luecke.
  check (team_id is null or department_id is not null),
  -- Eigene organization_id-Referenz noetig: bei vereinsweiten Veranstaltungen (department_id
  -- null) greift die zusammengesetzte Fremdschluessel-Pruefung auf departments unten unter
  -- MATCH SIMPLE gar nicht (NULL in einer FK-Spalte macht die gesamte Klausel wirkungslos) --
  -- ohne diese Zeile waere organization_id fuer genau den vorgesehenen Hauptfall ungeprueft.
  foreign key (organization_id) references public.organizations(id) on delete cascade,
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete set null (team_id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete set null (source_id),
  check (ends_at is null or ends_at >= starts_at)
);
-- Dasselbe Muster wie fixtures_external_unique und teams_external_unique. Ohne diesen Index legt
-- jeder neue Lauf dieselbe Veranstaltung erneut an -- der Abgleich in planSync haette keinen
-- Schluessel, an dem er sie wiedererkennt.
create unique index club_events_external_unique
  on public.club_events (organization_id, source_id, external_id, coalesce(recurrence_key, ''))
  where source_id is not null and external_id is not null;
create index club_events_calendar_idx
  on public.club_events (organization_id, starts_at);
create trigger set_club_events_updated_at before update on public.club_events for each row execute function public.set_updated_at();

-- 4. Sichtbarkeit vereinsweit, Schreibzugriff wie directory_people/integration_sources ----------
-- fixtures/club_events sind unsensible, oeffentlichkeitsnahe Fakten (Ergebnisse, Termine) --
-- anders als directory_people. Wie bei posts/submissions seit Paket 023 gilt: jedes
-- Vereinsmitglied sieht alle Spiele/Veranstaltungen, nicht nur die der eigenen Abteilung.
alter table public.fixtures enable row level security;
alter table public.fixtures force row level security;
create policy fixtures_select on public.fixtures for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));

alter table public.club_events enable row level security;
alter table public.club_events force row level security;
create policy club_events_select on public.club_events for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));

-- Bewusst keine INSERT/UPDATE/DELETE-Policy fuer authenticated -- wie directory_people (Paket
-- 014): sowohl der Sync-Lauf als auch eine manuelle Korrektur laufen ueber die API mit Service
-- Role, die fixture.manage/event.manage im Code prueft (requirePermission/toPermissionScope).
-- Das vermeidet dieselbe Abteilungs-Scope-Falle, die in 014 als kritischer Fund behoben wurde,
-- und eine eigene security-definer-Helferfunktion ist dafuer nicht noetig: toPermissionScope
-- laesst departmentId bei null einfach weg, wodurch requirePermission fuer eine vereinsweite
-- club_events-Zeile automatisch nur die Organisationsebene prueft.
grant select on public.fixtures, public.club_events to authenticated;
grant all privileges on public.fixtures, public.club_events to service_role;

-- 5. Verknuepfung zum Inhalt: eine Einreichung kann aus einem Spiel oder einer Veranstaltung
-- entstehen, mit Herkunftsnachweis fuer die Vorbelegung ----------------------------------------
alter table public.submissions add column fixture_id uuid;
alter table public.submissions add column club_event_id uuid;
alter table public.submissions add constraint submissions_fixture_fk
  foreign key (organization_id, fixture_id) references public.fixtures(organization_id, id) on delete set null (fixture_id);
alter table public.submissions add constraint submissions_event_fk
  foreign key (organization_id, club_event_id) references public.club_events(organization_id, id) on delete set null (club_event_id);

alter table public.submissions
  add column source_provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_provenance) = 'object'),
  -- Stand der Quelle und unveraenderlicher Faktenschnappschuss zum Zeitpunkt der Vorbelegung.
  -- Beides zusammen macht "hat sich das geaendert?" beantwortbar. Heisst bewusst nicht
  -- "source_facts_snapshot" -- diesen Namen traegt bereits post_versions (unveraenderlicher
  -- Endstand einer veroeffentlichten Fassung, andere Bedeutung).
  add column source_revision_at timestamptz,
  add column source_prefill_snapshot jsonb
    check (source_prefill_snapshot is null or jsonb_typeof(source_prefill_snapshot) = 'object');

grant select (fixture_id, club_event_id, source_provenance, source_revision_at, source_prefill_snapshot)
  on public.submissions to authenticated;
-- source_provenance/source_revision_at/source_prefill_snapshot bleiben ausschliesslich lesbar:
-- der Herkunftsnachweis (Abschnitt 3 des Plans) wird beim Anlegen ueber die bestehende,
-- tabellenweite INSERT-Berechtigung (202608020003_api_grants.sql) gesetzt, serverseitig
-- hergeleitet (siehe POST /v1/submissions), nie vom Client uebernommen. Ein UPDATE-Zugriff fuer
-- authenticated wuerde diesen Nachweis nachtraeglich faelschbar machen.
grant update (fixture_id, club_event_id) on public.submissions to authenticated;

-- 6. Invalidierung offener Freigaben bei einer nachtraeglichen Quelleaenderung -------------------
-- Spiegelt invalidate_approvals_for_media_change (2026080030001_content_media_workflows_publishing.sql):
-- eine Aenderung an einem Fakt, der bereits vorbelegt wurde, invalidiert die Freigabe der davon
-- abhaengigen post_version, statt eine ueberholte Fassung stillschweigend freigegeben zu lassen.
create or replace function public.invalidate_approvals_for_fixture_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.approval_requests
  set invalidated_at = now()
  where invalidated_at is null
    and post_id in (
      select post.id from public.posts post
      join public.submissions submission on submission.id = post.submission_id
      where submission.fixture_id = new.id
    );
  return new;
end;
$$;
create trigger invalidate_approval_after_fixture_change after update on public.fixtures
  for each row when (
    old.kickoff_at is distinct from new.kickoff_at or old.opponent_name is distinct from new.opponent_name
    or old.is_home is distinct from new.is_home or old.venue_name is distinct from new.venue_name
    or old.status is distinct from new.status or old.home_score is distinct from new.home_score
    or old.away_score is distinct from new.away_score
  )
  execute function public.invalidate_approvals_for_fixture_change();

create or replace function public.invalidate_approvals_for_club_event_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.approval_requests
  set invalidated_at = now()
  where invalidated_at is null
    and post_id in (
      select post.id from public.posts post
      join public.submissions submission on submission.id = post.submission_id
      where submission.club_event_id = new.id
    );
  return new;
end;
$$;
create trigger invalidate_approval_after_club_event_change after update on public.club_events
  for each row when (
    old.starts_at is distinct from new.starts_at or old.location_name is distinct from new.location_name
    or old.title is distinct from new.title or old.status is distinct from new.status
  )
  execute function public.invalidate_approvals_for_club_event_change();

commit;
