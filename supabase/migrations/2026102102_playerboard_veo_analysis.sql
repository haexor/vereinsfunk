-- Spec 002, PR 1: Speicher fuer die Veo-Spielanalyse (specs/002-veo-analyse/data-model.md).
--
-- Der Worker holt je Spiel ein Analysepaket (Halbzeiten, Ereignisse beider Mannschaften,
-- Spieler-Heatmaps, Positionsdaten, Paesse und Ballbesitz, Spielverlauf, Passnetz, Spielbericht) und
-- schreibt es in einer Transaktion (playerboard_veo_apply_analysis) -- alles oder nichts je Paket,
-- getrennt von den Summenwerten aus Paket 053. Lesen duerfen alle, die die Kennzahlen der Mannschaft
-- sehen (authz.can_view_playerboard_stats, also stats_visibility); schreiben nur service_role.
-- Orte sind beim Schreiben normiert: die jeweilige Mannschaft greift Richtung x = 1 an, x und y in
-- [0, 1]. Positionsdaten bleiben roh je Spielfeldseite, die Zuordnung zu eigener Mannschaft und
-- Gegner folgt beim Lesen den aktuellen Halbzeiten (research.md R-05).

-- 1. Stand der Analyse je Spiel, Anforderung "Analyse neu laden" je Mannschaft ----------------------
alter table public.playerboard_veo_matches
  add column veo_match_slug text check (char_length(veo_match_slug) between 1 and 200),
  add column analysis_status text not null default 'none'
    check (analysis_status in ('none', 'pending', 'complete', 'unavailable')),
  add column analysis_fetched_at timestamptz;

alter table public.playerboard_veo_links
  add column analysis_refresh_requested_at timestamptz;

-- Werte je Halbzeit (Veo match_all_players): [{period, value}].
alter table public.playerboard_veo_player_stats
  add column period_values jsonb not null default '[]'::jsonb check (jsonb_typeof(period_values) = 'array');

-- 2. Tabellen ---------------------------------------------------------------------------------------
create table public.playerboard_veo_match_analysis (
  fixture_id uuid primary key,
  organization_id uuid not null,
  team_id uuid not null,
  analytics_version text not null check (analytics_version in ('1', '1.1', '2')),
  periods jsonb not null check (jsonb_typeof(periods) = 'array'),
  availability jsonb not null check (jsonb_typeof(availability) = 'object'),
  pass_possession jsonb check (pass_possession is null or jsonb_typeof(pass_possession) = 'array'),
  momentum jsonb check (momentum is null or jsonb_typeof(momentum) = 'array'),
  passing_network jsonb check (passing_network is null or jsonb_typeof(passing_network) = 'array'),
  report jsonb check (report is null or jsonb_typeof(report) = 'object'),
  fetched_at timestamptz not null default now(),
  foreign key (organization_id, team_id, fixture_id)
    references public.playerboard_veo_matches(organization_id, team_id, fixture_id) on delete cascade
);

create table public.playerboard_veo_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  team_id uuid not null,
  fixture_id uuid not null,
  veo_event_id text not null check (char_length(veo_event_id) between 1 and 200),
  team_association text not null check (team_association in ('own', 'opponent')),
  event_type text not null check (char_length(event_type) between 1 and 60),
  jersey_number integer check (jersey_number >= 0),
  period_number smallint not null check (period_number >= 1),
  period_time_ms integer not null check (period_time_ms >= 0),
  video_time_ms integer not null check (video_time_ms >= 0),
  x real check (x between 0 and 1),
  y real check (y between 0 and 1),
  end_x real check (end_x between 0 and 1),
  end_y real check (end_y between 0 and 1),
  outcome smallint,
  receiver_jersey_number integer check (receiver_jersey_number >= 0),
  assist_jersey_number integer check (assist_jersey_number >= 0),
  -- Ein Ort ist ganz oder gar nicht gesetzt (Ereignis ohne Ort).
  check ((x is null) = (y is null)),
  check ((end_x is null) = (end_y is null)),
  unique (fixture_id, veo_event_id),
  foreign key (organization_id, team_id, fixture_id)
    references public.playerboard_veo_matches(organization_id, team_id, fixture_id) on delete cascade
);
create index playerboard_veo_events_type_idx on public.playerboard_veo_events (organization_id, team_id, event_type);

