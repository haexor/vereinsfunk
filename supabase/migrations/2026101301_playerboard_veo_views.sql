-- Paket 053, PR 3: Lesen, Korrigieren und oeffentliche Ausgabe der Veo-Werte.
--
-- Die Spiele einer Mannschaft kommen samt Mannschafts- und Spielerwerten als ein JSON aus einer
-- Funktion (statt vieler PostgREST-Abfragen mit 1000-Zeilen-Grenze). Intern mit Namen fuer alle,
-- die die Kennzahlen sehen; oeffentlich nur mit playerboard_public_label ("#7 M. K."), nicht
-- zugeordnete Nummern als "#7".

-- 1. Spiele mit Werten ------------------------------------------------------------------------------
-- public_labels = true ersetzt Spieler-ID, Name und Korrekturvermerk durch das oeffentliche Kuerzel.
create or replace function authz.playerboard_veo_matches_json(
  target_team_id uuid, from_date date, to_date date, public_labels boolean
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(match_json order by kickoff_at desc), '[]'::jsonb)
    from (
      select fixture.kickoff_at,
             -- Oeffentlich ohne Spiel-ID: der Schluessel faellt ganz weg, nicht nur sein Wert.
             jsonb_build_object(
               'fixtureId', fixture.id,
               'kickoffAt', fixture.kickoff_at,
               'opponentName', fixture.opponent_name,
               'isHome', fixture.is_home,
               'ownScore', case when fixture.is_home is false then fixture.away_score else fixture.home_score end,
               'opponentScore', case when fixture.is_home is false then fixture.home_score else fixture.away_score end,
               'teamStats', coalesce((
                 select jsonb_agg(jsonb_build_object('teamAssociation', stat.team_association, 'statType', stat.stat_type,
                                                     'category', stat.category, 'value', stat.value)
                                  order by stat.category, stat.stat_type, stat.team_association)
                   from public.playerboard_veo_match_stats stat
                  where stat.fixture_id = mapped.fixture_id), '[]'::jsonb),
               'players', coalesce((
                 select jsonb_agg(
                          case when public_labels then jsonb_build_object(
                            'jerseyNumber', assignment.veo_jersey_number,
                            'label', coalesce(public.playerboard_public_label(player.directory_person_id, assignment.veo_jersey_number),
                                              '#' || assignment.veo_jersey_number::text),
                            'stats', stats.items)
                          else jsonb_build_object(
                            'jerseyNumber', assignment.veo_jersey_number,
                            'playerId', assignment.player_id,
                            'name', case when person.id is null then null else concat_ws(' ', person.first_name, person.last_name) end,
                            'matchedManually', assignment.matched_manually,
                            'stats', stats.items)
                          end
                          order by assignment.veo_jersey_number)
                   from public.playerboard_veo_player_assignments assignment
                   left join public.playerboard_players player on player.id = assignment.player_id
                   left join public.directory_people person on person.id = player.directory_person_id
                   cross join lateral (
                     select coalesce(jsonb_agg(jsonb_build_object('statType', stat.stat_type, 'category', stat.category, 'value', stat.value)
                                               order by stat.stat_type), '[]'::jsonb) as items
                       from public.playerboard_veo_player_stats stat
                      where stat.assignment_id = assignment.id
                   ) stats
                  where assignment.fixture_id = mapped.fixture_id
                    -- Oeffentlich ohne Nummern, die gar keine Werte haben.
                    and (not public_labels or stats.items <> '[]'::jsonb)), '[]'::jsonb)
             ) - case when public_labels then 'fixtureId' else '' end as match_json
        from public.playerboard_veo_matches mapped
        join public.fixtures fixture on fixture.id = mapped.fixture_id
        join public.organizations organization on organization.id = mapped.organization_id
       where mapped.team_id = target_team_id
         and (from_date is null or (fixture.kickoff_at at time zone organization.timezone)::date >= from_date)
         and (to_date is null or (fixture.kickoff_at at time zone organization.timezone)::date <= to_date)
    ) matches;
$$;
revoke all on function authz.playerboard_veo_matches_json(uuid, date, date, boolean) from public;

-- Intern: wer die Kennzahlen der Mannschaft sieht (training.view oder stats_visibility).
create or replace function public.playerboard_veo_team_matches(target_team_id uuid, from_date date default null, to_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not authz.can_view_playerboard_stats(target_team_id) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  return authz.playerboard_veo_matches_json(target_team_id, from_date, to_date, false);
end;
$$;
revoke all on function public.playerboard_veo_team_matches(uuid, date, date) from public;
grant execute on function public.playerboard_veo_team_matches(uuid, date, date) to authenticated, service_role;

-- Oeffentlich: nur mit Schalter public_veo_stats_enabled und public_sharing_allowed entlang des Pfads.
create or replace function public.playerboard_public_veo_stats(org_slug text, team_slug text, from_date date default null, to_date date default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select authz.playerboard_veo_matches_json(team.team_id, from_date, to_date, true)
      from authz.playerboard_public_team(org_slug, team_slug) team
     where team.veo_stats_enabled
  ), '[]'::jsonb);
