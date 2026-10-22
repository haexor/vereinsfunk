-- Spec 002, PR 5: Veo Analytics, Reiter "Spieler" (Nachbau von Veos Analytics Studio "Player stats",
-- specs/002-veo-analyse/veo-ui-inventory.md §2.1).
--
-- 1. authz.playerboard_veo_season_fixture_ids haelt die Filterregeln von Veo Analytics an einer Stelle:
--    Zeitraum, Spielart, die letzten n Spiele oder eine Einzelauswahl, die dann allein gilt.
--    playerboard_veo_team_season (PR 4) nutzt sie jetzt auch.
-- 2. playerboard_veo_player_season liefert je gefiltertem Spiel die Werte jeder Rueckennummer mit der
--    Zuordnung zum Spieler. Ranglisten, Saisontabelle und Spielervergleich rechnet packages/domain
--    (veoPlayers.ts), damit eine Regel an einer Stelle steht. Schuesse und Tore je Spieler kommen aus
--    playerboard_veo_team_season.
-- 3. playerboard_veo_player_heatmaps liefert die Veo-Matrizen eines Spielers (oder einer nicht
--    zugeordneten Rueckennummer) ueber die gefilterten Spiele mit den Spielsekunden als Gewicht.
--    Ein Spieler kann von Spiel zu Spiel eine andere Nummer tragen; massgeblich ist die Zuordnung.

-- 1. Filter ------------------------------------------------------------------------------------------
create or replace function authz.playerboard_veo_season_fixture_ids(
  target_team_id uuid,
  from_date date,
  to_date date,
  kinds text[],
  fixture_ids uuid[],
  last_n integer
) returns setof uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if last_n is not null and (last_n < 1 or last_n > 100) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  return query
    select mapped.fixture_id
      from public.playerboard_veo_matches mapped
      join public.fixtures fixture on fixture.id = mapped.fixture_id
      join public.organizations organization on organization.id = mapped.organization_id
     where mapped.team_id = target_team_id
       and (
         (fixture_ids is not null and mapped.fixture_id = any(fixture_ids))
         or (fixture_ids is null
             and (from_date is null or (fixture.kickoff_at at time zone organization.timezone)::date >= from_date)
             and (to_date is null or (fixture.kickoff_at at time zone organization.timezone)::date <= to_date)
             and (kinds is null or fixture.kind = any(kinds)))
       )
     order by fixture.kickoff_at desc
     limit case when fixture_ids is null then last_n end;
end;
$$;
revoke all on function authz.playerboard_veo_season_fixture_ids(uuid, date, date, text[], uuid[], integer) from public;

create or replace function public.playerboard_veo_team_season(
  target_team_id uuid,
  from_date date default null,
  to_date date default null,
  kinds text[] default null,
  fixture_ids uuid[] default null,
  last_n integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not authz.can_view_playerboard_stats(target_team_id) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  return (
    with filtered as (
      select mapped.fixture_id, mapped.veo_match_slug, mapped.analysis_status, fixture.kickoff_at, fixture.kind,
             fixture.opponent_name, fixture.is_home, fixture.home_score, fixture.away_score
        from authz.playerboard_veo_season_fixture_ids(target_team_id, from_date, to_date, kinds, fixture_ids, last_n) chosen(fixture_id)
        join public.playerboard_veo_matches mapped on mapped.fixture_id = chosen.fixture_id
        join public.fixtures fixture on fixture.id = mapped.fixture_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'fixtureId', match.fixture_id,
             'kickoffAt', match.kickoff_at,
             'kind', match.kind,
             'opponentName', match.opponent_name,
             'isHome', match.is_home,
             'ownScore', case when match.is_home is false then match.away_score else match.home_score end,
             'opponentScore', case when match.is_home is false then match.home_score else match.away_score end,
             'veoUrl', case when match.veo_match_slug is null then null else 'https://app.veo.co/matches/' || match.veo_match_slug || '/' end,
             'analysisStatus', match.analysis_status,
             'analyticsVersion', analysis.analytics_version,
             'periods', coalesce(analysis.periods, '[]'::jsonb),
             'availability', coalesce(analysis.availability, '{}'::jsonb),
             'teamStats', coalesce((
               select jsonb_agg(jsonb_build_object('teamAssociation', stat.team_association, 'statType', stat.stat_type,
                                                   'category', stat.category, 'value', stat.value, 'periodValues', stat.period_values)
                                order by stat.stat_type, stat.team_association)
                 from public.playerboard_veo_match_stats stat
                where stat.fixture_id = match.fixture_id), '[]'::jsonb),
             'passPossession', analysis.pass_possession,
             -- Nur Schuesse und Tore: die Schusskarte fuehrt beide zusammen (packages/domain shotsFromEvents).
             'shots', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', event.veo_event_id, 'teamAssociation', event.team_association, 'eventType', event.event_type,
                        'jerseyNumber', event.jersey_number, 'playerId', assignment.player_id,
                        'periodNumber', event.period_number, 'periodTimeMs', event.period_time_ms, 'videoTimeMs', event.video_time_ms,
                        'x', event.x, 'y', event.y, 'assistJerseyNumber', event.assist_jersey_number)
                      order by event.video_time_ms, event.veo_event_id)
                 from public.playerboard_veo_events event
                 left join public.playerboard_veo_player_assignments assignment
                   on event.team_association = 'own'
                  and assignment.fixture_id = event.fixture_id
                  and assignment.veo_jersey_number = event.jersey_number
                where event.fixture_id = match.fixture_id
                  and event.event_type in ('FootballShot', 'FootballGoal')), '[]'::jsonb)
           ) order by match.kickoff_at), '[]'::jsonb)
      from filtered match
      left join public.playerboard_veo_match_analysis analysis on analysis.fixture_id = match.fixture_id
  );
