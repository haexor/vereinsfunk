begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

set local role postgres;

-- Spec 002, PR 1: Speicher der Veo-Spielanalyse (2026102102_playerboard_veo_analysis.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-veo-analysis.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-veo-analysis.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'neighbour@pgtap-veo-analysis.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00200000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'foreign@pgtap-veo-analysis.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('00200000-1000-4000-8000-000000000001', 'PGTAP Veo Analysis', 'pgtap-veo-analysis'),
  ('00200000-1000-4000-8000-000000000002', 'PGTAP Veo Analysis Other', 'pgtap-veo-analysis-other');
insert into public.departments (id, organization_id, name, slug) values
  ('00200000-1100-4000-8000-000000000001', '00200000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('00200000-1100-4000-8000-000000000002', '00200000-1000-4000-8000-000000000002', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('00200000-1200-4000-8000-000000000001', '00200000-1000-4000-8000-000000000001', '00200000-1100-4000-8000-000000000001', 'C1'),
  ('00200000-1200-4000-8000-000000000002', '00200000-1000-4000-8000-000000000001', '00200000-1100-4000-8000-000000000001', 'C2'),
  ('00200000-1200-4000-8000-000000000003', '00200000-1000-4000-8000-000000000002', '00200000-1100-4000-8000-000000000002', 'C1');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('00200000-1000-4000-8000-000000000001', '00200000-1100-4000-8000-000000000001', '00200000-1200-4000-8000-000000000001', '00200000-0000-4000-8000-000000000001', 'team_manager'),
  ('00200000-1000-4000-8000-000000000001', '00200000-1100-4000-8000-000000000001', '00200000-1200-4000-8000-000000000001', '00200000-0000-4000-8000-000000000002', 'player'),
  ('00200000-1000-4000-8000-000000000001', '00200000-1100-4000-8000-000000000001', '00200000-1200-4000-8000-000000000002', '00200000-0000-4000-8000-000000000003', 'team_manager'),
  ('00200000-1000-4000-8000-000000000002', '00200000-1100-4000-8000-000000000002', '00200000-1200-4000-8000-000000000003', '00200000-0000-4000-8000-000000000004', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_create_player('00200000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 2012, true, null, 7, null, '00200000-0000-4000-8000-000000000001');
  perform public.playerboard_veo_link_team('00200000-1200-4000-8000-000000000001', '00200000-2000-4000-8000-000000000001', '\x01'::bytea, 'v1',
    'club', 'Testverein', 'c1', 'Testverein C1', '00200000-0000-4000-8000-000000000001');
end;
$$;
create temporary table veo_run on commit drop as
  select * from public.enqueue_integration_sync('00200000-1000-4000-8000-000000000001', '00200000-2000-4000-8000-000000000001', 'analysis-1', gen_random_uuid(), null);
grant select on veo_run to authenticated;

select public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
  'veoMatchId', 'm1', 'veoTeamId', 'veo-team', 'start', '2026-10-03T08:52:55Z', 'opponentName', 'Gegner', 'isHome', true,
  'ownScore', 2, 'opponentScore', 1, 'teamStats', '[]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('jerseyNumber', 7, 'stats', jsonb_build_array(jsonb_build_object(
    'statType', 'distance_total_meters', 'category', 'physical', 'value', 2382,
    'periodValues', jsonb_build_array(jsonb_build_object('period', 1, 'value', 1095), jsonb_build_object('period', 2, 'value', 1287))))))));
create temporary table fixture_ids on commit drop as
  select fixture_id from public.playerboard_veo_matches where team_id = '00200000-1200-4000-8000-000000000001' and veo_match_id = 'm1';
grant select on fixture_ids to authenticated;

