begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

set local role postgres;

-- Paket 053, PR 3: Lesen, Zuordnen, oeffentliche Ausgabe, mehrdeutige Spiele (2026101301_playerboard_veo_views.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '53300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-veo-views.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-pb-veo-views.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'neighbour@pgtap-pb-veo-views.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('53300000-1000-4000-8000-000000000001', 'PGTAP PB Veo Views', 'pgtap-pb-veo-views');
insert into public.departments (id, organization_id, name, slug) values
  ('53300000-1100-4000-8000-000000000001', '53300000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('53300000-1200-4000-8000-000000000001', '53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', 'U13'),
  ('53300000-1200-4000-8000-000000000002', '53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', 'U15');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', '53300000-1200-4000-8000-000000000001', '53300000-0000-4000-8000-000000000001', 'team_manager'),
  ('53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', '53300000-1200-4000-8000-000000000001', '53300000-0000-4000-8000-000000000002', 'player'),
  ('53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', '53300000-1200-4000-8000-000000000002', '53300000-0000-4000-8000-000000000003', 'team_manager');
-- Zwei Kandidaten zur selben Zeit fuer ein mehrdeutiges Veo-Spiel.
insert into public.fixtures (id, organization_id, department_id, team_id, opponent_name, kickoff_at, status) values
  ('53300000-3000-4000-8000-000000000001', '53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', '53300000-1200-4000-8000-000000000001', 'Alpha', '2026-09-19 10:00+00', 'scheduled'),
  ('53300000-3000-4000-8000-000000000002', '53300000-1000-4000-8000-000000000001', '53300000-1100-4000-8000-000000000001', '53300000-1200-4000-8000-000000000001', 'Beta', '2026-09-19 11:00+00', 'scheduled');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_create_player('53300000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 2013, true, null, 7, null, '53300000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('53300000-1200-4000-8000-000000000001', 'Ben', 'Berg', 2013, true, null, null, null, '53300000-0000-4000-8000-000000000001');
  perform public.playerboard_veo_link_team('53300000-1200-4000-8000-000000000001', '53300000-2000-4000-8000-000000000001', '\x01'::bytea, 'v1',
    'club', 'Testverein', 'u13', 'Testverein U13', '53300000-0000-4000-8000-000000000001');
end;
$$;
create temporary table veo_run on commit drop as
  select * from public.enqueue_integration_sync('53300000-1000-4000-8000-000000000001', '53300000-2000-4000-8000-000000000001', 'views-1', gen_random_uuid(), null);
grant select on veo_run to authenticated;

-- Zwei Veo-Spiele ohne Gegenstueck; Nummer 7 passt zu Ada, Nummer 5 zu niemandem.
do $$
declare match_id text;
begin
  foreach match_id in array array['m1', 'm2'] loop
    perform public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
      'veoMatchId', match_id, 'veoTeamId', 'veo-team', 'start', case match_id when 'm1' then '2026-09-05T10:00:00Z' else '2026-09-12T10:00:00Z' end,
      'opponentName', 'Gegner ' || match_id, 'isHome', false, 'ownScore', 1, 'opponentScore', 3,
      'teamStats', jsonb_build_array(jsonb_build_object('teamAssociation', 'own', 'statType', 'football_shots_total', 'category', 'attacking', 'value', 9, 'periodValues', '[]'::jsonb)),
      'players', jsonb_build_array(
        jsonb_build_object('jerseyNumber', 7, 'stats', jsonb_build_array(jsonb_build_object('statType', 'sprints_total', 'category', 'physical', 'value', 4))),
        jsonb_build_object('jerseyNumber', 5, 'stats', jsonb_build_array(jsonb_build_object('statType', 'sprints_total', 'category', 'physical', 'value', 2))))));
  end loop;
end;
$$;
create temporary table fixture_ids on commit drop as
  select mapped.veo_match_id, mapped.fixture_id from public.playerboard_veo_matches mapped where mapped.team_id = '53300000-1200-4000-8000-000000000001';
grant select on fixture_ids to authenticated;

-- 1-3: Spieler sieht Spiele mit Namen und Ergebnis aus eigener Sicht; Nachbarmannschaft nicht.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '53300000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.playerboard_veo_team_matches('53300000-1200-4000-8000-000000000001')), 2, 'a player sees both Veo matches');
select results_eq(
  $$select match->>'opponentName', (match->>'ownScore')::int, (match->>'opponentScore')::int, match->'players'->0->>'name', match->'players'->1->>'name'
      from jsonb_array_elements(public.playerboard_veo_team_matches('53300000-1200-4000-8000-000000000001', '2026-09-10', null)) match$$,
  $$values ('Gegner m2'::text, 1, 3, null::text, 'Ada Arnold'::text)$$,
  'an away match shows the own score first, matched jerseys carry the name, the range filters by date'
);
select set_config('request.jwt.claim.sub', '53300000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.playerboard_veo_team_matches('53300000-1200-4000-8000-000000000001')$$,
  '42501', 'insufficient_permission', 'the coach of another team cannot read the matches'
);

-- 4-5: Spieler darf nicht zuordnen; Trainer ordnet Nummer 5 Ben zu, auch im zweiten Spiel.
select set_config('request.jwt.claim.sub', '53300000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.playerboard_veo_assign_jersey((select fixture_id from fixture_ids where veo_match_id = 'm1'), 5,
      (select player.id from public.playerboard_players player join public.directory_people person on person.id = player.directory_person_id where person.first_name = 'Ben'), true)$$,
  '42501', 'insufficient_permission', 'a player cannot assign jersey numbers'
);
select set_config('request.jwt.claim.sub', '53300000-0000-4000-8000-000000000001', true);
select is(
  public.playerboard_veo_assign_jersey((select fixture_id from fixture_ids where veo_match_id = 'm1'), 5,
    (select player.id from public.playerboard_players player join public.directory_people person on person.id = player.directory_person_id where person.first_name = 'Ben'), true),
  2, 'the assignment is applied to the other match where number 5 is still open'
);