end;
$$;
revoke all on function public.playerboard_veo_team_season(uuid, date, date, text[], uuid[], integer) from public;
grant execute on function public.playerboard_veo_team_season(uuid, date, date, text[], uuid[], integer) to authenticated, service_role;

-- 2. Spielerwerte je Spiel ---------------------------------------------------------------------------
create or replace function public.playerboard_veo_player_season(
  target_team_id uuid,
  from_date date default null,
  to_date date default null,
  kinds text[] default null,
  fixture_ids uuid[] default null,
  last_n integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not authz.can_view_playerboard_stats(target_team_id) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fixtureId', mapped.fixture_id,
             'kickoffAt', fixture.kickoff_at,
             'opponentName', fixture.opponent_name,
             'ownScore', case when fixture.is_home is false then fixture.away_score else fixture.home_score end,
             'opponentScore', case when fixture.is_home is false then fixture.home_score else fixture.away_score end,
             'analyticsVersion', analysis.analytics_version,
             -- Werte als {statType: value}; die Halbzeitwerte braucht die Saison nicht.
             'players', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'jerseyNumber', assignment.veo_jersey_number,
                        'playerId', assignment.player_id,
                        'personId', player.directory_person_id,
                        'name', case when person.id is null then null else concat_ws(' ', person.first_name, person.last_name) end,
                        'stats', stats.items)
                      order by assignment.veo_jersey_number)
                 from public.playerboard_veo_player_assignments assignment
                 left join public.playerboard_players player on player.id = assignment.player_id
                 left join public.directory_people person on person.id = player.directory_person_id
                cross join lateral (
                  select jsonb_object_agg(stat.stat_type, stat.value) as items
                    from public.playerboard_veo_player_stats stat
                   where stat.assignment_id = assignment.id
                ) stats
                where assignment.fixture_id = mapped.fixture_id
                  and stats.items is not null), '[]'::jsonb)
           ) order by fixture.kickoff_at), '[]'::jsonb)
      from authz.playerboard_veo_season_fixture_ids(target_team_id, from_date, to_date, kinds, fixture_ids, last_n) chosen(fixture_id)
      join public.playerboard_veo_matches mapped on mapped.fixture_id = chosen.fixture_id
      join public.fixtures fixture on fixture.id = mapped.fixture_id
      left join public.playerboard_veo_match_analysis analysis on analysis.fixture_id = mapped.fixture_id
  );
end;
$$;
revoke all on function public.playerboard_veo_player_season(uuid, date, date, text[], uuid[], integer) from public;
grant execute on function public.playerboard_veo_player_season(uuid, date, date, text[], uuid[], integer) to authenticated, service_role;

-- 3. Heatmaps eines Spielers -------------------------------------------------------------------------
create or replace function public.playerboard_veo_player_heatmaps(
  target_team_id uuid,
  target_player_id uuid default null,
  target_jersey_number integer default null,
  from_date date default null,
  to_date date default null,
  kinds text[] default null,
  fixture_ids uuid[] default null,
  last_n integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not authz.can_view_playerboard_stats(target_team_id) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  -- Entweder ein Spieler der Mannschaft oder eine Rueckennummer ohne Zuordnung.
  if (target_player_id is null) = (target_jersey_number is null) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if target_player_id is not null and not exists (
    select 1 from public.playerboard_players player where player.id = target_player_id and player.team_id = target_team_id
  ) then
    raise exception 'veo_player_not_found' using errcode = 'P0002';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fixtureId', heatmap.fixture_id,
             'jerseyNumber', heatmap.jersey_number,
             'width', heatmap.width,
             'height', heatmap.height,
             'cells', authz.base64_line(heatmap.cells),
             'secondsPlayed', heatmap.seconds_played
           ) order by fixture.kickoff_at), '[]'::jsonb)
      from authz.playerboard_veo_season_fixture_ids(target_team_id, from_date, to_date, kinds, fixture_ids, last_n) chosen(fixture_id)
      join public.fixtures fixture on fixture.id = chosen.fixture_id
      join public.playerboard_veo_player_assignments assignment on assignment.fixture_id = chosen.fixture_id
      join public.playerboard_veo_heatmaps heatmap
        on heatmap.fixture_id = assignment.fixture_id
       and heatmap.jersey_number = assignment.veo_jersey_number
       and heatmap.period_number = 0
     where (target_player_id is not null and assignment.player_id = target_player_id)
        or (target_player_id is null and assignment.player_id is null and assignment.veo_jersey_number = target_jersey_number)
  );
end;
$$;
revoke all on function public.playerboard_veo_player_heatmaps(uuid, uuid, integer, date, date, text[], uuid[], integer) from public;
grant execute on function public.playerboard_veo_player_heatmaps(uuid, uuid, integer, date, date, text[], uuid[], integer) to authenticated, service_role;
