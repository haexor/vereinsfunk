-- Spielerprofil: gespeicherte Veo-Spielerwerte je sichtbarer Mannschaft und Zeitraum.
-- Die Funktion bleibt die einzige Datenbankgrenze des Profils: Veo-Daten werden nur zusammen mit
-- einer Mannschaft geliefert, fuer die authz.can_view_playerboard_stats true ist.

create index if not exists playerboard_veo_player_assignments_player_idx
  on public.playerboard_veo_player_assignments (organization_id, team_id, player_id, fixture_id);

create or replace function public.person_profile(target_person_id uuid, period text default 'season')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  person public.directory_people;
  organization_timezone text;
  caller uuid := auth.uid();
  visible boolean;
  team_rows jsonb := '[]'::jsonb;
  squad record;
  ranking record;
  from_date date;
begin
  if period not in ('season', 'all') then
    raise exception 'invalid_period';
  end if;
  if caller is null then
    return null;
  end if;

  select * into person from public.directory_people where id = target_person_id;
  if not found then
    return null;
  end if;

  visible := exists (
      select 1 from public.playerboard_players player
       where player.organization_id = person.organization_id
         and player.directory_person_id = person.id
         and authz.can_view_playerboard_stats(player.team_id)
    )
    or authz.has_organization_permission(person.organization_id, 'directory.read')
    or (person.department_id is not null and authz.has_department_permission(person.department_id, 'directory.read'))
    or (person.team_id is not null and authz.has_team_permission(person.team_id, 'directory.read'));
  if not visible then
    return null;
  end if;

  select organization.timezone into organization_timezone from public.organizations organization where organization.id = person.organization_id;

  for squad in
    select player.id as player_id, player.team_id, player.jersey_number, player.position, player.active,
           team.name as team_name, team.department_id
      from public.playerboard_players player
      join public.teams team on team.organization_id = player.organization_id and team.id = player.team_id
     where player.organization_id = person.organization_id
       and player.directory_person_id = person.id
       and authz.can_view_playerboard_stats(player.team_id)
     order by player.active desc, team.name, team.id
  loop
    from_date := null;
    if period = 'season' then
      from_date := authz.current_season_start(
        authz.resolve_playerboard_setting(person.organization_id, squad.department_id, squad.team_id, 'season_start')::date,
        (now() at time zone organization_timezone)::date
      );
    end if;

    -- Ein inaktiver Spieler ohne Punkte im Zeitraum steht nicht in der Rangliste: Platz null, 0 Punkte.
    select rows.rank, rows.total, rows.category_totals into ranking
      from authz.playerboard_ranking_rows(squad.team_id, from_date, null) rows
     where rows.player_id = squad.player_id;

    team_rows := team_rows || jsonb_build_array(jsonb_build_object(
      'teamId', squad.team_id,
      'teamName', squad.team_name,
      'playerId', squad.player_id,
      'jerseyNumber', squad.jersey_number,
      'position', squad.position,
      'active', squad.active,
      'isSelf', person.profile_id is not null and person.profile_id = caller,
      'rank', ranking.rank,
      'total', coalesce(ranking.total, 0),
      'categoryTotals', coalesce(ranking.category_totals, '{}'::jsonb),
      'veoMatches', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fixtureId', mapped.fixture_id,
                 'kickoffAt', fixture.kickoff_at,
                 'opponentName', fixture.opponent_name,
                 'jerseyNumber', assignment.veo_jersey_number,
                 'stats', stats.items)
                order by fixture.kickoff_at)
          from public.playerboard_veo_player_assignments assignment
          join public.playerboard_veo_matches mapped
            on mapped.organization_id = person.organization_id
           and mapped.team_id = squad.team_id
           and mapped.fixture_id = assignment.fixture_id
          join public.fixtures fixture
            on fixture.organization_id = person.organization_id
           and fixture.team_id = squad.team_id
           and fixture.id = mapped.fixture_id
          cross join lateral (
            select jsonb_object_agg(stat.stat_type, stat.value) as items
              from public.playerboard_veo_player_stats stat
             where stat.organization_id = person.organization_id
               and stat.team_id = squad.team_id
               and stat.fixture_id = assignment.fixture_id
               and stat.assignment_id = assignment.id
          ) stats
         where assignment.organization_id = person.organization_id
           and assignment.team_id = squad.team_id
           and assignment.player_id = squad.player_id
           and (from_date is null or (fixture.kickoff_at at time zone organization_timezone)::date >= from_date)
           and stats.items is not null
      ), '[]'::jsonb)
    ));
  end loop;

  return jsonb_build_object(
    'id', person.id,
    'organizationId', person.organization_id,
    'firstName', person.first_name,
    'lastName', person.last_name,
    'status', person.status,
    'teams', team_rows
  );
end;
$$;

revoke all on function public.person_profile(uuid, text) from public;
grant execute on function public.person_profile(uuid, text) to authenticated, service_role;
