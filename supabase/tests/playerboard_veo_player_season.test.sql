begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

set local role postgres;

-- Spec 002, PR 5: Veo Analytics, Reiter Spieler (2026102202_playerboard_veo_player_season.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00230000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-veo-players.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00230000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-veo-players.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00230000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'neighbour@pgtap-veo-players.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00230000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'foreign@pgtap-veo-players.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('00230000-1000-4000-8000-000000000001', 'PGTAP Veo Players', 'pgtap-veo-players'),
  ('00230000-1000-4000-8000-000000000002', 'PGTAP Veo Players Other', 'pgtap-veo-players-other');
insert into public.departments (id, organization_id, name, slug) values
  ('00230000-1100-4000-8000-000000000001', '00230000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('00230000-1100-4000-8000-000000000002', '00230000-1000-4000-8000-000000000002', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('00230000-1200-4000-8000-000000000001', '00230000-1000-4000-8000-000000000001', '00230000-1100-4000-8000-000000000001', 'C1'),
  ('00230000-1200-4000-8000-000000000002', '00230000-1000-4000-8000-000000000001', '00230000-1100-4000-8000-000000000001', 'C2'),
  ('00230000-1200-4000-8000-000000000003', '00230000-1000-4000-8000-000000000002', '00230000-1100-4000-8000-000000000002', 'C1');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('00230000-1000-4000-8000-000000000001', '00230000-1100-4000-8000-000000000001', '00230000-1200-4000-8000-000000000001', '00230000-0000-4000-8000-000000000001', 'team_manager'),
  ('00230000-1000-4000-8000-000000000001', '00230000-1100-4000-8000-000000000001', '00230000-1200-4000-8000-000000000001', '00230000-0000-4000-8000-000000000002', 'player'),
  ('00230000-1000-4000-8000-000000000001', '00230000-1100-4000-8000-000000000001', '00230000-1200-4000-8000-000000000002', '00230000-0000-4000-8000-000000000003', 'team_manager'),
  ('00230000-1000-4000-8000-000000000002', '00230000-1100-4000-8000-000000000002', '00230000-1200-4000-8000-000000000003', '00230000-0000-4000-8000-000000000004', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  -- Ada traegt im ersten Spiel die 7, im zweiten die 10. Cora spielt in C2.
  perform public.playerboard_create_player('00230000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 2012, true, null, 7, null, '00230000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('00230000-1200-4000-8000-000000000002', 'Cora', 'Christ', 2012, true, null, 7, null, '00230000-0000-4000-8000-000000000003');
  perform public.playerboard_veo_link_team('00230000-1200-4000-8000-000000000001', '00230000-2000-4000-8000-000000000001', '\x01'::bytea, 'v1',
    'club', 'Testverein', 'c1', 'Testverein C1', '00230000-0000-4000-8000-000000000001');
end;
$$;
create temporary table veo_run on commit drop as
  select * from public.enqueue_integration_sync('00230000-1000-4000-8000-000000000001', '00230000-2000-4000-8000-000000000001', 'players-1', gen_random_uuid(), null);

select public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
  'veoMatchId', id, 'veoTeamId', 'veo-team', 'start', start, 'opponentName', 'Gegner ' || id, 'isHome', true, 'ownScore', 1, 'opponentScore', 0,
  'teamStats', '[]'::jsonb,
  'players', (select jsonb_agg(jsonb_build_object('jerseyNumber', jersey, 'stats', jsonb_build_array(
                jsonb_build_object('statType', 'football_goal_total', 'category', 'attacking', 'value', goals, 'periodValues', '[]'::jsonb))))
                from unnest(jerseys, goal_counts) as player(jersey, goals))))
  from (values ('m1', '2026-09-05T10:00:00Z', array[7, 12], array[2, 1]), ('m2', '2026-10-05T10:00:00Z', array[10], array[1])) as match(id, start, jerseys, goal_counts);
create temporary table ids on commit drop as
  select mapped.veo_match_id, mapped.fixture_id,
         (select player.id from public.playerboard_players player where player.team_id = '00230000-1200-4000-8000-000000000001') as ada_id,
         (select player.id from public.playerboard_players player where player.team_id = '00230000-1200-4000-8000-000000000002') as cora_id
    from public.playerboard_veo_matches mapped where mapped.team_id = '00230000-1200-4000-8000-000000000001';
grant select on ids to authenticated;
set local role postgres;
update public.playerboard_veo_player_assignments set player_id = (select ada_id from ids limit 1), matched_manually = true
 where fixture_id = (select fixture_id from ids where veo_match_id = 'm2') and veo_jersey_number = 10;
set local role service_role;

-- Matrizen: ganzes Spiel (0) und eine Halbzeit, die nicht mitkommt.
select public.playerboard_veo_apply_analysis((select run_id from veo_run), id, jsonb_build_object(
  'veoMatchSlug', 'c1-' || id, 'status', 'complete', 'analyticsVersion', '2',
  'periods', jsonb_build_array(jsonb_build_object('number', 1, 'startS', 0, 'endS', 2700, 'ownSide', 'left', 'confirmed', true)),
  'availability', '{}'::jsonb, 'passPossession', '[]'::jsonb, 'momentum', null, 'passingNetwork', null, 'report', null, 'events', '[]'::jsonb,
  'heatmaps', (select jsonb_agg(jsonb_build_object('jerseyNumber', jersey, 'periodNumber', period, 'width', 60, 'height', 30,
                 'cells', encode(decode(repeat('01', 1800), 'hex'), 'base64'), 'averageX', 0.5, 'averageY', 0.5, 'secondsPlayed', 2700))
                 from unnest(jerseys) jersey cross join unnest(array[0, 1]) period),
  'tracks', null))
  from (values ('m1', array[7, 12]), ('m2', array[10])) as match(id, jerseys);

-- 1-3: Spielerwerte je Spiel fuer einen Mitspieler.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00230000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select match->>'opponentName', player->>'jerseyNumber', player->>'name', player->'stats'->>'football_goal_total', (player->>'playerId')::uuid
      from jsonb_array_elements(public.playerboard_veo_player_season('00230000-1200-4000-8000-000000000001')) match,
           jsonb_array_elements(match->'players') player$$,
  $$values ('Gegner m1'::text, '7'::text, 'Ada Arnold'::text, '2'::text, (select ada_id from ids limit 1)),
           ('Gegner m1', '12', null, '1', null),
           ('Gegner m2', '10', 'Ada Arnold', '1', (select ada_id from ids limit 1))$$,
  'the player season lists every jersey per match oldest first with its current assignment'
);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_player_season('00230000-1200-4000-8000-000000000001', last_n => 1)) match),
  '["Gegner m2"]'::jsonb,
  'the player season uses the filters of Veo Analytics'
);
select is(
  (select jsonb_agg(match->>'opponentName') from jsonb_array_elements(public.playerboard_veo_team_season('00230000-1200-4000-8000-000000000001', last_n => 1)) match),
  '["Gegner m2"]'::jsonb,
  'the team season keeps its filters with the shared helper'
);