-- Veo-Matrizen eigener Spieler; period_number 0 = ganzes Spiel. Bereits nach "leftToRight" gedreht.
create table public.playerboard_veo_heatmaps (
  organization_id uuid not null,
  team_id uuid not null,
  fixture_id uuid not null,
  jersey_number integer not null check (jersey_number >= 0),
  period_number smallint not null check (period_number >= 0),
  width smallint not null check (width between 1 and 200),
  height smallint not null check (height between 1 and 200),
  cells bytea not null,
  average_x real check (average_x between 0 and 1),
  average_y real check (average_y between 0 and 1),
  seconds_played integer check (seconds_played >= 0),
  primary key (fixture_id, jersey_number, period_number),
  check (octet_length(cells) = width * height),
  check ((average_x is null) = (average_y is null)),
  foreign key (organization_id, team_id, fixture_id)
    references public.playerboard_veo_matches(organization_id, team_id, fixture_id) on delete cascade
);

-- Positionsdaten je Veo-Spur, 1 Hz, x/y als uint16 in Kamerasicht (packages/domain veoPitch.ts).
create table public.playerboard_veo_tracks (
  organization_id uuid not null,
  team_id uuid not null,
  fixture_id uuid not null,
  veo_track_id integer not null check (veo_track_id >= 0),
  side text not null check (side in ('left', 'right')),
  goalkeeper boolean not null,
  jersey_number integer check (jersey_number >= 0),
  start_s integer not null check (start_s >= 0),
  samples bytea not null check (octet_length(samples) > 0 and octet_length(samples) % 4 = 0),
  primary key (fixture_id, veo_track_id),
  foreign key (organization_id, team_id, fixture_id)
    references public.playerboard_veo_matches(organization_id, team_id, fixture_id) on delete cascade
);

-- 3. RLS --------------------------------------------------------------------------------------------
do $$
declare table_name text;
begin
  foreach table_name in array array['playerboard_veo_match_analysis', 'playerboard_veo_events', 'playerboard_veo_heatmaps', 'playerboard_veo_tracks'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (authz.can_view_playerboard_stats(team_id))', table_name || '_select', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all privileges on public.%I to service_role', table_name);
  end loop;
end $$;

-- 4. Analysepaket schreiben -------------------------------------------------------------------------
-- p_analysis (geprueft im Worker, packages/contracts PlayerboardVeoAnalysisWriteSchema):
--   { veoMatchSlug, status, analyticsVersion, periods, availability, passPossession, momentum,
--     passingNetwork, report, events[], heatmaps[], tracks[] | null }
-- tracks = null laesst gespeicherte Positionsdaten stehen (sie werden einmal je Spiel geholt).
create or replace function public.playerboard_veo_apply_analysis(p_run_id uuid, p_fixture_veo_match_id text, p_analysis jsonb) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.integration_sync_runs;
  veo public.playerboard_veo_links;
  v_fixture_id uuid;
  v_status text := p_analysis->>'status';
