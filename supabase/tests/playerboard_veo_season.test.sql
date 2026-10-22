begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

set local role postgres;

-- Spec 002, PR 4: Veo Analytics -- Saison und Ansichtseinstellungen (2026102201_playerboard_veo_season.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00220000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-veo-season.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00220000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-veo-season.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00220000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'neighbour@pgtap-veo-season.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00220000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'foreign@pgtap-veo-season.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('00220000-1000-4000-8000-000000000001', 'PGTAP Veo Season', 'pgtap-veo-season'),
  ('00220000-1000-4000-8000-000000000002', 'PGTAP Veo Season Other', 'pgtap-veo-season-other');
insert into public.departments (id, organization_id, name, slug) values
  ('00220000-1100-4000-8000-000000000001', '00220000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('00220000-1100-4000-8000-000000000002', '00220000-1000-4000-8000-000000000002', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('00220000-1200-4000-8000-000000000001', '00220000-1000-4000-8000-000000000001', '00220000-1100-4000-8000-000000000001', 'C1'),
  ('00220000-1200-4000-8000-000000000002', '00220000-1000-4000-8000-000000000001', '00220000-1100-4000-8000-000000000001', 'C2'),
  ('00220000-1200-4000-8000-000000000003', '00220000-1000-4000-8000-000000000002', '00220000-1100-4000-8000-000000000002', 'C1');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('00220000-1000-4000-8000-000000000001', '00220000-1100-4000-8000-000000000001', '00220000-1200-4000-8000-000000000001', '00220000-0000-4000-8000-000000000001', 'team_manager'),
  ('00220000-1000-4000-8000-000000000001', '00220000-1100-4000-8000-000000000001', '00220000-1200-4000-8000-000000000001', '00220000-0000-4000-8000-000000000002', 'player'),
  ('00220000-1000-4000-8000-000000000001', '00220000-1100-4000-8000-000000000001', '00220000-1200-4000-8000-000000000002', '00220000-0000-4000-8000-000000000003', 'team_manager'),
  ('00220000-1000-4000-8000-000000000002', '00220000-1100-4000-8000-000000000002', '00220000-1200-4000-8000-000000000003', '00220000-0000-4000-8000-000000000004', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_veo_link_team('00220000-1200-4000-8000-000000000001', '00220000-2000-4000-8000-000000000001', '\x01'::bytea, 'v1',
    'club', 'Testverein', 'c1', 'Testverein C1', '00220000-0000-4000-8000-000000000001');
end;
$$;
create temporary table veo_run on commit drop as
  select * from public.enqueue_integration_sync('00220000-1000-4000-8000-000000000001', '00220000-2000-4000-8000-000000000001', 'season-1', gen_random_uuid(), null);

-- Drei Spiele: m1 (September), m2 (Oktober, Freundschaftsspiel), m3 (November).
select public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
  'veoMatchId', id, 'veoTeamId', 'veo-team', 'start', start, 'opponentName', 'Gegner ' || id, 'isHome', true,
  'ownScore', own, 'opponentScore', other,
  'teamStats', jsonb_build_array(jsonb_build_object('teamAssociation', 'own', 'statType', 'football_goal_total', 'category', 'attacking', 'value', own,
                                                    'periodValues', jsonb_build_array(jsonb_build_object('period', 1, 'value', own)))),
  'players', '[]'::jsonb))
  from (values ('m1', '2026-09-05T10:00:00Z', 2, 1), ('m2', '2026-10-05T10:00:00Z', 0, 0), ('m3', '2026-11-05T10:00:00Z', 1, 3)) as match(id, start, own, other);
create temporary table ids on commit drop as
  select veo_match_id, fixture_id from public.playerboard_veo_matches where team_id = '00220000-1200-4000-8000-000000000001';
grant select on ids to authenticated;
set local role postgres;
update public.fixtures set kind = 'friendly' where id = (select fixture_id from ids where veo_match_id = 'm2');
set local role service_role;

-- m1 mit Analyse: ein Tor, ein Schuss, ein Pass (der nicht mitkommt).
select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1', jsonb_build_object(
  'veoMatchSlug', 'c1-m1', 'status', 'complete', 'analyticsVersion', '2',
  'periods', jsonb_build_array(jsonb_build_object('number', 1, 'startS', 0, 'endS', 2700, 'ownSide', 'left', 'confirmed', true)),
  'availability', jsonb_build_object('shots', jsonb_build_object('status', 'available')),
  'passPossession', '[]'::jsonb, 'momentum', null, 'passingNetwork', null, 'report', null,
  'events', jsonb_build_array(
    jsonb_build_object('veoEventId', 's1', 'teamAssociation', 'own', 'eventType', 'FootballShot', 'jerseyNumber', 7, 'periodNumber', 1, 'periodTimeMs', 1000, 'videoTimeMs', 1000, 'x', 0.9, 'y', 0.5),
    jsonb_build_object('veoEventId', 'g1', 'teamAssociation', 'own', 'eventType', 'FootballGoal', 'jerseyNumber', 7, 'periodNumber', 1, 'periodTimeMs', 1500, 'videoTimeMs', 1500),
    jsonb_build_object('veoEventId', 'p1', 'teamAssociation', 'opponent', 'eventType', 'pass', 'jerseyNumber', 4, 'periodNumber', 1, 'periodTimeMs', 2000, 'videoTimeMs', 2000)),
  'heatmaps', '[]'::jsonb, 'tracks', null));

