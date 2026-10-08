begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

set local role postgres;

-- Paket 053, PR 2: Veo-Verbindung, Lauf einreihen, Spiel schreiben, Fehlerserie (2026101201_playerboard_veo.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '53200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-veo.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-pb-veo.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'neighbour@pgtap-pb-veo.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('53200000-1000-4000-8000-000000000001', 'PGTAP PB Veo', 'pgtap-pb-veo');
insert into public.departments (id, organization_id, name, slug) values
  ('53200000-1100-4000-8000-000000000001', '53200000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('53200000-1200-4000-8000-000000000001', '53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', 'U13'),
  ('53200000-1200-4000-8000-000000000002', '53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', 'U15');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', '53200000-1200-4000-8000-000000000001', '53200000-0000-4000-8000-000000000001', 'team_manager'),
  ('53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', '53200000-1200-4000-8000-000000000001', '53200000-0000-4000-8000-000000000002', 'player'),
  ('53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', '53200000-1200-4000-8000-000000000002', '53200000-0000-4000-8000-000000000003', 'team_manager');

-- Vorhandene Spiele im Spielplan (von Hand bzw. iCal, keine Veo-Quelle):
-- 1 = Gegenstueck zu Veo-Spiel A; 2 und 3 = zwei Kandidaten zur selben Zeit fuer Veo-Spiel C.
insert into public.fixtures (id, organization_id, department_id, team_id, is_home, opponent_name, kickoff_at, status) values
  ('53200000-3000-4000-8000-000000000001', '53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', '53200000-1200-4000-8000-000000000001', true, 'Gegner Nord', '2026-09-05 10:00+00', 'scheduled'),
  ('53200000-3000-4000-8000-000000000002', '53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', '53200000-1200-4000-8000-000000000001', null, 'Alpha', '2026-09-19 10:00+00', 'scheduled'),
  ('53200000-3000-4000-8000-000000000003', '53200000-1000-4000-8000-000000000001', '53200000-1100-4000-8000-000000000001', '53200000-1200-4000-8000-000000000001', null, 'Beta', '2026-09-19 11:00+00', 'scheduled');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_create_player('53200000-1200-4000-8000-000000000001', 'Ada', 'Arnold', 2013, true, null, 7, null, '53200000-0000-4000-8000-000000000001');
  perform public.playerboard_create_player('53200000-1200-4000-8000-000000000001', 'Ben', 'Berg', 2013, true, null, 10, null, '53200000-0000-4000-8000-000000000001');
end;
$$;

-- 1-2: Verbinden legt Quelle, Geheimnis und Verbindung an.
select is(
  public.playerboard_veo_link_team('53200000-1200-4000-8000-000000000001', '53200000-2000-4000-8000-000000000001', '\x0102'::bytea, 'v1',
    'club', 'Testverein', 'u13', 'Testverein U13', '53200000-0000-4000-8000-000000000001'),
  '53200000-2000-4000-8000-000000000001'::uuid,
  'linking returns the chosen source id'
);
select results_eq(
  $$select source.provider_key, source.transport::text, source.department_id, source.credentials_secret_id = secret.id
      from public.integration_sources source join public.integration_source_secrets secret on secret.source_id = source.id
     where source.id = '53200000-2000-4000-8000-000000000001'$$,
  $$values ('veo'::text, 'http'::text, '53200000-1100-4000-8000-000000000001'::uuid, true)$$,
  'the link is a department http source whose credentials point to the sealed secret'
);

-- 3: Neu verbinden mit einer anderen Quellen-ID scheitert (Wettlauf zweier Verbindungen).
select throws_ok(
  $$select public.playerboard_veo_link_team('53200000-1200-4000-8000-000000000001', gen_random_uuid(), '\x03'::bytea, 'v1',
      'club', 'Testverein', 'u13', 'Testverein U13', '53200000-0000-4000-8000-000000000001')$$,
  '40001', 'veo_link_changed', 'relinking must reuse the existing source'
);

-- 4-6: Lauf einreihen: genau ein aktiver Lauf, Auftrag nur mit IDs.
create temporary table veo_run on commit drop as
  select * from public.enqueue_integration_sync('53200000-1000-4000-8000-000000000001', '53200000-2000-4000-8000-000000000001', 'manual-1', gen_random_uuid(), '53200000-0000-4000-8000-000000000001');
grant select on veo_run to authenticated;
select is((select result from veo_run), 'acquired', 'the first sync request acquires the run slot');
select is(
  (select count(*)::integer from public.workflow_outbox where workflow_name = 'sync-integration-source' and entity_id = (select run_id from veo_run)),
  1, 'the worker job is queued with the run id'
);
select is(
  (select result from public.enqueue_integration_sync('53200000-1000-4000-8000-000000000001', '53200000-2000-4000-8000-000000000001', 'manual-2', gen_random_uuid(), null)),
  'already_running', 'a second request while the run is active does not start another one'
);

-- 7-9: Veo-Spiel A haengt an das vorhandene Spiel 1 an: Ergebnis ja, Stammdaten und Quelle bleiben.
select is(
  public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
    'veoMatchId', 'match-a', 'veoTeamId', 'veo-team', 'start', '2026-09-05T10:12:00Z', 'opponentName', 'Gegner Nord U13',
    'isHome', true, 'ownScore', 3, 'opponentScore', 1,
    'teamStats', jsonb_build_array(
      jsonb_build_object('teamAssociation', 'own', 'statType', 'football_goal_total', 'category', 'attacking', 'value', 3, 'periodValues', '[]'::jsonb),
      jsonb_build_object('teamAssociation', 'opponent', 'statType', 'football_goal_total', 'category', 'attacking', 'value', 1, 'periodValues', '[]'::jsonb)),
    'players', jsonb_build_array(
      jsonb_build_object('jerseyNumber', 7, 'stats', jsonb_build_array(jsonb_build_object('statType', 'sprints_total', 'category', 'physical', 'value', 12))),
      jsonb_build_object('jerseyNumber', 10, 'stats', jsonb_build_array(jsonb_build_object('statType', 'sprints_total', 'category', 'physical', 'value', 8))),
      jsonb_build_object('jerseyNumber', 99, 'stats', jsonb_build_array(jsonb_build_object('statType', 'sprints_total', 'category', 'physical', 'value', 5)))))),
  'updated', 'a Veo match next to an existing fixture is attached to it'
);
select results_eq(
  $$select status::text, home_score, away_score, opponent_name, source_id from public.fixtures where id = '53200000-3000-4000-8000-000000000001'$$,
  $$values ('played'::text, 3, 1, 'Gegner Nord'::text, null::uuid)$$,
  'the existing fixture gets the result but keeps its opponent and source'
);
select is(
  (select count(*)::integer from public.fixtures where team_id = '53200000-1200-4000-8000-000000000001'),
  3, 'attaching creates no duplicate fixture'
);