begin
  select * into run_row from public.integration_sync_runs where id = p_run_id;
  if not found or run_row.status <> 'running' then
    raise exception 'sync_run_not_running' using errcode = '55000';
  end if;
  select * into veo from public.playerboard_veo_links where integration_source_id = run_row.source_id;
  if not found then raise exception 'veo_link_missing' using errcode = 'P0002'; end if;
  if v_status is null or v_status not in ('pending', 'complete', 'unavailable') then
    raise exception 'invalid_veo_analysis' using errcode = '22023';
  end if;

  select fixture_id into v_fixture_id from public.playerboard_veo_matches
   where team_id = veo.team_id and veo_match_id = p_fixture_veo_match_id;
  if v_fixture_id is null then return 'unknown_match'; end if;

  update public.playerboard_veo_matches
     set veo_match_slug = coalesce(nullif(p_analysis->>'veoMatchSlug', ''), veo_match_slug),
         analysis_status = v_status,
         analysis_fetched_at = now()
   where fixture_id = v_fixture_id;

  insert into public.playerboard_veo_match_analysis (
    fixture_id, organization_id, team_id, analytics_version, periods, availability,
    pass_possession, momentum, passing_network, report, fetched_at
  ) values (
    v_fixture_id, veo.organization_id, veo.team_id, coalesce(p_analysis->>'analyticsVersion', '1'),
    coalesce(p_analysis->'periods', '[]'::jsonb), coalesce(p_analysis->'availability', '{}'::jsonb),
    nullif(p_analysis->'passPossession', 'null'::jsonb), nullif(p_analysis->'momentum', 'null'::jsonb),
    nullif(p_analysis->'passingNetwork', 'null'::jsonb), nullif(p_analysis->'report', 'null'::jsonb), now()
  )
  on conflict (fixture_id) do update set
    analytics_version = excluded.analytics_version, periods = excluded.periods, availability = excluded.availability,
    pass_possession = excluded.pass_possession, momentum = excluded.momentum, passing_network = excluded.passing_network,
    report = excluded.report, fetched_at = excluded.fetched_at;

  delete from public.playerboard_veo_events where fixture_id = v_fixture_id;
  insert into public.playerboard_veo_events (
    organization_id, team_id, fixture_id, veo_event_id, team_association, event_type, jersey_number, period_number,
    period_time_ms, video_time_ms, x, y, end_x, end_y, outcome, receiver_jersey_number, assist_jersey_number
  )
  select veo.organization_id, veo.team_id, v_fixture_id, event."veoEventId", event."teamAssociation", event."eventType",
         event."jerseyNumber", event."periodNumber", event."periodTimeMs", event."videoTimeMs", event.x, event.y,
         event."endX", event."endY", event.outcome, event."receiverJerseyNumber", event."assistJerseyNumber"
    from jsonb_to_recordset(coalesce(p_analysis->'events', '[]'::jsonb)) as event(
      "veoEventId" text, "teamAssociation" text, "eventType" text, "jerseyNumber" integer, "periodNumber" smallint,
      "periodTimeMs" integer, "videoTimeMs" integer, x real, y real, "endX" real, "endY" real, outcome smallint,
      "receiverJerseyNumber" integer, "assistJerseyNumber" integer);

  delete from public.playerboard_veo_heatmaps where fixture_id = v_fixture_id;
  insert into public.playerboard_veo_heatmaps (
    organization_id, team_id, fixture_id, jersey_number, period_number, width, height, cells, average_x, average_y, seconds_played
  )
  select veo.organization_id, veo.team_id, v_fixture_id, heatmap."jerseyNumber", heatmap."periodNumber", heatmap.width,
         heatmap.height, decode(heatmap.cells, 'base64'), heatmap."averageX", heatmap."averageY", heatmap."secondsPlayed"
    from jsonb_to_recordset(coalesce(p_analysis->'heatmaps', '[]'::jsonb)) as heatmap(
      "jerseyNumber" integer, "periodNumber" smallint, width smallint, height smallint, cells text,
      "averageX" real, "averageY" real, "secondsPlayed" integer);

  if jsonb_typeof(p_analysis->'tracks') = 'array' then
    delete from public.playerboard_veo_tracks where fixture_id = v_fixture_id;
    insert into public.playerboard_veo_tracks (organization_id, team_id, fixture_id, veo_track_id, side, goalkeeper, jersey_number, start_s, samples)
    select veo.organization_id, veo.team_id, v_fixture_id, track."veoTrackId", track.side, track.goalkeeper,
           track."jerseyNumber", track."startS", decode(track.samples, 'base64')
      from jsonb_to_recordset(p_analysis->'tracks') as track(
        "veoTrackId" integer, side text, goalkeeper boolean, "jerseyNumber" integer, "startS" integer, samples text);
  end if;

  return 'written';
