-- Spec 002: Heatmap der Mannschaft ueber die gefilterten Spiele in Veo Analytics, mit Spielerliste
-- wie bei Veos Karten ("Ganze Mannschaft" oder ein Spieler). Geliefert werden Veos Matrizen des
-- ganzen Spiels aller eigenen Rueckennummern mit Zuordnung und Spielsekunden; packages/domain
-- summiert sie nach Spielzeit gewichtet (research.md R-05). Filter wie playerboard_veo_team_season.
create or replace function public.playerboard_veo_team_heatmaps(
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
             'fixtureId', heatmap.fixture_id,
             'jerseyNumber', heatmap.jersey_number,
             'playerId', assignment.player_id,
             'name', case when person.id is null then null else concat_ws(' ', person.first_name, person.last_name) end,
             'width', heatmap.width,
             'height', heatmap.height,
             'cells', authz.base64_line(heatmap.cells),
             'secondsPlayed', heatmap.seconds_played
           ) order by fixture.kickoff_at, heatmap.jersey_number), '[]'::jsonb)
      from authz.playerboard_veo_season_fixture_ids(target_team_id, from_date, to_date, kinds, fixture_ids, last_n) chosen(fixture_id)
      join public.fixtures fixture on fixture.id = chosen.fixture_id
      join public.playerboard_veo_heatmaps heatmap on heatmap.fixture_id = chosen.fixture_id and heatmap.period_number = 0
      left join public.playerboard_veo_player_assignments assignment
        on assignment.fixture_id = heatmap.fixture_id and assignment.veo_jersey_number = heatmap.jersey_number
      left join public.playerboard_players player on player.id = assignment.player_id
      left join public.directory_people person on person.id = player.directory_person_id
  );
end;
$$;
revoke all on function public.playerboard_veo_team_heatmaps(uuid, date, date, text[], uuid[], integer) from public;
grant execute on function public.playerboard_veo_team_heatmaps(uuid, date, date, text[], uuid[], integer) to authenticated, service_role;
