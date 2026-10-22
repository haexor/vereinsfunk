begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

set local role postgres;

-- Spec 002, PR 2: Spielauswertung lesen (2026102103_playerboard_veo_match_analysis.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00210000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-veo-match.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00210000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-veo-match.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00210000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'neighbour@pgtap-veo-match.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00210000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'foreign@pgtap-veo-match.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('00210000-1000-4000-8000-000000000001', 'PGTAP Veo Match', 'pgtap-veo-match'),
  ('00210000-1000-4000-8000-000000000002', 'PGTAP Veo Match Other', 'pgtap-veo-match-other');
insert into public.departments (id, organization_id, name, slug) values
  ('00210000-1100-4000-8000-000000000001', '00210000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('00210000-1100-4000-8000-000000000002', '00210000-1000-4000-8000-000000000002', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('00210000-1200-4000-8000-000000000001', '00210000-1000-4000-8000-000000000001', '00210000-1100-4000-8000-000000000001', 'C1'),
  ('00210000-1200-4000-8000-000000000002', '00210000-1000-4000-8000-000000000001', '00210000-1100-4000-8000-000000000001', 'C2'),
  ('00210000-1200-4000-8000-000000000003', '00210000-1000-4000-8000-000000000002', '00210000-1100-4000-8000-000000000002', 'C1');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('00210000-1000-4000-8000-000000000001', '00210000-1100-4000-8000-000000000001', '00210000-1200-4000-8000-000000000001', '00210000-0000-4000-8000-000000000001', 'team_manager'),
  ('00210000-1000-4000-8000-000000000001', '00210000-1100-4000-8000-000000000001', '00210000-1200-4000-8000-000000000001', '00210000-0000-4000-8000-000000000002', 'player'),
  ('00210000-1000-4000-8000-000000000001', '00210000-1100-4000-8000-000000000001', '00210000-1200-4000-8000-000000000002', '00210000-0000-4000-8000-000000000003', 'team_manager'),
  ('00210000-1000-4000-8000-000000000002', '00210000-1100-4000-8000-000000000002', '00210000-1200-4000-8000-000000000003', '00210000-0000-4000-8000-000000000004', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_create_player('00210000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 2012, true, null, 7, null, '00210000-0000-4000-8000-000000000001');
  perform public.playerboard_veo_link_team('00210000-1200-4000-8000-000000000001', '00210000-2000-4000-8000-000000000001', '\x01'::bytea, 'v1',
    'club', 'Testverein', 'c1', 'Testverein C1', '00210000-0000-4000-8000-000000000001');
end;
$$;
create temporary table veo_run on commit drop as
  select * from public.enqueue_integration_sync('00210000-1000-4000-8000-000000000001', '00210000-2000-4000-8000-000000000001', 'match-analysis-1', gen_random_uuid(), null);

select public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
  'veoMatchId', 'm1', 'veoTeamId', 'veo-team', 'start', '2026-10-03T08:52:55Z', 'opponentName', 'Gegner', 'isHome', false,
  'ownScore', 2, 'opponentScore', 1,
  'teamStats', jsonb_build_array(jsonb_build_object('teamAssociation', 'own', 'statType', 'football_goal_total', 'category', 'attacking', 'value', 2,
                                                    'periodValues', jsonb_build_array(jsonb_build_object('period', 1, 'value', 1), jsonb_build_object('period', 2, 'value', 1)))),
  'players', jsonb_build_array(jsonb_build_object('jerseyNumber', 7, 'stats', jsonb_build_array(jsonb_build_object(
    'statType', 'distance_total_meters', 'category', 'physical', 'value', 2382,
    'periodValues', jsonb_build_array(jsonb_build_object('period', 1, 'value', 1095), jsonb_build_object('period', 2, 'value', 1287))))))));
create temporary table ids on commit drop as
  select mapped.fixture_id, player.id as player_id, player.directory_person_id as person_id
    from public.playerboard_veo_matches mapped
    join public.playerboard_players player on player.team_id = mapped.team_id and player.jersey_number = 7
   where mapped.team_id = '00210000-1200-4000-8000-000000000001' and mapped.veo_match_id = 'm1';
grant select on ids to authenticated;

-- Eigenes Tor von Nr. 7, Gegnerschuss von Nr. 7 (gleiche Nummer, kein Kaderbezug), Matrix 60 x 30, eine Spur.
select public.playerboard_veo_apply_analysis((select run_id from veo_run), 'm1', jsonb_build_object(
  'veoMatchSlug', 'c1-vs-gegner', 'status', 'complete', 'analyticsVersion', '2',
  'periods', jsonb_build_array(jsonb_build_object('number', 1, 'startS', 605, 'endS', 2573, 'ownSide', 'left', 'confirmed', false)),
  'availability', jsonb_build_object('events', jsonb_build_object('status', 'available'), 'report', jsonb_build_object('status', 'unavailable', 'reason', 'not_provided')),
  'passPossession', '[]'::jsonb, 'momentum', jsonb_build_array(jsonb_build_array(20, 0.5)), 'passingNetwork', null, 'report', jsonb_build_object('view', 'advanced'),
  'events', jsonb_build_array(
    jsonb_build_object('veoEventId', 'e1', 'teamAssociation', 'own', 'eventType', 'FootballGoal', 'jerseyNumber', 7, 'periodNumber', 1,
                       'periodTimeMs', 125499, 'videoTimeMs', 730499, 'x', 0.9, 'y', 0.5, 'outcome', 1),
    jsonb_build_object('veoEventId', 'e2', 'teamAssociation', 'opponent', 'eventType', 'FootballShot', 'jerseyNumber', 7, 'periodNumber', 1,
                       'periodTimeMs', 1000, 'videoTimeMs', 606000)),
  'heatmaps', jsonb_build_array(jsonb_build_object('jerseyNumber', 7, 'periodNumber', 0, 'width', 60, 'height', 30,
                                                   'cells', encode((select string_agg(chr(65 + n % 26), '') from generate_series(0, 1799) n)::bytea, 'base64'),
                                                   'averageX', 0.6, 'averageY', 0.5, 'secondsPlayed', 3900)),
  'tracks', jsonb_build_array(jsonb_build_object('veoTrackId', 3, 'side', 'left', 'goalkeeper', false, 'jerseyNumber', 7, 'startS', 605,
                                                 'samples', encode('\x00010002'::bytea, 'base64')))
));

-- 1-8: Mitspieler liest die Auswertung.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00210000-0000-4000-8000-000000000002', true);
create temporary table analysis on commit drop as
  select public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000001', (select fixture_id from ids)) as body;
select results_eq(
  $$select body->>'veoUrl', body->>'analysisStatus', body->>'analyticsVersion', (body->>'ownScore')::int, (body->>'opponentScore')::int,
           (body->>'hasReport')::boolean, (body->>'hasTracking')::boolean from analysis$$,
  $$values ('https://app.veo.co/matches/c1-vs-gegner/'::text, 'complete'::text, '2'::text, 2, 1, true, true)$$,
  'a teammate reads the head of the analysis with the Veo link, away score and flags'
);
select is(
  (select count(*)::int from analysis, jsonb_object_keys(body)),
  20, 'the analysis carries every part of the contract'
);
select is((select body->'availability'->'report'->>'reason' from analysis), 'not_provided', 'the availability per part is passed on');
select is(
  (select body->'teamStats'->0->'periodValues' from analysis),
  '[{"period": 1, "value": 1}, {"period": 2, "value": 1}]'::jsonb,
  'team values come with their values per period'
);
select results_eq(
  $$select (body->'players'->0->>'playerId')::uuid, (body->'players'->0->>'personId')::uuid, body->'players'->0->>'name',
           body->'players'->0->'stats'->0->'periodValues'->1->>'value' from analysis$$,
  $$select player_id, person_id, 'Ada Arnold'::text, '1287'::text from ids$$,
  'players carry the current assignment, person and values per period'
);
select results_eq(
  $$select event->>'id', (event->>'playerId')::uuid from analysis, jsonb_array_elements(body->'events') event$$,
  $$values ('e2'::text, null::uuid), ('e1'::text, (select player_id from ids))$$,
  'events are ordered by video time; only the own event is linked to the player, the opponent''s same jersey is not'
);
select results_eq(
  $$select position(E'\n' in body->'heatmaps'->0->>'cells'), octet_length(decode(body->'heatmaps'->0->>'cells', 'base64')) from analysis$$,
  $$values (0, 1800)$$,
  'heatmap cells come as one base64 line of width * height bytes'
);
select is(
  public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000001', gen_random_uuid()), null,
  'an unknown match gives no analysis'
);

-- 9: Eine neue Zuordnung wirkt sofort auf die Ereignisse (FR-023).
set local role postgres;
update public.playerboard_veo_player_assignments set player_id = null where fixture_id = (select fixture_id from ids);
set local role authenticated;
select is(
  (select count(*)::int from jsonb_array_elements(public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000001', (select fixture_id from ids))->'events') event
    where event->>'playerId' is not null),
  0, 'an unassigned jersey leaves the events without a player'
);

-- 10-12: Positionsdaten.
select results_eq(
  $$select tracks->>'sampleHz', tracks->'periods'->0->>'ownSide', tracks->'tracks'->0->>'side', tracks->'tracks'->0->>'samples'
      from (select public.playerboard_veo_match_tracks('00210000-1200-4000-8000-000000000001', (select fixture_id from ids)) as tracks) loaded$$,
  $$values ('1'::text, 'left'::text, 'left'::text, 'AAEAAg=='::text)$$,
  'a teammate reads the raw tracks with the periods'
);
select is(
  public.playerboard_veo_match_tracks('00210000-1200-4000-8000-000000000001', gen_random_uuid()), null,
  'an unknown match gives no tracks'
);
set local role postgres;
delete from public.playerboard_veo_tracks where fixture_id = (select fixture_id from ids);
set local role authenticated;
select is(
  public.playerboard_veo_match_tracks('00210000-1200-4000-8000-000000000001', (select fixture_id from ids))->'tracks', '[]'::jsonb,
  'a match without stored tracks gives an empty list'
);

-- 13-17: Nachbarmannschaft und fremder Verein; Spiel einer anderen Mannschaft.
select set_config('request.jwt.claim.sub', '00210000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000001', (select fixture_id from ids))$$,
  '42501', 'insufficient_permission', 'the coach of a neighbour team cannot read the analysis while visibility is team'
);
select throws_ok(
  $$select public.playerboard_veo_match_tracks('00210000-1200-4000-8000-000000000001', (select fixture_id from ids))$$,
  '42501', 'insufficient_permission', 'the coach of a neighbour team cannot read the tracks'
);
select is(
  public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000002', (select fixture_id from ids)), null,
  'the match of another team is not found through one''s own team'
);
select set_config('request.jwt.claim.sub', '00210000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000001', (select fixture_id from ids))$$,
  '42501', 'insufficient_permission', 'a member of another club cannot read the analysis'
);
select throws_ok(
  $$select public.playerboard_veo_match_tracks('00210000-1200-4000-8000-000000000001', (select fixture_id from ids))$$,
  '42501', 'insufficient_permission', 'a member of another club cannot read the tracks'
);

-- 18: anon darf die Funktionen nicht ausfuehren.
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok(
  $$select public.playerboard_veo_match_analysis('00210000-1200-4000-8000-000000000001', gen_random_uuid())$$,
  '42501', null, 'anon cannot call the read function'
);

select * from finish();
rollback;
