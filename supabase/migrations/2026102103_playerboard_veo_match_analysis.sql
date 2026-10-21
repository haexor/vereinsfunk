-- Spec 002, PR 2: Spielauswertung lesen (specs/002-veo-analyse/contracts/veo-analysis.md).
--
-- Eine Funktion liefert alles, was die Spielauswertung eines Spiels braucht, als ein JSON: Kopf,
-- Halbzeiten, Verfuegbarkeit je Teil, Mannschafts- und Spielerwerte je Halbzeit, Ereignisse beider
-- Mannschaften, Spieler-Matrizen, Paesse und Ballbesitz, Spielverlauf und Passnetz. Die
-- Positionsdaten kommen getrennt, weil sie gross sind und nur der Schieber der Heatmap sie braucht.
-- Beide pruefen vorab authz.can_view_playerboard_stats (stats_visibility) und liefern null, wenn das
-- Spiel nicht zu dieser Mannschaft gehoert oder unbekannt ist -- die API macht daraus dasselbe 404.
-- Spieler kommen wie bei den Summenwerten ueber die aktuelle Zuordnung der Rueckennummer, nur fuer
-- die eigene Mannschaft; Gegnerereignisse tragen nie einen Bezug zum Kader (FR-064).

-- encode(..., 'base64') bricht nach 76 Zeichen um; JSON-Werte brauchen eine Zeile.
create or replace function authz.base64_line(value bytea) returns text
language sql
immutable
set search_path = pg_catalog
as $$ select translate(encode(value, 'base64'), E'\n', '') $$;
revoke all on function authz.base64_line(bytea) from public;

create or replace function public.playerboard_veo_match_analysis(target_team_id uuid, target_fixture_id uuid)
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
  return (
    select jsonb_build_object(
      'fixtureId', fixture.id,
      'kickoffAt', fixture.kickoff_at,
      'opponentName', fixture.opponent_name,
      'isHome', fixture.is_home,
      'ownScore', case when fixture.is_home is false then fixture.away_score else fixture.home_score end,
      'opponentScore', case when fixture.is_home is false then fixture.home_score else fixture.away_score end,
      'veoUrl', case when mapped.veo_match_slug is null then null else 'https://app.veo.co/matches/' || mapped.veo_match_slug || '/' end,
      'analysisStatus', mapped.analysis_status,
      'analyticsVersion', analysis.analytics_version,
      'periods', coalesce(analysis.periods, '[]'::jsonb),
      'availability', coalesce(analysis.availability, '{}'::jsonb),
      'teamStats', coalesce((
        select jsonb_agg(jsonb_build_object('teamAssociation', stat.team_association, 'statType', stat.stat_type,
                                            'category', stat.category, 'value', stat.value, 'periodValues', stat.period_values)
                         order by stat.category, stat.stat_type, stat.team_association)
          from public.playerboard_veo_match_stats stat
         where stat.fixture_id = mapped.fixture_id), '[]'::jsonb),
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'jerseyNumber', assignment.veo_jersey_number,
                 'playerId', assignment.player_id,
                 'personId', player.directory_person_id,
                 'name', case when person.id is null then null else concat_ws(' ', person.first_name, person.last_name) end,
                 'matchedManually', assignment.matched_manually,
                 'stats', stats.items)
               order by assignment.veo_jersey_number)
          from public.playerboard_veo_player_assignments assignment
          left join public.playerboard_players player on player.id = assignment.player_id
          left join public.directory_people person on person.id = player.directory_person_id
         cross join lateral (
           select coalesce(jsonb_agg(jsonb_build_object('statType', stat.stat_type, 'category', stat.category,
                                                        'value', stat.value, 'periodValues', stat.period_values)
                                     order by stat.stat_type), '[]'::jsonb) as items
             from public.playerboard_veo_player_stats stat
            where stat.assignment_id = assignment.id
         ) stats
         where assignment.fixture_id = mapped.fixture_id), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', event.veo_event_id,
                 'teamAssociation', event.team_association,
                 'eventType', event.event_type,
                 'jerseyNumber', event.jersey_number,
                 'playerId', assignment.player_id,
                 'periodNumber', event.period_number,
                 'periodTimeMs', event.period_time_ms,
                 'videoTimeMs', event.video_time_ms,
                 'x', event.x, 'y', event.y, 'endX', event.end_x, 'endY', event.end_y,
                 'outcome', event.outcome,
                 'receiverJerseyNumber', event.receiver_jersey_number,
                 'assistJerseyNumber', event.assist_jersey_number)
               order by event.video_time_ms, event.veo_event_id)
          from public.playerboard_veo_events event
          left join public.playerboard_veo_player_assignments assignment
            on event.team_association = 'own'
           and assignment.fixture_id = event.fixture_id
           and assignment.veo_jersey_number = event.jersey_number
         where event.fixture_id = mapped.fixture_id), '[]'::jsonb),
      'heatmaps', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'jerseyNumber', heatmap.jersey_number, 'periodNumber', heatmap.period_number,
                 'width', heatmap.width, 'height', heatmap.height, 'cells', authz.base64_line(heatmap.cells),
                 'averageX', heatmap.average_x, 'averageY', heatmap.average_y)
               order by heatmap.jersey_number, heatmap.period_number)
          from public.playerboard_veo_heatmaps heatmap
         where heatmap.fixture_id = mapped.fixture_id), '[]'::jsonb),
      'passPossession', analysis.pass_possession,
      'momentum', analysis.momentum,
      'passingNetwork', analysis.passing_network,
      'hasReport', analysis.report is not null,
      'hasTracking', exists (select 1 from public.playerboard_veo_tracks track where track.fixture_id = mapped.fixture_id)
    )
      from public.playerboard_veo_matches mapped
      join public.fixtures fixture on fixture.id = mapped.fixture_id
      left join public.playerboard_veo_match_analysis analysis on analysis.fixture_id = mapped.fixture_id
     where mapped.team_id = target_team_id and mapped.fixture_id = target_fixture_id
  );
end;
$$;
revoke all on function public.playerboard_veo_match_analysis(uuid, uuid) from public;
grant execute on function public.playerboard_veo_match_analysis(uuid, uuid) to authenticated, service_role;

-- Positionsdaten roh je Spielfeldseite (1 Hz), dazu die Halbzeiten fuer die Zuordnung beim Lesen.
create or replace function public.playerboard_veo_match_tracks(target_team_id uuid, target_fixture_id uuid)
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
  return (
    select jsonb_build_object(
      'sampleHz', 1,
      'periods', coalesce(analysis.periods, '[]'::jsonb),
      'tracks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'veoTrackId', track.veo_track_id, 'side', track.side, 'goalkeeper', track.goalkeeper,
                 'jerseyNumber', track.jersey_number, 'startS', track.start_s, 'samples', authz.base64_line(track.samples))
               order by track.veo_track_id)
          from public.playerboard_veo_tracks track
         where track.fixture_id = mapped.fixture_id), '[]'::jsonb)
    )
      from public.playerboard_veo_matches mapped
      left join public.playerboard_veo_match_analysis analysis on analysis.fixture_id = mapped.fixture_id
     where mapped.team_id = target_team_id and mapped.fixture_id = target_fixture_id
  );
end;
$$;
revoke all on function public.playerboard_veo_match_tracks(uuid, uuid) from public;
grant execute on function public.playerboard_veo_match_tracks(uuid, uuid) to authenticated, service_role;