$$;
revoke all on function public.playerboard_public_veo_stats(text, text, date, date) from public;
grant execute on function public.playerboard_public_veo_stats(text, text, date, date) to service_role;

-- 2. Rueckennummer zuordnen -------------------------------------------------------------------------
-- Setzt die Zuordnung einer Nummer in einem Spiel (null = bewusst nicht zugeordnet) und markiert
-- sie als manuell, damit der Abgleich sie nie aendert. Auf Wunsch dieselbe Nummer in allen
-- anderen Spielen der Mannschaft, in denen sie noch offen ist und der Spieler noch frei ist.
-- Liefert die Zahl der geaenderten Zeilen.
create or replace function public.playerboard_veo_assign_jersey(
  p_fixture_id uuid, p_jersey_number integer, p_player_id uuid, p_apply_to_unassigned boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.playerboard_veo_player_assignments;
  changed integer;
  more integer := 0;
begin
  select * into target from public.playerboard_veo_player_assignments
   where fixture_id = p_fixture_id and veo_jersey_number = p_jersey_number;
  if not found then raise exception 'assignment_not_found' using errcode = 'P0002'; end if;
  if not authz.has_playerboard_team_permission(target.team_id, 'training.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if p_player_id is not null and not exists (
    select 1 from public.playerboard_players player
     where player.id = p_player_id and player.organization_id = target.organization_id and player.team_id = target.team_id
  ) then
    raise exception 'player_not_in_team' using errcode = '22023';
  end if;
  if p_player_id is not null and exists (
    select 1 from public.playerboard_veo_player_assignments other
     where other.fixture_id = p_fixture_id and other.player_id = p_player_id and other.id <> target.id
  ) then
    raise exception 'player_already_assigned' using errcode = '23505';
  end if;

  update public.playerboard_veo_player_assignments
     set player_id = p_player_id, matched_manually = true
   where id = target.id;
  get diagnostics changed = row_count;

  if p_apply_to_unassigned and p_player_id is not null then
    update public.playerboard_veo_player_assignments other
       set player_id = p_player_id, matched_manually = true
     where other.team_id = target.team_id
       and other.veo_jersey_number = p_jersey_number
       and other.fixture_id <> p_fixture_id
       and other.player_id is null
       and not other.matched_manually
       and not exists (select 1 from public.playerboard_veo_player_assignments taken
                        where taken.fixture_id = other.fixture_id and taken.player_id = p_player_id);
    get diagnostics more = row_count;
  end if;
  return changed + more;
end;
$$;
revoke all on function public.playerboard_veo_assign_jersey(uuid, integer, uuid, boolean) from public;
grant execute on function public.playerboard_veo_assign_jersey(uuid, integer, uuid, boolean) to authenticated;

-- 3. Mehrdeutiges Spiel aufloesen -------------------------------------------------------------------
-- p_action: 'fixture' = an p_fixture_id haengen, 'create' = neues Spiel anlegen, 'ignore' = dieses
-- Veo-Spiel dauerhaft auslassen. Wirkt beim naechsten Abgleich (playerboard_veo_apply_match).
-- Nur fuer die API (service_role); sie prueft playerboard.manage auf der Mannschaft.
create or replace function public.playerboard_veo_resolve_conflict(
  p_conflict_id uuid, p_action text, p_fixture_id uuid, p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conflict public.integration_sync_conflicts;
  veo public.playerboard_veo_links;
begin
  select * into conflict from public.integration_sync_conflicts where id = p_conflict_id for update;
  if not found or conflict.kind <> 'ambiguous_match' or conflict.resolution <> 'pending' then
    raise exception 'conflict_not_pending' using errcode = '55000';
  end if;
  select * into veo from public.playerboard_veo_links where integration_source_id = conflict.source_id;
  if not found then raise exception 'veo_link_missing' using errcode = 'P0002'; end if;

  if p_action = 'fixture' then
    if p_fixture_id is null or not exists (
      select 1 from public.fixtures fixture
       where fixture.id = p_fixture_id and fixture.organization_id = veo.organization_id and fixture.team_id = veo.team_id
         and not exists (select 1 from public.playerboard_veo_matches mapped where mapped.fixture_id = fixture.id)
    ) then
      raise exception 'fixture_not_available' using errcode = '22023';
    end if;
  elsif p_action not in ('create', 'ignore') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  update public.integration_sync_conflicts
     set resolution = case when p_action = 'ignore' then 'ignore_permanently' else 'take_incoming' end,
         local_id = case when p_action = 'fixture' then p_fixture_id end,
         resolved_by = p_user_id, resolved_at = now()
   where id = conflict.id;
end;
$$;
revoke all on function public.playerboard_veo_resolve_conflict(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.playerboard_veo_resolve_conflict(uuid, text, uuid, uuid) to service_role;

-- 4. Spiel schreiben: aufgeloeste Konflikte beachten, Kandidaten fuer die Auswahl merken ------------
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

