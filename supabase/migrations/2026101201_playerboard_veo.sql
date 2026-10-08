-- Paket 053, PR 2: Veo-Anbindung des PlayerBoards.
--
-- Eine Veo-Verbindung ist eine Integrationsquelle (provider_key 'veo', transport 'http', Bereich
-- fixtures) plus eine Zeile in playerboard_veo_links, die sie genau einer Mannschaft zuordnet. Das
-- Session-Cookie liegt verschluesselt in integration_source_secrets (SecretBox, AAD = Quellen-ID),
-- nie im Klartext und nie lesbar fuer authenticated. Der Abgleich laeuft im Worker
-- ('sync-integration-source'), ausgeloest ueber workflow_outbox; jedes Veo-Spiel wird in einer
-- Transaktion geschrieben (playerboard_veo_apply_match) -- alles oder nichts je Spiel.

-- 1. Verschluesselte Zugangsdaten einer Integrationsquelle ------------------------------------------
-- integration_sources.credentials_secret_id zeigt auf die Zeile (Paket 014: "unbenutzt bis
-- HTTP-Adapter"). Ohne Fremdschluessel in diese Richtung, weil bestehende Zeilen dort beliebige
-- Platzhalter tragen duerfen; die Gegenrichtung (source_id) loescht das Geheimnis mit der Quelle.
create table public.integration_source_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_id uuid not null,
  secret_ciphertext bytea not null,
  key_version text not null check (char_length(key_version) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id),
  unique (organization_id, id),
  foreign key (organization_id, source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);
alter table public.integration_source_secrets enable row level security;
alter table public.integration_source_secrets force row level security;
revoke all on public.integration_source_secrets from anon, authenticated;
grant all privileges on public.integration_source_secrets to service_role;

-- 2. Verbindung Mannschaft <-> Veo-Mannschaft -------------------------------------------------------
create table public.playerboard_veo_links (
  team_id uuid primary key,
  organization_id uuid not null,
  department_id uuid not null,
  integration_source_id uuid not null unique,
  veo_club_slug text not null check (char_length(veo_club_slug) between 1 and 200),
  veo_club_name text not null check (char_length(veo_club_name) between 1 and 200),
  veo_team_slug text not null check (char_length(veo_team_slug) between 1 and 200),
  veo_team_name text not null check (char_length(veo_team_name) between 1 and 200),
  -- Ersatz fuer playerboard veo_sync_status: Fehllaeufe in Folge, Grund des letzten und ob der
  -- Trainer schon benachrichtigt wurde (einmal je Fehlerserie, siehe playerboard_veo_finish_sync).
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error_code text check (char_length(last_error_code) <= 80),
  failure_notified_at timestamptz,
  linked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, integration_source_id)
    references public.integration_sources(organization_id, id) on delete cascade
);
create trigger set_playerboard_veo_links_updated_at before update on public.playerboard_veo_links
  for each row execute function public.set_updated_at();

-- 3. Veo-Spiel <-> Spielplan ------------------------------------------------------------------------
-- Eigene Zuordnung statt fixtures.external_id: ein vorhandenes iCal- oder Hand-Spiel behaelt seine
-- Quelle, bekommt aber Ergebnis und Werte aus Veo. Ohne diese Zeile faende der naechste Lauf es nur
-- erneut ueber die Zeit-Heuristik. Haengt an der Mannschaft, nicht an der Quelle: wer Veo neu
-- verbindet, findet dieselben Spiele wieder.
-- Ziel des zusammengesetzten Fremdschluessels unten: teams kannte bisher nur
-- (organization_id, department_id, id). Eindeutig ist (organization_id, id) ohnehin, weil id es ist.
alter table public.teams add constraint teams_organization_id_id_key unique (organization_id, id);

create table public.playerboard_veo_matches (
  fixture_id uuid primary key,
  organization_id uuid not null,
  team_id uuid not null,
  veo_match_id text not null check (char_length(veo_match_id) between 1 and 200),
  veo_team_id text not null check (char_length(veo_team_id) between 1 and 200),
  synced_at timestamptz not null default now(),
  unique (team_id, veo_match_id),
  unique (organization_id, team_id, fixture_id),
  foreign key (organization_id, fixture_id) references public.fixtures(organization_id, id) on delete cascade,
  foreign key (organization_id, team_id) references public.teams(organization_id, id) on delete cascade
);
create index playerboard_veo_matches_team_idx on public.playerboard_veo_matches (organization_id, team_id);

