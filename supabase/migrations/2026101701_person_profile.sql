-- Spielerprofil auf Vereinsebene: lesende Sicht auf eine Verzeichnisperson mit ihren Mannschaften
-- und Saisonpunkten. Keine neue Tabelle.
--
-- Das Profil gibt nie mehr preis als Kader, Rangliste und Saisonuebersicht zusammen: Mannschaften
-- und Punkte erscheinen nur dort, wo der Aufrufer die Kennzahlen sehen darf
-- (authz.can_view_playerboard_stats). Geburtsjahr, Minderjaehrigkeit, E-Mail und Konto liefert die
-- Funktion nie; Verwaltungsangaben ergaenzt die API nach Pruefung von training.manage.

-- 1. Saisonbeginn ----------------------------------------------------------------------------------

-- Anfang der laufenden Saison: der letzte Jahrestag des Saisonbeginns am oder vor "today". Ein
-- 29. Februar wird in Nicht-Schaltjahren auf den 28. gesetzt. Spiegel von currentSeasonStart in
-- packages/domain/src/playerboard.ts; supabase/tests/person_profile.test.sql prueft dieselben Faelle.
create or replace function authz.current_season_start(season_start date, today date) returns date
language plpgsql
immutable
as $$
declare
  season_month integer;
  season_day integer;
  season_year integer;
  candidate date;
begin
  if season_start is null then
    return null;
  end if;
  season_month := extract(month from season_start);
  season_day := extract(day from season_start);
  season_year := extract(year from today);
  candidate := make_date(season_year, season_month,
    least(season_day, extract(day from (make_date(season_year, season_month, 1) + interval '1 month' - interval '1 day'))::integer));
  if candidate <= today then
    return candidate;
  end if;
  season_year := season_year - 1;
  return make_date(season_year, season_month,
    least(season_day, extract(day from (make_date(season_year, season_month, 1) + interval '1 month' - interval '1 day'))::integer));
end;
$$;
revoke all on function authz.current_season_start(date, date) from public;

-- 2. Profil ----------------------------------------------------------------------------------------

-- Liefert null, wenn die Person nicht existiert ODER fuer den Aufrufer nicht sichtbar ist -- beide
-- Faelle sind absichtlich nicht zu unterscheiden. Sichtbar ist eine Person, wenn der Aufrufer die
-- Kennzahlen mindestens einer ihrer Mannschaften sieht oder sie im Verzeichnis lesen darf (dieselbe
-- Bedingung wie directory_people_select).
--
-- period: 'season' = laufende Saison je Mannschaft (wirksamer Saisonbeginn der Mannschaft, ohne
-- Saisonbeginn die gesamte Zeit), 'all' = gesamte Zeit. Punkte stammen aus
-- authz.playerboard_ranking_rows und stimmen damit mit Rangliste und Saisonuebersicht ueberein.
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
      'categoryTotals', coalesce(ranking.category_totals, '{}'::jsonb)
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