-- 1-7: Saison fuer einen Mitspieler mit Filtern.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000002', true);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001')) match),
  '["Gegner m1", "Gegner m2", "Gegner m3"]'::jsonb,
  'the season lists all matches oldest first'
);
select results_eq(
  $$select match->>'kind', match->>'veoUrl', match->>'analyticsVersion', jsonb_array_length(match->'shots'), match->'teamStats'->0->'periodValues'->0->>'value'
      from jsonb_array_elements(public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001')) match where match->>'opponentName' = 'Gegner m1'$$,
  $$values ('match'::text, 'https://app.veo.co/matches/c1-m1/'::text, '2'::text, 2, '2'::text)$$,
  'a match carries kind, Veo link, analytics version, only shots and goals, and values per period'
);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001', last_n => 2)) match),
  '["Gegner m2", "Gegner m3"]'::jsonb,
  'last n keeps the newest matches, still oldest first'
);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001', kinds => array['friendly'])) match),
  '["Gegner m2"]'::jsonb,
  'kinds filters by the fixture kind'
);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001', from_date => '2026-10-01', to_date => '2026-10-31')) match),
  '["Gegner m2"]'::jsonb,
  'the date range is inclusive'
);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001',
     kinds => array['cup'], last_n => 1, fixture_ids => array[(select fixture_id from ids where veo_match_id = 'm1'), (select fixture_id from ids where veo_match_id = 'm3')])) match),
  '["Gegner m1", "Gegner m3"]'::jsonb,
  'a selection of matches replaces every other filter'
);
select throws_ok(
  $$select public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001', last_n => 0)$$,
  '22023', 'invalid_filter', 'last n must be at least 1'
);

-- 8-9: Nachbarmannschaft (Sicht team) und fremder Verein.
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001')$$, '42501', 'insufficient_permission', 'the neighbour team cannot read the season');
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001')$$, '42501', 'insufficient_permission', 'a member of another club cannot read the season');