-- 4-7: Heatmaps eines Spielers ueber wechselnde Rueckennummern.
select results_eq(
  $$select (heatmap->>'jerseyNumber')::int, (heatmap->>'secondsPlayed')::int, octet_length(decode(heatmap->>'cells', 'base64'))
      from jsonb_array_elements(public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', (select ada_id from ids limit 1))) heatmap$$,
  $$values (7, 2700, 1800), (10, 2700, 1800)$$,
  'a player''s heatmaps follow the assignment across jerseys, whole matches only'
);
select is(
  jsonb_array_length(public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', (select ada_id from ids limit 1),
    fixture_ids => array[(select fixture_id from ids where veo_match_id = 'm2')])),
  1,
  'the heatmaps use the filters of Veo Analytics'
);
select is(
  (select jsonb_agg(heatmap->>'jerseyNumber') from jsonb_array_elements(public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', target_jersey_number => 12)) heatmap),
  '["12"]'::jsonb,
  'an unassigned jersey has its own heatmaps'
);
select is(
  jsonb_array_length(public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', target_jersey_number => 7)),
  0,
  'an assigned jersey is read through its player, not as a bare number'
);

-- 8-11: Fehler.
select throws_ok(
  $$select public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', (select cora_id from ids limit 1))$$,
  'P0002', 'veo_player_not_found', 'a player of another team is not found'
);
select throws_ok(
  $$select public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001')$$,
  '22023', 'invalid_filter', 'a player or a jersey is required'
);
select throws_ok(
  $$select public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', (select ada_id from ids limit 1), 7)$$,
  '22023', 'invalid_filter', 'a player and a jersey together are rejected'
);
select throws_ok(
  $$select public.playerboard_veo_player_season('00230000-1200-4000-8000-000000000001', last_n => 101)$$,
  '22023', 'invalid_filter', 'last n is limited to 100'
);

-- 12-15: Isolation.
select set_config('request.jwt.claim.sub', '00230000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.playerboard_veo_player_season('00230000-1200-4000-8000-000000000001')$$, '42501', 'insufficient_permission', 'the neighbour team cannot read the player season');
select throws_ok(
  $$select public.playerboard_veo_player_heatmaps('00230000-1200-4000-8000-000000000001', target_jersey_number => 12)$$,
  '42501', 'insufficient_permission', 'the neighbour team cannot read the heatmaps'
);
select set_config('request.jwt.claim.sub', '00230000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.playerboard_veo_player_season('00230000-1200-4000-8000-000000000001')$$, '42501', 'insufficient_permission', 'a member of another club cannot read the player season');
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select public.playerboard_veo_player_season('00230000-1200-4000-8000-000000000001')$$, '42501', null, 'anon cannot read the player season');

select * from finish();
rollback;