-- 10: Rueckennummern gegen den Kader, unbekannte Nummer bleibt offen.
select results_eq(
  $$select assignment.veo_jersey_number, person.first_name
      from public.playerboard_veo_player_assignments assignment
      left join public.playerboard_players player on player.id = assignment.player_id
      left join public.directory_people person on person.id = player.directory_person_id
     where assignment.fixture_id = '53200000-3000-4000-8000-000000000001' order by 1$$,
  $$values (7, 'Ada'::text), (10, 'Ben'::text), (99, null::text)$$,
  'jersey numbers are matched against the active roster'
);

-- 11-12: Veo-Spiel B ohne Gegenstueck legt ein neues Veo-Spiel an; ohne Ergebnis Status unknown.
select is(
  public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
    'veoMatchId', 'match-b', 'veoTeamId', 'veo-team', 'start', '2026-09-12T09:00:00Z', 'opponentName', 'Gegner Sued',
    'isHome', false, 'ownScore', null, 'opponentScore', null, 'teamStats', '[]'::jsonb, 'players', '[]'::jsonb)),
  'created', 'a Veo match without counterpart creates a fixture'
);
select results_eq(
  $$select status::text, is_home, source_id, external_id from public.fixtures
     where team_id = '53200000-1200-4000-8000-000000000001' and opponent_name = 'Gegner Sued'$$,
  $$values ('unknown'::text, false, '53200000-2000-4000-8000-000000000001'::uuid, 'match-b'::text)$$,
  'the new fixture belongs to the Veo source'
);

-- 13-14: zwei Kandidaten, Gegnername passt zu keinem: Konflikt statt Vermutung, nichts geschrieben.
select is(
  public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
    'veoMatchId', 'match-c', 'veoTeamId', 'veo-team', 'start', '2026-09-19T10:30:00Z', 'opponentName', 'Gamma',
    'isHome', true, 'ownScore', 2, 'opponentScore', 2, 'teamStats', '[]'::jsonb, 'players', '[]'::jsonb)),
  'conflict', 'an ambiguous match is reported as a conflict'
);
select results_eq(
  $$select kind, external_id, (select count(*)::integer from public.playerboard_veo_matches where veo_match_id = 'match-c')
      from public.integration_sync_conflicts where sync_run_id = (select run_id from veo_run)$$,
  $$values ('ambiguous_match'::text, 'match-c'::text, 0)$$,
  'the conflict is recorded and the match is not mapped'
);