-- 10-17: Ansichtseinstellungen.
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000002', true);
select is(public.playerboard_veo_team_views('00220000-1200-4000-8000-000000000001'), '{"keyMetrics": [], "radar": null}'::jsonb, 'without a saved choice Veo''s defaults apply');
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored'], null)$$,
  '42501', 'insufficient_permission', 'a player cannot change the key metrics'
);
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored', 'goals_conceded', 'foul', 'saves', 'duels'], null)$$,
  '22023', 'invalid_metric', 'more than four key metrics are rejected'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored', 'goals_scored'], null)$$,
  '22023', 'invalid_metric', 'a key metric cannot be chosen twice'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['expected_goals'], null)$$,
  '22023', 'invalid_metric', 'an unknown key metric is rejected'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored'],
      '{"metrics": ["goals_scored", "win_ratio"], "comparingTeamId": null}'::jsonb)$$,
  '22023', 'invalid_metric', 'the radar needs exactly six metrics'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored'],
      '{"metrics": ["goals_scored", "shots_on_goal", "shots_to_goal_conversion_rate", "win_ratio", "passes_completed", "possession_percent"], "comparingTeamId": null}'::jsonb)$$,
  '22023', 'invalid_metric', 'the radar needs both date ranges'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored'],
      '{"metrics": ["goals_scored", "shots_on_goal", "shots_to_goal_conversion_rate", "win_ratio", "passes_completed", "possession_percent"], "comparingTeamId": null, "ownRange": ["2026-10-01", "2026-09-01"], "comparingRange": ["2026-08-01", "2026-08-31"]}'::jsonb)$$,
  '22023', 'invalid_metric', 'a radar range cannot run backwards'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored'],
      '{"metrics": ["goals_scored", "shots_on_goal", "shots_to_goal_conversion_rate", "win_ratio", "passes_completed", "possession_percent"], "comparingTeamId": "00220000-1200-4000-8000-000000000003"}'::jsonb)$$,
  '22023', 'comparing_team_not_available', 'a team of another club cannot be the comparison'
);
select throws_ok(
  $$select public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['goals_scored'],
      '{"metrics": ["goals_scored", "shots_on_goal", "shots_to_goal_conversion_rate", "win_ratio", "passes_completed", "possession_percent"], "comparingTeamId": "00220000-1200-4000-8000-000000000002"}'::jsonb)$$,
  '22023', 'comparing_team_not_available', 'a team whose stats the coach cannot see cannot be the comparison'
);
select is(
  public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array['possession_percent', 'goals_scored'],
    '{"metrics": ["goals_scored", "shots_on_goal", "shots_to_goal_conversion_rate", "win_ratio", "passes_completed", "possession_percent"], "comparingTeamId": null, "ownRange": ["2026-09-01", "2026-09-30"], "comparingRange": ["2026-10-01", "2026-10-31"]}'::jsonb)->'keyMetrics',
  '["possession_percent", "goals_scored"]'::jsonb,
  'the coach saves key metrics and the radar'
);

-- 18-20: Lesen der gespeicherten Auswahl, Isolation der Tabelle.
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000002', true);
select is(public.playerboard_veo_team_views('00220000-1200-4000-8000-000000000001')->'radar'->>'comparingTeamId', null, 'a teammate reads the saved radar');
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000003', true);
select is((select count(*)::int from public.playerboard_veo_team_views), 0, 'the neighbour team does not see the saved choice');
select set_config('request.jwt.claim.sub', '00220000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update public.playerboard_veo_team_views set key_metrics = '{}'$$,
  '42501', null, 'the coach cannot write the table directly'
);

-- 21-22: Mit Sicht department ist die Nachbarmannschaft als Vergleich erlaubt; anon hat keinen Zugriff.
set local role postgres;
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, stats_visibility, updated_by) values
  ('00220000-1000-4000-8000-000000000001', 'team', '00220000-1100-4000-8000-000000000001', '00220000-1200-4000-8000-000000000002', 'department', '00220000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  public.playerboard_veo_save_team_views('00220000-1200-4000-8000-000000000001', array[]::text[],
    '{"metrics": ["goals_scored", "shots_on_goal", "shots_to_goal_conversion_rate", "win_ratio", "passes_completed", "possession_percent"], "comparingTeamId": "00220000-1200-4000-8000-000000000002"}'::jsonb)->'radar'->>'comparingTeamId',
  '00220000-1200-4000-8000-000000000002',
  'a team of the same department becomes the comparison once its stats are visible'
);
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select public.playerboard_veo_team_season('00220000-1200-4000-8000-000000000001')$$, '42501', null, 'anon cannot read the season');

select * from finish();
rollback;
