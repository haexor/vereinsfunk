-- Spec 002, PR 4: Veo Analytics -- die Saison einer Mannschaft (Nachbau von Veos Analytics Studio,
-- specs/002-veo-analyse/veo-ui-inventory.md §1b).
--
-- 1. playerboard_veo_team_season liefert je gefiltertem Spiel, was Kennzahlen, Verlauf, Schusskarte,
--    Zonen und Radar brauchen: Kopf, Werte je Halbzeit, Paesse und Ballbesitz, Schuesse und Tore. Die
--    Kennzahlen selbst rechnet packages/domain mit Veos Regeln (research.md R-08), damit eine Regel
--    an einer Stelle steht. Filter wie Veo: Zeitraum, Spielart, die letzten n Spiele oder eine
--    Einzelauswahl (die dann allein gilt).
-- 2. playerboard_veo_team_views haelt die Kennzahlen-Auswahl (bis 4) und die Radar-Einstellung je
--    Mannschaft. Lesen wie die Kennzahlen (stats_visibility), schreiben nur ueber die RPC mit
--    training.manage.

-- 1. Saison -----------------------------------------------------------------------------------------
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
  if last_n is not null and (last_n < 1 or last_n > 100) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  return (
    with filtered as (
      select mapped.fixture_id, mapped.veo_match_slug, mapped.analysis_status, fixture.kickoff_at, fixture.kind,
             fixture.opponent_name, fixture.is_home, fixture.home_score, fixture.away_score
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
       limit case when fixture_ids is null then last_n end
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

-- 2. Ansichtseinstellungen je Mannschaft --------------------------------------------------------------

-- Kennzahlenkatalog der Mannschaft (Inventar §1b.3 "Edit key metrics modal"); packages/domain
-- VEO_TEAM_KEY_METRICS fuehrt dieselben IDs.
create or replace function authz.playerboard_veo_key_metric_ids() returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'possession_percent', 'possession_minutes', 'possession_won',
    'possession_location_in_defensive_third', 'possession_location_in_middle_third', 'possession_location_in_attacking_third',
    'pass_location_in_defensive_third', 'pass_location_in_middle_third', 'pass_location_in_attacking_third',
    'passes_completed', 'three_to_five_passes', 'six_or_more_passes', 'longest_pass_string',
    'goals_scored', 'goals_conceded', 'kick_free_kick', 'shots_on_goal', 'shots_conceded', 'kick_corner', 'kick_goalie',
    'kick_penalty', 'throw_in', 'foul', 'tackles', 'duels', 'dribbles', 'interceptions', 'loose_ball_recoveries', 'saves',
    'shots_to_goal_conversion_rate', 'total_attempts', 'total_attempts_conceded', 'attacking_events', 'defensive_events', 'win_ratio'
  ]::text[]
$$;
revoke all on function authz.playerboard_veo_key_metric_ids() from public;

create table public.playerboard_veo_team_views (
  team_id uuid primary key,
  organization_id uuid not null,
  department_id uuid not null,
  -- Leer heisst: Veos Standardauswahl.
  key_metrics text[] not null default '{}'
    check (cardinality(key_metrics) <= 4 and key_metrics <@ authz.playerboard_veo_key_metric_ids()),
  -- {metrics: text[6], comparingTeamId: uuid | null, ownRange: [date, date], comparingRange: [date, date]}
  radar jsonb check (radar is null or jsonb_typeof(radar) = 'object'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

alter table public.playerboard_veo_team_views enable row level security;
alter table public.playerboard_veo_team_views force row level security;
create policy playerboard_veo_team_views_select on public.playerboard_veo_team_views
  for select to authenticated using (authz.can_view_playerboard_stats(team_id));
revoke all on public.playerboard_veo_team_views from anon, authenticated;
grant select on public.playerboard_veo_team_views to authenticated;
grant all privileges on public.playerboard_veo_team_views to service_role;

create or replace function public.playerboard_veo_team_views(target_team_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not authz.can_view_playerboard_stats(target_team_id) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  return coalesce(
    (select jsonb_build_object('keyMetrics', to_jsonb(views.key_metrics), 'radar', views.radar)
       from public.playerboard_veo_team_views views where views.team_id = target_team_id),
    jsonb_build_object('keyMetrics', '[]'::jsonb, 'radar', null)
  );
end;
$$;
revoke all on function public.playerboard_veo_team_views(uuid) from public;
grant execute on function public.playerboard_veo_team_views(uuid) to authenticated, service_role;

-- Speichert Auswahl und Radar. Die Vergleichsmannschaft muss im selben Verein liegen, und wer
-- speichert, muss ihre Kennzahlen sehen duerfen.
create or replace function public.playerboard_veo_save_team_views(target_team_id uuid, p_key_metrics text[], p_radar jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.teams;
  v_comparing uuid;
  v_metrics text[];
  v_own_from date;
  v_own_to date;
  v_comparing_from date;
  v_comparing_to date;
begin
  select * into target from public.teams where id = target_team_id;
  if not found or not authz.has_playerboard_team_permission(target_team_id, 'training.manage') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if p_key_metrics is null or cardinality(p_key_metrics) > 4
     or not (p_key_metrics <@ authz.playerboard_veo_key_metric_ids())
     or cardinality(p_key_metrics) <> (select count(distinct metric) from unnest(p_key_metrics) metric) then
    raise exception 'invalid_metric' using errcode = '22023';
  end if;
  if p_radar is not null and jsonb_typeof(p_radar) <> 'null' then
    if jsonb_typeof(p_radar) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(p_radar) key
          where key not in ('metrics', 'comparingTeamId', 'ownRange', 'comparingRange')
       )
       or coalesce(jsonb_typeof(p_radar->'metrics') <> 'array', true)
       or coalesce(jsonb_typeof(p_radar->'ownRange') <> 'array', true)
       or coalesce(jsonb_typeof(p_radar->'comparingRange') <> 'array', true) then
      raise exception 'invalid_metric' using errcode = '22023';
    end if;
    if jsonb_array_length(p_radar->'ownRange') <> 2 or jsonb_array_length(p_radar->'comparingRange') <> 2 then
      raise exception 'invalid_metric' using errcode = '22023';
    end if;
    select array_agg(value) into v_metrics from jsonb_array_elements_text(p_radar->'metrics') value;
    if cardinality(v_metrics) <> 6 or not (v_metrics <@ authz.playerboard_veo_key_metric_ids())
       or (select count(distinct metric) from unnest(v_metrics) metric) <> 6 then
      raise exception 'invalid_metric' using errcode = '22023';
    end if;
    begin
      v_own_from := (p_radar->'ownRange'->>0)::date;
      v_own_to := (p_radar->'ownRange'->>1)::date;
      v_comparing_from := (p_radar->'comparingRange'->>0)::date;
      v_comparing_to := (p_radar->'comparingRange'->>1)::date;
      v_comparing := nullif(p_radar->>'comparingTeamId', '')::uuid;
    exception when others then
      raise exception 'invalid_metric' using errcode = '22023';
    end;
    if v_own_from is null or v_own_to is null or v_comparing_from is null or v_comparing_to is null
       or to_char(v_own_from, 'YYYY-MM-DD') <> (p_radar->'ownRange'->>0)
       or to_char(v_own_to, 'YYYY-MM-DD') <> (p_radar->'ownRange'->>1)
       or to_char(v_comparing_from, 'YYYY-MM-DD') <> (p_radar->'comparingRange'->>0)
       or to_char(v_comparing_to, 'YYYY-MM-DD') <> (p_radar->'comparingRange'->>1)
       or v_own_from > v_own_to or v_comparing_from > v_comparing_to then
      raise exception 'invalid_metric' using errcode = '22023';
    end if;
    if v_comparing is not null and (
         v_comparing = target_team_id
         or not exists (select 1 from public.teams other where other.id = v_comparing and other.organization_id = target.organization_id)
         or not authz.can_view_playerboard_stats(v_comparing)) then
      raise exception 'comparing_team_not_available' using errcode = '22023';
    end if;
  else
    p_radar := null;
  end if;

  insert into public.playerboard_veo_team_views (team_id, organization_id, department_id, key_metrics, radar, updated_by, updated_at)
  values (target_team_id, target.organization_id, target.department_id, p_key_metrics, p_radar, auth.uid(), now())
  on conflict (team_id) do update set key_metrics = excluded.key_metrics, radar = excluded.radar,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('keyMetrics', to_jsonb(p_key_metrics), 'radar', p_radar);
end;
$$;
revoke all on function public.playerboard_veo_save_team_views(uuid, text[], jsonb) from public;
grant execute on function public.playerboard_veo_save_team_views(uuid, text[], jsonb) to authenticated;