-- Analysepaket: zwei Ereignisse (eines ohne Ort), eine Heatmap 2 x 1, eine Spur.
create temporary table analysis_input on commit drop as select jsonb_build_object(
  'veoMatchSlug', 'c1-vs-gegner', 'status', 'complete', 'analyticsVersion', '2',
  'periods', jsonb_build_array(jsonb_build_object('number', 1, 'startS', 605, 'endS', 2573, 'ownSide', 'left', 'confirmed', false)),
  'availability', jsonb_build_object('events', jsonb_build_object('status', 'available')),
  'passPossession', '[]'::jsonb, 'momentum', jsonb_build_array(jsonb_build_array(20, 0.5)), 'passingNetwork', null, 'report', null,
  'events', jsonb_build_array(
    jsonb_build_object('veoEventId', 'e1', 'teamAssociation', 'own', 'eventType', 'FootballGoal', 'jerseyNumber', 7, 'periodNumber', 1,
                       'periodTimeMs', 125499, 'videoTimeMs', 730499, 'x', 0.9, 'y', 0.5, 'outcome', 1),
    jsonb_build_object('veoEventId', 'e2', 'teamAssociation', 'opponent', 'eventType', 'FootballShot', 'jerseyNumber', 9, 'periodNumber', 1,
                       'periodTimeMs', 1000, 'videoTimeMs', 606000)),
  'heatmaps', jsonb_build_array(jsonb_build_object('jerseyNumber', 7, 'periodNumber', 0, 'width', 2, 'height', 1,
                                                   'cells', encode('\x00ff'::bytea, 'base64'), 'averageX', 0.6, 'averageY', 0.5, 'secondsPlayed', 3900)),
  'tracks', jsonb_build_array(jsonb_build_object('veoTrackId', 3, 'side', 'left', 'goalkeeper', false, 'jerseyNumber', 7, 'startS', 605,
                                                 'samples', encode('\x00010002'::bytea, 'base64')))
) as analysis;

-- 1-3: Schreiben, Stand am Spiel, Halbzeitwerte der Summenwerte.
select is(public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1', (select analysis from analysis_input)), 'written', 'the analysis package is written');
select results_eq(
  $$select veo_match_slug, analysis_status, analysis_fetched_at is not null from public.playerboard_veo_matches where fixture_id = (select fixture_id from fixture_ids)$$,
  $$values ('c1-vs-gegner'::text, 'complete'::text, true)$$,
  'the match records slug, status and fetch time'
);
select is(
  (select period_values from public.playerboard_veo_player_stats where fixture_id = (select fixture_id from fixture_ids) and stat_type = 'distance_total_meters'),
  '[{"period": 1, "value": 1095}, {"period": 2, "value": 1287}]'::jsonb,
  'apply_match keeps the player values per period'
);

-- 4-7: Mitspieler liest alle vier Tabellen.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00200000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.playerboard_veo_match_analysis), 1, 'a teammate reads the match analysis');
select is((select count(*)::int from public.playerboard_veo_events), 2, 'a teammate reads both teams'' events');
select is((select count(*)::int from public.playerboard_veo_heatmaps), 1, 'a teammate reads the heatmaps');
select is((select count(*)::int from public.playerboard_veo_tracks), 1, 'a teammate reads the tracks');

-- 8-9: Nachbarmannschaft (stats_visibility team) und fremder Verein sehen nichts.
select set_config('request.jwt.claim.sub', '00200000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::int from public.playerboard_veo_match_analysis) + (select count(*)::int from public.playerboard_veo_events)
    + (select count(*)::int from public.playerboard_veo_heatmaps) + (select count(*)::int from public.playerboard_veo_tracks),
  0, 'the coach of a neighbour team sees no analysis while visibility is team'
);
select set_config('request.jwt.claim.sub', '00200000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::int from public.playerboard_veo_match_analysis) + (select count(*)::int from public.playerboard_veo_events)
    + (select count(*)::int from public.playerboard_veo_heatmaps) + (select count(*)::int from public.playerboard_veo_tracks),
  0, 'a member of another club sees no analysis'
);

-- 10-13: Schreiben nur ueber service_role; anon hat keinen Zugriff.
select set_config('request.jwt.claim.sub', '00200000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.playerboard_veo_events (organization_id, team_id, fixture_id, veo_event_id, team_association, event_type, period_number, period_time_ms, video_time_ms)
    values ('00200000-1000-4000-8000-000000000001', '00200000-1200-4000-8000-000000000001', (select fixture_id from fixture_ids), 'x', 'own', 'pass', 1, 0, 0)$$,
  '42501', null, 'even the coach cannot insert events'
);
select throws_ok($$update public.playerboard_veo_heatmaps set seconds_played = 1$$, '42501', null, 'the coach cannot update heatmaps');
select throws_ok(
  $$select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1', '{"status": "complete"}'::jsonb)$$,
  '42501', null, 'authenticated cannot call the write function'
);
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select count(*) from public.playerboard_veo_tracks$$, '42501', null, 'anon cannot read tracks');