-- 15-17: Spieler sieht die Werte, Nachbarmannschaft nicht, das Geheimnis niemand.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '53200000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.playerboard_veo_player_stats where fixture_id = '53200000-3000-4000-8000-000000000001'),
  3, 'a player sees the Veo values of the own team'
);
select set_config('request.jwt.claim.sub', '53200000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.playerboard_veo_match_stats) + (select count(*)::integer from public.playerboard_veo_links),
  0, 'the coach of another team sees neither values nor the link'
);
select throws_ok(
  $$select secret_ciphertext from public.integration_source_secrets$$,
  '42501', null, 'no member can read the sealed Veo session'
);

-- 18-19: Trainer korrigiert die Zuordnung; ein Kader-Eintrag hat je Spiel nur eine Nummer.
select set_config('request.jwt.claim.sub', '53200000-0000-4000-8000-000000000001', true);
update public.playerboard_veo_player_assignments set player_id = null, matched_manually = true
 where fixture_id = '53200000-3000-4000-8000-000000000001' and veo_jersey_number = 10;
select throws_ok(
  $$update public.playerboard_veo_player_assignments
       set player_id = (select player_id from public.playerboard_veo_player_assignments where fixture_id = '53200000-3000-4000-8000-000000000001' and veo_jersey_number = 7)
     where fixture_id = '53200000-3000-4000-8000-000000000001' and veo_jersey_number = 99$$,
  '23505', null, 'one roster entry cannot hold two jersey numbers in the same match'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.playerboard_veo_apply_match((select run_id from veo_run), jsonb_build_object(
    'veoMatchId', 'match-a', 'veoTeamId', 'veo-team', 'start', '2026-09-05T10:12:00Z', 'opponentName', 'Gegner Nord U13',
    'isHome', true, 'ownScore', 3, 'opponentScore', 1, 'teamStats', '[]'::jsonb,
    'players', jsonb_build_array(
      jsonb_build_object('jerseyNumber', 7, 'stats', '[]'::jsonb),
      jsonb_build_object('jerseyNumber', 10, 'stats', '[]'::jsonb)))),
  'updated', 'a second sync finds the attached fixture through the mapping'
);

-- 20: die manuelle Korrektur ueberlebt den erneuten Abgleich, die weggefallene Nummer 99 ist weg.
select results_eq(
  $$select veo_jersey_number, player_id is not null, matched_manually from public.playerboard_veo_player_assignments
     where fixture_id = '53200000-3000-4000-8000-000000000001' order by 1$$,
  $$values (7, true, false), (10, false, true)$$,
  'matched_manually survives a resync'
);

-- 21-24: Fehlerserie: Hinweis genau beim dritten Fehllauf, Erfolg setzt zurueck.
select is(
  (select notify from public.playerboard_veo_finish_sync((select run_id from veo_run), 'failed', 'upstream_error', 1, 1, 0, 1)),
  false, 'the first failure does not notify'
);
do $$
declare queued record;
begin
  for i in 2..3 loop
    select * into queued from public.enqueue_integration_sync('53200000-1000-4000-8000-000000000001', '53200000-2000-4000-8000-000000000001', 'manual-fail-' || i, gen_random_uuid(), null);
    perform public.playerboard_veo_finish_sync(queued.run_id, 'failed', 'auth_expired', 0, 0, 0, 0);
  end loop;
end;
$$;
select results_eq(
  $$select consecutive_failures, last_error_code, failure_notified_at is not null from public.playerboard_veo_links
     where team_id = '53200000-1200-4000-8000-000000000001'$$,
  $$values (3, 'auth_expired'::text, true)$$,
  'the third failure in a row marks the coach as notified'
);
select is(
  public.playerboard_veo_enqueue_scheduled_syncs(), 0,
  'a link that needs a new login is left out of the daily sync'
);
do $$
declare queued record;
begin
  select * into queued from public.enqueue_integration_sync('53200000-1000-4000-8000-000000000001', '53200000-2000-4000-8000-000000000001', 'manual-ok', gen_random_uuid(), null);
  perform public.playerboard_veo_finish_sync(queued.run_id, 'succeeded', null, 0, 1, 0, 0);
end;
$$;
select results_eq(
  $$select consecutive_failures, last_error_code, failure_notified_at from public.playerboard_veo_links
     where team_id = '53200000-1200-4000-8000-000000000001'$$,
  $$values (0, null::text, null::timestamptz)$$,
  'a successful run resets the failure series'
);

select * from finish();
rollback;