end;
$$;
revoke all on function public.playerboard_veo_apply_analysis(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.playerboard_veo_apply_analysis(uuid, text, jsonb) to service_role;

-- 5. Summenwerte mit Werten je Halbzeit ------------------------------------------------------------
-- Unveraendert aus 2026101301_playerboard_veo_views.sql bis auf period_values der Spielerwerte.
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
  v_all_candidates uuid[];
  v_resolution text;
  v_resolved_fixture uuid;
  v_resolved boolean := false;
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

  -- Paket 053 PR 3: ein vom Trainer aufgeloester Konflikt gilt vor der Heuristik. local_id = das
  -- gewaehlte Spiel, null = neues Spiel anlegen. Ist das gewaehlte Spiel inzwischen weg oder schon
  -- vergeben, greift wieder die Heuristik.
  v_fingerprint := 'veo:' || v_veo_match_id;
  if v_fixture_id is null then
    select conflict.resolution, conflict.local_id into v_resolution, v_resolved_fixture
      from public.integration_sync_conflicts conflict
     where conflict.organization_id = veo.organization_id and conflict.source_id = veo.integration_source_id
       and conflict.fingerprint = v_fingerprint and conflict.kind = 'ambiguous_match'
       and conflict.resolution in ('take_incoming', 'ignore_permanently')
     order by conflict.resolved_at desc nulls last
     limit 1;
    if v_resolution = 'ignore_permanently' then
      return 'ignored';
    end if;
    if v_resolution = 'take_incoming' and (
         v_resolved_fixture is null
         or exists (select 1 from public.fixtures chosen
                     where chosen.id = v_resolved_fixture and chosen.team_id = veo.team_id
                       and not exists (select 1 from public.playerboard_veo_matches mapped where mapped.fixture_id = chosen.id))) then
      v_fixture_id := v_resolved_fixture;
      v_resolved := true;
    end if;
  end if;

  if v_fixture_id is null and not v_resolved then
    select coalesce(array_agg(fixture.id order by fixture.kickoff_at), '{}') into v_candidates
      from public.fixtures fixture
     where fixture.organization_id = veo.organization_id
       and fixture.team_id = veo.team_id
       and fixture.status <> 'cancelled'
       and fixture.kickoff_at between v_start - interval '3 hours' and v_start + interval '3 hours'
       and (fixture.is_home is null or fixture.is_home = v_is_home)
       and not exists (select 1 from public.playerboard_veo_matches mapped where mapped.fixture_id = fixture.id);

    v_all_candidates := v_candidates;
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
        -- current_value: die Kandidaten fuer die Auswahl, incoming_value: der Veo-Start (UTC).
        'fixture', array_to_string(v_all_candidates, ','), to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ambiguous_match', v_fingerprint
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
  insert into public.playerboard_veo_player_stats (organization_id, team_id, fixture_id, assignment_id, stat_type, category, value, period_values)
  select veo.organization_id, veo.team_id, v_fixture_id, target.id, stat."statType", stat.category, stat.value,
         coalesce(stat."periodValues", '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_match->'players', '[]'::jsonb)) player
    join public.playerboard_veo_player_assignments target
      on target.fixture_id = v_fixture_id and target.veo_jersey_number = (player->>'jerseyNumber')::integer
   cross join lateral jsonb_to_recordset(coalesce(player->'stats', '[]'::jsonb))
        as stat("statType" text, category text, value numeric, "periodValues" jsonb);

  return v_outcome;
end;
$$;
revoke all on function public.playerboard_veo_apply_match(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.playerboard_veo_apply_match(uuid, jsonb) to service_role;