-- 6-7: Ein Spieler hat je Spiel nur eine Nummer; Offenlassen ist eine manuelle Entscheidung.
select throws_ok(
  $$select public.playerboard_veo_assign_jersey((select fixture_id from fixture_ids where veo_match_id = 'm1'), 7,
      (select player.id from public.playerboard_players player join public.directory_people person on person.id = player.directory_person_id where person.first_name = 'Ben'), false)$$,
  '23505', 'player_already_assigned', 'a player already holding a number in the match cannot take a second one'
);
select is(
  public.playerboard_veo_assign_jersey((select fixture_id from fixture_ids where veo_match_id = 'm2'), 7, null, false),
  1, 'clearing a number in one match changes only that match'
);

-- 8: Nach erneutem Abgleich bleiben beide Korrekturen bestehen.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
  'veoMatchId', 'm2', 'veoTeamId', 'veo-team', 'start', '2026-09-12T10:00:00Z', 'opponentName', 'Gegner m2', 'isHome', false,
  'ownScore', 1, 'opponentScore', 3, 'teamStats', '[]'::jsonb,
  'players', jsonb_build_array(jsonb_build_object('jerseyNumber', 7, 'stats', '[]'::jsonb), jsonb_build_object('jerseyNumber', 5, 'stats', '[]'::jsonb))));
select results_eq(
  $$select assignment.veo_jersey_number, person.first_name, assignment.matched_manually
      from public.playerboard_veo_player_assignments assignment
      left join public.playerboard_players player on player.id = assignment.player_id
      left join public.directory_people person on person.id = player.directory_person_id
     where assignment.fixture_id = (select fixture_id from fixture_ids where veo_match_id = 'm2') order by 1$$,
  $$values (5, 'Ben'::text, true), (7, null::text, true)$$,
  'manual assignments and a manual clear survive the next sync'
);