-- 14-16: Lauf und Spiel werden geprueft; ein zweites Paket ersetzt, tracks = null behaelt die Spuren.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select public.playerboard_veo_apply_analysis(gen_random_uuid(), 'm1', (select analysis from analysis_input))$$,
  '55000', 'sync_run_not_running', 'an unknown or finished run cannot write'
);
select is(public.playerboard_veo_apply_analysis((select run_id from veo_run), 'unknown', (select analysis from analysis_input)), 'unknown_match', 'a match of no Veo mapping is reported, not written');
select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1',
  (select analysis || jsonb_build_object('events', jsonb_build_array(analysis->'events'->0), 'tracks', null) from analysis_input));
select results_eq(
  $$select (select count(*)::int from public.playerboard_veo_events where fixture_id = (select fixture_id from fixture_ids)),
           (select count(*)::int from public.playerboard_veo_tracks where fixture_id = (select fixture_id from fixture_ids))$$,
  $$values (1, 1)$$,
  'a second package replaces the events and keeps the stored tracks'
);

-- 17-20: Wertebereiche.
select throws_ok(
  $$select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1',
      (select analysis || jsonb_build_object('events', jsonb_build_array((analysis->'events'->0) || '{"x": 1.04}'::jsonb)) from analysis_input))$$,
  '23514', null, 'a location outside the pitch is rejected'
);
select throws_ok(
  $$select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1',
      (select analysis || jsonb_build_object('events', jsonb_build_array((analysis->'events'->0) - 'y')) from analysis_input))$$,
  '23514', null, 'a location with only x is rejected'
);
select throws_ok(
  $$select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1',
      (select analysis || jsonb_build_object('events', jsonb_build_array((analysis->'events'->0) || '{"periodNumber": 0}'::jsonb)) from analysis_input))$$,
  '23514', null, 'an event outside any period is rejected'
);
select throws_ok(
  $$select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1',
      (select analysis || jsonb_build_object('heatmaps', jsonb_build_array((analysis->'heatmaps'->0) || '{"width": 3}'::jsonb)) from analysis_input))$$,
  '23514', null, 'a heatmap whose cells do not match its size is rejected'
);

-- 21-23: department-Sicht; die oeffentliche Ausgabe zeigt weiter nur das Spiel, keine Analyse.
set local role postgres;
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, stats_visibility, public_veo_stats_enabled, public_slug, updated_by) values
  ('00200000-1000-4000-8000-000000000001', 'team', '00200000-1100-4000-8000-000000000001', '00200000-1200-4000-8000-000000000001', 'department', true, 'c1', '00200000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00200000-0000-4000-8000-000000000003', true);
select is((select count(*)::int from public.playerboard_veo_events), 1, 'the neighbour team reads the analysis once visibility is department');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select ok(
  position('FootballGoal' in public.playerboard_public_veo_stats('pgtap-veo-analysis', 'c1')::text) = 0
    and position('heatmap' in public.playerboard_public_veo_stats('pgtap-veo-analysis', 'c1')::text) = 0,
  'the public output carries no analysis data'
);
select is(
  jsonb_array_length(public.playerboard_public_veo_stats('pgtap-veo-analysis', 'c1')), 1,
  'the public output still lists the match itself'
);

-- 24: Ein geloeschtes Spiel nimmt seine Analyse mit.
set local role postgres;
delete from public.fixtures where id = (select fixture_id from fixture_ids);
select is(
  (select count(*)::int from public.playerboard_veo_match_analysis where fixture_id = (select fixture_id from fixture_ids))
    + (select count(*)::int from public.playerboard_veo_events where fixture_id = (select fixture_id from fixture_ids))
    + (select count(*)::int from public.playerboard_veo_heatmaps where fixture_id = (select fixture_id from fixture_ids))
    + (select count(*)::int from public.playerboard_veo_tracks where fixture_id = (select fixture_id from fixture_ids)),
  0, 'deleting the fixture removes its analysis'
);

select * from finish();
rollback;