create table public.playerboard_veo_match_stats (
  organization_id uuid not null,
  team_id uuid not null,
  fixture_id uuid not null,
  team_association text not null check (team_association in ('own', 'opponent')),
  stat_type text not null check (char_length(stat_type) between 1 and 120),
  category text not null check (char_length(category) between 1 and 120),
  value numeric not null,
  period_values jsonb not null check (jsonb_typeof(period_values) = 'array'),
  primary key (fixture_id, team_association, stat_type),
  foreign key (organization_id, team_id, fixture_id)
    references public.playerboard_veo_matches(organization_id, team_id, fixture_id) on delete cascade
);

-- Zuordnung einer Veo-Rueckennummer zum Kader, je Spiel. player_id null = nicht zugeordnet.
-- matched_manually = vom Trainer gesetzt; der Abgleich aendert solche Zeilen nie.
alter table public.playerboard_players
  add constraint playerboard_players_team_id_unique unique (organization_id, team_id, id);

create table public.playerboard_veo_player_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_id uuid not null,
  fixture_id uuid not null,
  veo_jersey_number integer not null check (veo_jersey_number >= 0),
  player_id uuid,
  matched_manually boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (fixture_id, veo_jersey_number),
  -- Ein Kader-Eintrag hat je Spiel hoechstens eine Rueckennummer; null mehrfach erlaubt.
  unique (fixture_id, player_id),
  unique (organization_id, team_id, fixture_id, id),
  foreign key (organization_id, team_id, fixture_id)
    references public.playerboard_veo_matches(organization_id, team_id, fixture_id) on delete cascade,
  -- Nur Spieler derselben Mannschaft; Loeschen aus dem Kader macht die Nummer wieder unzugeordnet.
  foreign key (organization_id, team_id, player_id)
    references public.playerboard_players(organization_id, team_id, id) on delete set null (player_id)
);
create trigger set_playerboard_veo_player_assignments_updated_at before update on public.playerboard_veo_player_assignments
  for each row execute function public.set_updated_at();

create table public.playerboard_veo_player_stats (
  organization_id uuid not null,
  team_id uuid not null,
  fixture_id uuid not null,
  assignment_id uuid not null,
  stat_type text not null check (char_length(stat_type) between 1 and 120),
  category text not null check (char_length(category) between 1 and 120),
  value numeric not null,
  primary key (assignment_id, stat_type),
  foreign key (organization_id, team_id, fixture_id, assignment_id)
    references public.playerboard_veo_player_assignments(organization_id, team_id, fixture_id, id) on delete cascade
);
create index playerboard_veo_player_stats_fixture_idx on public.playerboard_veo_player_stats (organization_id, fixture_id);