-- 9-11: oeffentlich nur mit Schalter und Freigabe, Spieler ohne Namen.
select is(public.playerboard_public_veo_stats('pgtap-pb-veo-views', 'u13'), '[]'::jsonb, 'without a public page there is nothing public');
set local role postgres;
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, public_veo_stats_enabled, public_slug, updated_by) values
  ('53300000-1000-4000-8000-000000000001', 'team', '53300000-1100-4000-8000-000000000001', '53300000-1200-4000-8000-000000000001', true, 'u13', '53300000-0000-4000-8000-000000000001');
set local role service_role;
select results_eq(
  $$select string_agg(player->>'label', ', ' order by (player->>'jerseyNumber')::int)
      from jsonb_array_elements(public.playerboard_public_veo_stats('pgtap-pb-veo-views', 'u13', '2026-09-01', '2026-09-06')) match
      cross join jsonb_array_elements(match->'players') player$$,
  $$values ('#5 B. B., #7 A. A.'::text)$$,
  'players appear only with jersey number and initials'
);
select ok(
  position('Arnold' in public.playerboard_public_veo_stats('pgtap-pb-veo-views', 'u13')::text) = 0
    and position('fixtureId' in public.playerboard_public_veo_stats('pgtap-pb-veo-views', 'u13')::text) = 0
    and position('playerId' in public.playerboard_public_veo_stats('pgtap-pb-veo-views', 'u13')::text) = 0,
  'the public output contains no names and no ids'
);

-- 12-13: mehrdeutiges Spiel merkt Kandidaten und Start; Auswahl haengt es beim naechsten Lauf an.
select is(
  public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
    'veoMatchId', 'm3', 'veoTeamId', 'veo-team', 'start', '2026-09-19T10:30:00Z', 'opponentName', 'Gamma',
    'isHome', true, 'ownScore', 2, 'opponentScore', 0, 'teamStats', '[]'::jsonb, 'players', '[]'::jsonb)),
  'conflict', 'two candidates without matching opponent are a conflict'
);
select results_eq(
  $$select current_value, incoming_value from public.integration_sync_conflicts where external_id = 'm3'$$,
  $$values ('53300000-3000-4000-8000-000000000001,53300000-3000-4000-8000-000000000002'::text, '2026-09-19T10:30:00Z'::text)$$,
  'the conflict keeps the candidates and the Veo start for the choice'
);
select public.playerboard_veo_resolve_conflict(
  (select id from public.integration_sync_conflicts where external_id = 'm3'), 'fixture', '53300000-3000-4000-8000-000000000002', '53300000-0000-4000-8000-000000000001');
select is(
  public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
    'veoMatchId', 'm3', 'veoTeamId', 'veo-team', 'start', '2026-09-19T10:30:00Z', 'opponentName', 'Gamma',
    'isHome', true, 'ownScore', 2, 'opponentScore', 0, 'teamStats', '[]'::jsonb, 'players', '[]'::jsonb)),
  'updated', 'the next sync attaches the Veo match to the chosen fixture'
);
select results_eq(
  $$select fixture.opponent_name, fixture.status::text, fixture.home_score
      from public.playerboard_veo_matches mapped join public.fixtures fixture on fixture.id = mapped.fixture_id
     where mapped.veo_match_id = 'm3'$$,
  $$values ('Beta'::text, 'played'::text, 2)$$,
  'the chosen fixture keeps its opponent and gets the result'
);

-- 16: eine bereits aufgeloeste Auswahl laesst sich nicht nochmal aendern.
select throws_ok(
  $$select public.playerboard_veo_resolve_conflict((select id from public.integration_sync_conflicts where external_id = 'm3'), 'ignore', null, null)$$,
  '55000', 'conflict_not_pending', 'a resolved conflict cannot be resolved again'
);

select * from finish();
rollback;