-- 4. RLS -------------------------------------------------------------------------------------------
do $$
declare table_name text;
begin
  foreach table_name in array array['playerboard_veo_links', 'playerboard_veo_matches', 'playerboard_veo_match_stats',
                                    'playerboard_veo_player_assignments', 'playerboard_veo_player_stats'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

-- Verbindungsstatus (Veo-Mannschaft, Fehllaeufe) fuer die Mannschaft; nichts davon ist geheim.
create policy playerboard_veo_links_select on public.playerboard_veo_links for select to authenticated
  using (authz.has_playerboard_team_permission(team_id, 'training.view'));
-- Werte wie die uebrigen Kennzahlen: training.view oder die wirksame stats_visibility.
create policy playerboard_veo_matches_select on public.playerboard_veo_matches for select to authenticated
  using (authz.can_view_playerboard_stats(team_id));
create policy playerboard_veo_match_stats_select on public.playerboard_veo_match_stats for select to authenticated
  using (authz.can_view_playerboard_stats(team_id));
create policy playerboard_veo_player_assignments_select on public.playerboard_veo_player_assignments for select to authenticated
  using (authz.can_view_playerboard_stats(team_id));
create policy playerboard_veo_player_assignments_update on public.playerboard_veo_player_assignments for update to authenticated
  using (authz.has_playerboard_team_permission(team_id, 'training.manage'))
  with check (authz.has_playerboard_team_permission(team_id, 'training.manage'));
create policy playerboard_veo_player_stats_select on public.playerboard_veo_player_stats for select to authenticated
  using (authz.can_view_playerboard_stats(team_id));

revoke all on public.playerboard_veo_links, public.playerboard_veo_matches, public.playerboard_veo_match_stats,
  public.playerboard_veo_player_assignments, public.playerboard_veo_player_stats from anon, authenticated;
grant select on public.playerboard_veo_links, public.playerboard_veo_matches, public.playerboard_veo_match_stats,
  public.playerboard_veo_player_assignments, public.playerboard_veo_player_stats to authenticated;
grant update (player_id, matched_manually) on public.playerboard_veo_player_assignments to authenticated;
grant all privileges on public.playerboard_veo_links, public.playerboard_veo_matches, public.playerboard_veo_match_stats,
  public.playerboard_veo_player_assignments, public.playerboard_veo_player_stats to service_role;

-- 5. Verbinden --------------------------------------------------------------------------------------
-- Legt Quelle, Geheimnis und Verbindung in einer Transaktion an oder ersetzt sie (neu verbinden).
-- Die API waehlt die Quellen-ID vorher (bestehende oder neue), weil das Cookie mit ihr als AAD
-- versiegelt wird; aendert sich die Verbindung dazwischen, schlaegt der Aufruf fehl.
create or replace function public.playerboard_veo_link_team(
  p_team_id uuid, p_source_id uuid, p_secret_ciphertext bytea, p_key_version text,
  p_veo_club_slug text, p_veo_club_name text, p_veo_team_slug text, p_veo_team_name text, p_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  team_row public.teams;
  existing public.playerboard_veo_links;
  secret_id uuid;
  linked_team_id uuid;
begin
  select * into team_row from public.teams where id = p_team_id;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;

  select * into existing from public.playerboard_veo_links where team_id = p_team_id for update;
  if found and existing.integration_source_id <> p_source_id then
    raise exception 'veo_link_changed' using errcode = '40001';
  end if;

  if not found then
    insert into public.integration_sources (
      id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, sync_cron, created_by
    ) values (
      p_source_id, team_row.organization_id, 'http', 'veo', left('Veo · ' || team_row.name, 160),
      array['fixtures']::public.integration_domain[], team_row.department_id, '0 5 * * *', p_user_id
    );
  end if;

  insert into public.integration_source_secrets (organization_id, source_id, secret_ciphertext, key_version)
  values (team_row.organization_id, p_source_id, p_secret_ciphertext, p_key_version)
  on conflict (source_id) do update
    set secret_ciphertext = excluded.secret_ciphertext, key_version = excluded.key_version, updated_at = now()
  returning id into secret_id;

  update public.integration_sources
     set credentials_secret_id = secret_id, enabled = true, updated_at = now()
   where id = p_source_id;

  insert into public.playerboard_veo_links (
    team_id, organization_id, department_id, integration_source_id,
    veo_club_slug, veo_club_name, veo_team_slug, veo_team_name, linked_by
  ) values (
    p_team_id, team_row.organization_id, team_row.department_id, p_source_id,
    p_veo_club_slug, p_veo_club_name, p_veo_team_slug, p_veo_team_name, p_user_id
  )
  on conflict (team_id) do update set
    veo_club_slug = excluded.veo_club_slug, veo_club_name = excluded.veo_club_name,
    veo_team_slug = excluded.veo_team_slug, veo_team_name = excluded.veo_team_name,
    linked_by = excluded.linked_by, consecutive_failures = 0, last_error_code = null, failure_notified_at = null
    where playerboard_veo_links.integration_source_id = excluded.integration_source_id
  returning team_id into linked_team_id;

  if linked_team_id is null then
    raise exception 'veo_link_changed' using errcode = '40001';
  end if;

  return p_source_id;
end;
$$;
revoke all on function public.playerboard_veo_link_team(uuid, uuid, bytea, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.playerboard_veo_link_team(uuid, uuid, bytea, text, text, text, text, text, uuid) to service_role;

-- 6. Lauf einreihen ---------------------------------------------------------------------------------
-- Belegt den serialisierten Lauf-Slot (Paket 026) und reiht im selben Zug den Worker-Auftrag ein;
-- der Auftrag traegt nur die Lauf-ID. Fuer API (manuell) und den taeglichen Plan gleichermassen.
create or replace function public.enqueue_integration_sync(
  target_organization_id uuid, target_source_id uuid, target_request_idempotency_key text,
  target_correlation_id uuid, target_triggered_by uuid
) returns table(result text, run_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_row public.integration_sources;
  acquired record;
begin
  select * into source_row from public.integration_sources
   where id = target_source_id and organization_id = target_organization_id;
  if not found then
    raise exception 'integration source does not belong to organization' using errcode = 'P0002';
  end if;
  if source_row.transport <> 'http' or source_row.department_id is null then
    raise exception 'source_not_queueable' using errcode = '22023';
  end if;
  if not source_row.enabled then
    raise exception 'source_disabled' using errcode = '22023';
  end if;

  select * into acquired from public.acquire_integration_sync_run(
    target_organization_id, target_source_id, 'fixtures', 'apply',
    target_request_idempotency_key, target_correlation_id, target_triggered_by
  );

  if acquired.result = 'acquired' then
    insert into public.workflow_outbox (
      organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
    ) values (
      target_organization_id, source_row.department_id, 'sync-integration-source', acquired.run_id, 1, 'default',
      target_correlation_id,
      jsonb_build_object(
        'entityId', acquired.run_id, 'organizationId', target_organization_id,
        'departmentId', source_row.department_id, 'departmentConcurrencyKey', source_row.department_id::text,
        'correlationId', target_correlation_id, 'sourceRevision', 1, 'purpose', 'default',
        'idempotencyKey', 'integration-sync:' || acquired.run_id::text
      )
    );
  end if;

  return query select acquired.result::text, acquired.run_id::uuid;
end;
$$;
revoke all on function public.enqueue_integration_sync(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_integration_sync(uuid, uuid, text, uuid, uuid) to service_role;

-- Taeglicher Abgleich aller Veo-Verbindungen (Worker-Cron). Gibt haengende Laeufe nach zwei Stunden
-- frei (Worker abgestuerzt, alle Wiederholungen verbraucht) und laesst Verbindungen aus, die neu
-- verbunden werden muessen. Ein Schluessel je Kalendertag macht doppelte Cron-Ticks harmlos.
create or replace function public.playerboard_veo_enqueue_scheduled_syncs() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  due record;
  enqueued integer := 0;
  outcome record;
begin
  update public.integration_sync_runs run
     set status = 'failed', error_class = 'stale_run', finished_at = now()
    from public.playerboard_veo_links veo
   where run.source_id = veo.integration_source_id
     and run.status = 'running'
     and run.started_at < now() - interval '2 hours';

  for due in
    select veo.organization_id, veo.integration_source_id
      from public.playerboard_veo_links veo
      join public.integration_sources source on source.id = veo.integration_source_id
     where source.enabled
       and veo.last_error_code is distinct from 'auth_expired'
       and authz.module_enabled(veo.organization_id, veo.department_id, veo.team_id, 'playerboard')
  loop
    select * into outcome from public.enqueue_integration_sync(
      due.organization_id, due.integration_source_id,
      'schedule:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), gen_random_uuid(), null
    );
    if outcome.result = 'acquired' then enqueued := enqueued + 1; end if;
  end loop;
  return enqueued;
end;
$$;
revoke all on function public.playerboard_veo_enqueue_scheduled_syncs() from public, anon, authenticated;
grant execute on function public.playerboard_veo_enqueue_scheduled_syncs() to service_role;

-- 7. Ein Veo-Spiel schreiben ------------------------------------------------------------------------
-- Eine Transaktion je Spiel: Spielplan, Zuordnung, Mannschafts- und Spielerwerte. Der Worker ruft
-- sie erst auf, wenn alle Werte des Spiels abgerufen sind.
--
-- Spielplan: erst die eigene Zuordnung, dann ein von dieser Quelle angelegtes Spiel, sonst ein
-- vorhandenes Spiel derselben Mannschaft +-3 h um den Veo-Start (Heim/Auswaerts passend). Bei
-- mehreren Kandidaten entscheidet der Gegnername; bleibt es mehrdeutig, entsteht ein Konflikt und
-- das Spiel wird in diesem Lauf nicht geschrieben. Ohne Kandidat entsteht ein neues Spiel.
-- Ein fremdes Spiel (andere Quelle oder von Hand) bekommt nur ein fehlendes Ergebnis, Stammdaten
-- und ein eingetragenes Ergebnis bleiben unangetastet.
--
-- Rueckennummern: vorhandene Zuordnungen bleiben; offene, nicht von Hand gesetzte werden gegen den
-- aktiven Kader derselben Mannschaft geprueft (genau ein Treffer, noch nicht vergeben).
create or replace function public.playerboard_veo_apply_match(p_run_id uuid, p_match jsonb) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.integration_sync_runs;
  veo public.playerboard_veo_links;
  org_timezone text;
  v_veo_match_id text := p_match->>'veoMatchId';
  v_veo_team_id text := p_match->>'veoTeamId';
  v_start timestamptz := (p_match->>'start')::timestamptz;
  v_opponent text := nullif(btrim(p_match->>'opponentName'), '');
  v_is_home boolean := (p_match->>'isHome')::boolean;
  v_own integer := (p_match->>'ownScore')::integer;
  v_other integer := (p_match->>'opponentScore')::integer;
  v_home integer;
  v_away integer;
  v_fixture public.fixtures;
  v_fixture_id uuid;
  v_candidates uuid[];
  v_named uuid[];
  v_fingerprint text;
  v_outcome text := 'updated';
  assignment record;
begin
  select * into run_row from public.integration_sync_runs where id = p_run_id;
  if not found or run_row.status <> 'running' then
    raise exception 'sync_run_not_running' using errcode = '55000';
  end if;
  select * into veo from public.playerboard_veo_links where integration_source_id = run_row.source_id;
  if not found then raise exception 'veo_link_missing' using errcode = 'P0002'; end if;
  if v_veo_match_id is null or v_veo_team_id is null or v_start is null or v_is_home is null then
    raise exception 'invalid_veo_match' using errcode = '22023';
  end if;
  if (v_own is null) <> (v_other is null) then
    raise exception 'invalid_veo_match' using errcode = '22023';
  end if;
  v_home := case when v_is_home then v_own else v_other end;
  v_away := case when v_is_home then v_other else v_own end;

  select fixture_id into v_fixture_id from public.playerboard_veo_matches
   where team_id = veo.team_id and veo_match_id = v_veo_match_id;

  if v_fixture_id is null then
    select id into v_fixture_id from public.fixtures
     where organization_id = veo.organization_id and source_id = veo.integration_source_id and external_id = v_veo_match_id;
  end if;

  if v_fixture_id is null then
    select coalesce(array_agg(fixture.id order by fixture.kickoff_at), '{}') into v_candidates
      from public.fixtures fixture
     where fixture.organization_id = veo.organization_id
       and fixture.team_id = veo.team_id
       and fixture.status <> 'cancelled'
       and fixture.kickoff_at between v_start - interval '3 hours' and v_start + interval '3 hours'
       and (fixture.is_home is null or fixture.is_home = v_is_home)
       and not exists (select 1 from public.playerboard_veo_matches mapped where mapped.fixture_id = fixture.id);

    if cardinality(v_candidates) > 1 and v_opponent is not null then
      select coalesce(array_agg(fixture.id), '{}') into v_named
        from public.fixtures fixture
       where fixture.id = any(v_candidates)
         and fixture.opponent_name is not null
         and (position(regexp_replace(lower(fixture.opponent_name), '[^[:alnum:]]', '', 'g') in regexp_replace(lower(v_opponent), '[^[:alnum:]]', '', 'g')) > 0
           or position(regexp_replace(lower(v_opponent), '[^[:alnum:]]', '', 'g') in regexp_replace(lower(fixture.opponent_name), '[^[:alnum:]]', '', 'g')) > 0);
      v_candidates := v_named;
    end if;

    if cardinality(v_candidates) = 1 then
      v_fixture_id := v_candidates[1];
    elsif cardinality(v_candidates) > 1 or (v_named is not null and cardinality(v_named) = 0) then
      v_fingerprint := 'veo:' || v_veo_match_id;
      if exists (select 1 from public.integration_sync_conflicts
                  where organization_id = veo.organization_id and source_id = veo.integration_source_id
                    and fingerprint = v_fingerprint and resolution = 'ignore_permanently') then
        return 'ignored';
      end if;
      if exists (select 1 from public.integration_sync_conflicts
                  where organization_id = veo.organization_id and source_id = veo.integration_source_id
                    and fingerprint = v_fingerprint and resolution = 'pending') then
        return 'conflict';
      end if;
      select timezone into org_timezone from public.organizations where id = veo.organization_id;
      insert into public.integration_sync_conflicts (
        organization_id, sync_run_id, source_id, domain, external_id, label, field, current_value, incoming_value, kind, fingerprint
      ) values (
        veo.organization_id, p_run_id, veo.integration_source_id, 'fixtures', v_veo_match_id,
        left(coalesce(v_opponent, 'Veo-Spiel') || ' am ' || to_char(v_start at time zone coalesce(org_timezone, 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI'), 200),
        'fixture', null, v_veo_match_id, 'ambiguous_match', v_fingerprint
      );
      return 'conflict';
    end if;
  end if;

  if v_fixture_id is null then
    insert into public.fixtures (
      organization_id, department_id, team_id, kind, is_home, opponent_name, kickoff_at, kickoff_time_confirmed,
      status, home_score, away_score, result_recorded_at, source_id, external_id, source_updated_at
    ) values (
      veo.organization_id, veo.department_id, veo.team_id, 'match', v_is_home, v_opponent, v_start, true,
      case when v_own is null then 'unknown' else 'played' end::public.fixture_status,
      v_home, v_away, case when v_own is null then null else now() end,
      veo.integration_source_id, v_veo_match_id, now()
    ) returning id into v_fixture_id;
    v_outcome := 'created';
  else
    select * into v_fixture from public.fixtures where id = v_fixture_id;
    if v_fixture.source_id is not distinct from veo.integration_source_id then
      update public.fixtures
         set is_home = v_is_home, opponent_name = v_opponent, kickoff_at = v_start,
             status = case when v_own is null then status else 'played' end,
             home_score = coalesce(v_home, home_score), away_score = coalesce(v_away, away_score),
             result_recorded_at = case when v_own is not null and (home_score is distinct from v_home or away_score is distinct from v_away)
                                       then now() else result_recorded_at end,
             source_updated_at = now()
       where id = v_fixture_id
         and (is_home is distinct from v_is_home or opponent_name is distinct from v_opponent
              or kickoff_at is distinct from v_start
              or (v_own is not null and (home_score is distinct from v_home or away_score is distinct from v_away
                                         or status <> 'played')));
    elsif v_own is not null and v_fixture.home_score is null and v_fixture.away_score is null then
      update public.fixtures
         set home_score = v_home, away_score = v_away, status = 'played', result_recorded_at = now()
       where id = v_fixture_id;
    end if;
  end if;

  insert into public.playerboard_veo_matches (fixture_id, organization_id, team_id, veo_match_id, veo_team_id)
  values (v_fixture_id, veo.organization_id, veo.team_id, v_veo_match_id, v_veo_team_id)
  on conflict (fixture_id) do update set veo_team_id = excluded.veo_team_id, synced_at = now();

  delete from public.playerboard_veo_match_stats where fixture_id = v_fixture_id;
  insert into public.playerboard_veo_match_stats (organization_id, team_id, fixture_id, team_association, stat_type, category, value, period_values)
  select veo.organization_id, veo.team_id, v_fixture_id, stat."teamAssociation", stat."statType", stat.category, stat.value,
         coalesce(stat."periodValues", '[]'::jsonb)
    from jsonb_to_recordset(coalesce(p_match->'teamStats', '[]'::jsonb))
         as stat("teamAssociation" text, "statType" text, category text, value numeric, "periodValues" jsonb);

  delete from public.playerboard_veo_player_assignments existing
   where existing.fixture_id = v_fixture_id
     and existing.veo_jersey_number not in (
       select (player->>'jerseyNumber')::integer from jsonb_array_elements(coalesce(p_match->'players', '[]'::jsonb)) player
     );
  insert into public.playerboard_veo_player_assignments (organization_id, team_id, fixture_id, veo_jersey_number)
  select veo.organization_id, veo.team_id, v_fixture_id, (player->>'jerseyNumber')::integer
    from jsonb_array_elements(coalesce(p_match->'players', '[]'::jsonb)) player
  on conflict (fixture_id, veo_jersey_number) do nothing;

  for assignment in
    select id, veo_jersey_number from public.playerboard_veo_player_assignments
     where fixture_id = v_fixture_id and player_id is null and not matched_manually
     order by veo_jersey_number
  loop
    update public.playerboard_veo_player_assignments target
       set player_id = candidate.id
      from (
        select roster.id
          from public.playerboard_players roster
         where roster.organization_id = veo.organization_id and roster.team_id = veo.team_id
           and roster.active and roster.jersey_number = assignment.veo_jersey_number
      ) candidate
     where target.id = assignment.id
       and (select count(*) from public.playerboard_players roster
             where roster.organization_id = veo.organization_id and roster.team_id = veo.team_id
               and roster.active and roster.jersey_number = assignment.veo_jersey_number) = 1
       and not exists (select 1 from public.playerboard_veo_player_assignments taken
                        where taken.fixture_id = v_fixture_id and taken.player_id = candidate.id);
  end loop;

  delete from public.playerboard_veo_player_stats where fixture_id = v_fixture_id;
  insert into public.playerboard_veo_player_stats (organization_id, team_id, fixture_id, assignment_id, stat_type, category, value)
  select veo.organization_id, veo.team_id, v_fixture_id, target.id, stat."statType", stat.category, stat.value
    from jsonb_array_elements(coalesce(p_match->'players', '[]'::jsonb)) player
    join public.playerboard_veo_player_assignments target
      on target.fixture_id = v_fixture_id and target.veo_jersey_number = (player->>'jerseyNumber')::integer
   cross join lateral jsonb_to_recordset(coalesce(player->'stats', '[]'::jsonb)) as stat("statType" text, category text, value numeric);

  return v_outcome;
end;
$$;
revoke all on function public.playerboard_veo_apply_match(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.playerboard_veo_apply_match(uuid, jsonb) to service_role;

-- 8. Lauf abschliessen ------------------------------------------------------------------------------
-- Schliesst einen noch laufenden Lauf ab, fuehrt die Fehlerserie der Verbindung und sagt dem
-- Worker, ob er den Trainer jetzt benachrichtigen soll: einmal ab dem dritten Fehllauf in Folge,
-- erneut erst nach einem erfolgreichen Lauf. Ein bereits beendeter (z. B. abgebrochener) Lauf
-- bleibt unveraendert, die Funktion liefert dann keine Zeile.
create or replace function public.playerboard_veo_finish_sync(
  p_run_id uuid, p_status text, p_error_class text,
  p_created integer, p_updated integer, p_skipped integer, p_conflicts integer
) returns table(team_id uuid, consecutive_failures integer, notify boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  run_row public.integration_sync_runs;
  link_row public.playerboard_veo_links;
  should_notify boolean;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid sync status' using errcode = '22023';
  end if;
  update public.integration_sync_runs
     set status = p_status, error_class = p_error_class, finished_at = now(),
         created_count = p_created, updated_count = p_updated, skipped_count = p_skipped, conflict_count = p_conflicts
   where id = p_run_id and status = 'running'
  returning * into run_row;
  if not found then return; end if;

  update public.integration_sources
     set last_sync_at = now(), last_sync_status = p_status, updated_at = now()
   where id = run_row.source_id;

  if p_status = 'succeeded' then
    update public.playerboard_veo_links
       set consecutive_failures = 0, last_error_code = null, failure_notified_at = null
     where integration_source_id = run_row.source_id
    returning * into link_row;
    should_notify := false;
  else
    update public.playerboard_veo_links
       set consecutive_failures = playerboard_veo_links.consecutive_failures + 1, last_error_code = left(p_error_class, 80)
     where integration_source_id = run_row.source_id
    returning * into link_row;
    should_notify := link_row.consecutive_failures >= 3 and link_row.failure_notified_at is null;
    if should_notify then
      update public.playerboard_veo_links set failure_notified_at = now() where playerboard_veo_links.team_id = link_row.team_id;
    end if;
  end if;
  if link_row.team_id is null then return; end if;

  return query select link_row.team_id, link_row.consecutive_failures, should_notify;
end;
$$;
revoke all on function public.playerboard_veo_finish_sync(uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.playerboard_veo_finish_sync(uuid, text, text, integer, integer, integer, integer) to service_role;
