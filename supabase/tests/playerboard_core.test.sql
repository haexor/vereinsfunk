begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

set local role postgres;

-- Paket 052, PR 1: PlayerBoard-Schema. Verein O1 mit Abteilung A (Mannschaften A1, A2) und
-- Abteilung B (Mannschaft B1), fremder Verein O2. Kein Abo: der Tarif schraenkt nichts ein.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-pb.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'coach@pgtap-pb.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'player@pgtap-pb.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'neighbor@pgtap-pb.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'otherdept@pgtap-pb.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'foreign@pgtap-pb.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'mia@pgtap-pb.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('52000000-1000-4000-8000-000000000001', 'PGTAP PlayerBoard', 'pgtap-playerboard'),
  ('52000000-1000-4000-8000-000000000002', 'PGTAP Fremd', 'pgtap-fremd');
insert into public.departments (id, organization_id, name, slug) values
  ('52000000-1100-4000-8000-00000000000a', '52000000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('52000000-1100-4000-8000-00000000000b', '52000000-1000-4000-8000-000000000001', 'Handball', 'handball'),
  ('52000000-1100-4000-8000-00000000000f', '52000000-1000-4000-8000-000000000002', 'Fremd', 'fremd');
insert into public.teams (id, organization_id, department_id, name) values
  ('52000000-1200-4000-8000-0000000000a1', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', 'U13'),
  ('52000000-1200-4000-8000-0000000000a2', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', 'U15'),
  ('52000000-1200-4000-8000-0000000000b1', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000b', 'Handball U13');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('52000000-1000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'organization_owner'),
  ('52000000-1000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000006', 'organization_owner');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', '52000000-0000-4000-8000-000000000002', 'team_manager'),
  ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', '52000000-0000-4000-8000-000000000003', 'player'),
  ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a2', '52000000-0000-4000-8000-000000000004', 'player'),
  ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000b', '52000000-1200-4000-8000-0000000000b1', '52000000-0000-4000-8000-000000000005', 'player');

insert into public.directory_people (id, organization_id, department_id, team_id, first_name, last_name, birth_year, email) values
  ('52000000-2000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'Mia', 'Keller', 2013, 'mia@pgtap-pb.local'),
  ('52000000-2000-4000-8000-000000000002', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'Jonas', 'Albers', 2013, null),
  ('52000000-2000-4000-8000-000000000003', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a2', 'Lena', 'Brandt', 2011, null),
  ('52000000-2000-4000-8000-000000000004', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000b', '52000000-1200-4000-8000-0000000000b1', 'Paul', 'Fischer', 2013, null);
insert into public.playerboard_players (id, organization_id, department_id, team_id, directory_person_id, jersey_number) values
  ('52000000-3000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', '52000000-2000-4000-8000-000000000001', 7),
  ('52000000-3000-4000-8000-000000000002', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', '52000000-2000-4000-8000-000000000002', null),
  ('52000000-3000-4000-8000-000000000003', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a2', '52000000-2000-4000-8000-000000000003', 10);
insert into public.playerboard_point_categories (id, organization_id, scope, department_id, team_id, name, value_min, value_max) values
  ('52000000-4000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001', 'organization', null, null, 'Fairness', 0, 5),
  ('52000000-4000-4000-8000-000000000002', '52000000-1000-4000-8000-000000000001', 'team', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'Tore', 0, 10),
  ('52000000-4000-4000-8000-000000000003', '52000000-1000-4000-8000-000000000001', 'department', '52000000-1100-4000-8000-00000000000b', null, 'Wurfquote', 0, 10);
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, title, status) values
  ('52000000-5000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', current_date - 1, 'Dienstag', 'saved'),
  ('52000000-5000-4000-8000-000000000002', '52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', current_date - 1, 'Entwurf', 'draft');
insert into public.playerboard_training_notes (organization_id, training_id, note) values
  ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000001', 'Mia war krank');
insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value) values
  ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000001', '52000000-3000-4000-8000-000000000001', '52000000-4000-4000-8000-000000000001', 5),
  ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000001', '52000000-3000-4000-8000-000000000002', '52000000-4000-4000-8000-000000000001', 3),
  ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000002', '52000000-3000-4000-8000-000000000001', '52000000-4000-4000-8000-000000000001', 2);

-- --- Spieler -----------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000003', true);

-- 1-5: ein Spieler sieht gespeicherte Trainings, Punkte und Notiz seiner Mannschaft, keine Entwuerfe.
select is((select count(*)::integer from public.playerboard_trainings where team_id = '52000000-1200-4000-8000-0000000000a1'), 1,
  'a player sees the saved training of their team but not the draft');
select is((select count(*)::integer from public.playerboard_point_entries), 2,
  'a player sees every point of every teammate in saved trainings');
select is((select count(*)::integer from public.playerboard_training_notes), 1,
  'a player reads the note of a saved training of their own team');
select is((select count(*)::integer from public.playerboard_players), 2,
  'a player sees the squad of their own team only');
select throws_ok(
  $$insert into public.playerboard_trainings (organization_id, department_id, team_id, training_date, created_by)
    values ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', current_date, '52000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'a player cannot create a training'
);

-- 6-8: Kader mit Namen und Rangliste auch ohne directory.read.
select is((select first_name from public.playerboard_team_roster('52000000-1200-4000-8000-0000000000a1') where jersey_number = 7), 'Mia',
  'a player reads teammate names through the roster function');
select is((select count(*)::integer from public.directory_people), 0,
  'a player still cannot read the directory itself');
select results_eq(
  $$select first_name, rank, total from public.playerboard_team_ranking('52000000-1200-4000-8000-0000000000a1')$$,
  $$values ('Mia'::text, 1::bigint, 5::bigint), ('Jonas'::text, 2::bigint, 3::bigint)$$,
  'the ranking counts saved trainings only and ranks by total'
);

-- --- Trainer -----------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);

-- 9-14: Entwuerfe, Schreibrechte und Konsistenz der Punkte.
select is((select count(*)::integer from public.playerboard_trainings where team_id = '52000000-1200-4000-8000-0000000000a1'), 2,
  'a coach also sees drafts');
select lives_ok(
  $$insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value)
    values ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000002', '52000000-3000-4000-8000-000000000002', '52000000-4000-4000-8000-000000000002', 4)$$,
  'a coach records points with a team category'
);
select throws_ok(
  $$insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value)
    values ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000002', '52000000-3000-4000-8000-000000000003', '52000000-4000-4000-8000-000000000001', 1)$$,
  'P0001', 'player_not_in_training_team', 'points for a player of another team are rejected'
);
select throws_ok(
  $$insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value)
    values ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000002', '52000000-3000-4000-8000-000000000001', '52000000-4000-4000-8000-000000000003', 1)$$,
  'P0001', 'category_not_effective', 'a category of another department is rejected'
);
select throws_ok(
  $$insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value)
    values ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000002', '52000000-3000-4000-8000-000000000001', '52000000-4000-4000-8000-000000000002', 11)$$,
  'P0001', 'point_value_out_of_range', 'a value outside the category range is rejected'
);
select throws_ok(
  $$insert into public.playerboard_trainings (organization_id, department_id, team_id, training_date, created_by)
    values ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', current_date + 2, '52000000-0000-4000-8000-000000000002')$$,
  'P0001', 'training_date_in_future', 'a training in the future is rejected'
);

-- 15-16: der Trainer holt keine Person in den Kader, die er nicht lesen darf, und keine in eine fremde Mannschaft.
select throws_ok(
  $$insert into public.playerboard_players (organization_id, department_id, team_id, directory_person_id)
    values ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', '52000000-2000-4000-8000-000000000004')$$,
  '42501', null, 'a coach cannot add a directory person of another department to the squad'
);
select throws_ok(
  $$insert into public.playerboard_players (organization_id, department_id, team_id, directory_person_id)
    values ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a2', '52000000-2000-4000-8000-000000000001')$$,
  '42501', null, 'a coach cannot write into the squad of a neighboring team'
);

-- --- Sichtbarkeit ueber die Mannschaft hinaus -------------------------------------------------
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000004', true);

-- 17: Standard 'team': die Nachbarmannschaft sieht nichts.
select is((select count(*)::integer from public.playerboard_point_entries), 0,
  'with stats_visibility team a neighboring team sees no points');

set local role postgres;
insert into public.playerboard_settings (organization_id, scope, department_id, stats_visibility, updated_by) values
  ('52000000-1000-4000-8000-000000000001', 'department', '52000000-1100-4000-8000-00000000000a', 'department', '52000000-0000-4000-8000-000000000001');
set local role authenticated;

-- 18-21: 'department': Punkte und gespeicherte Trainings ja, Notizen und Entwuerfe nicht.
select is((select count(*)::integer from public.playerboard_point_entries where training_id = '52000000-5000-4000-8000-000000000001'), 2,
  'with stats_visibility department a neighboring team sees the points');
select is((select count(*)::integer from public.playerboard_trainings where team_id = '52000000-1200-4000-8000-0000000000a1'), 1,
  'with stats_visibility department a neighboring team sees saved trainings only');
select is((select count(*)::integer from public.playerboard_training_notes), 0,
  'with stats_visibility department a neighboring team never sees training notes');
select is((select count(*)::integer from public.playerboard_team_ranking('52000000-1200-4000-8000-0000000000a1')), 2,
  'with stats_visibility department a neighboring team sees the ranking');

-- 22: ein Mitglied einer anderen Abteilung sieht bei 'department' nichts.
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.playerboard_point_entries), 0,
  'with stats_visibility department another department sees nothing');

-- 23-25: verbindliches 'organization' vom Verein schlaegt 'team' der Mannschaft, bis der Verein freigibt.
set local role postgres;
insert into public.playerboard_settings (organization_id, scope, stats_visibility, updated_by) values
  ('52000000-1000-4000-8000-000000000001', 'organization', 'organization', '52000000-0000-4000-8000-000000000001');
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, stats_visibility, updated_by) values
  ('52000000-1000-4000-8000-000000000001', 'team', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'team', '52000000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.playerboard_point_entries where training_id = '52000000-5000-4000-8000-000000000001'), 2,
  'a binding organization-wide visibility cannot be narrowed by a team');

set local role postgres;
update public.playerboard_settings set overridable_fields = '{stats_visibility}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';
update public.playerboard_settings set overridable_fields = '{stats_visibility}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
set local role authenticated;
select is((select count(*)::integer from public.playerboard_point_entries), 0,
  'once organization and department release the field, the team narrows it again');
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.playerboard_point_entries), 0,
  'the narrowed team value also hides the points from the neighboring team');

-- --- Vererbung --------------------------------------------------------------------------------
set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.playerboard_settings set season_start = '2026-07-01', overridable_fields = '{}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';
update public.playerboard_settings set season_start = null, overridable_fields = '{}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
update public.playerboard_settings set season_start = '2026-08-01'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';

-- 26-29: Saisonbeginn verbindlich, freigegeben, von der Abteilung wieder gesperrt, gesperrt nicht freigebbar.
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'season_start'),
  '2026-07-01', 'a season start set by the organization binds every team');
update public.playerboard_settings set overridable_fields = '{season_start}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';
update public.playerboard_settings set season_start = '2026-09-01'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'season_start'),
  '2026-09-01', 'a release reaches one level only: the department value binds the team');
update public.playerboard_settings set overridable_fields = '{season_start}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'season_start'),
  '2026-08-01', 'released by organization and department, the team uses its own value');
update public.playerboard_settings set overridable_fields = '{}'
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'season_start'),
  '2026-07-01', 'a department cannot release a field the organization locked');

-- 30-32: team_categories_allowed nur verschaerfen.
update public.playerboard_settings set team_categories_allowed = false
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';
update public.playerboard_settings set team_categories_allowed = true
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'team_categories_allowed'),
  'false', 'team_categories_allowed false on the organization beats true below');
select is((select count(*)::integer from public.playerboard_effective_categories('52000000-1200-4000-8000-0000000000a1') where scope = 'team'), 0,
  'team categories are not effective once the organization forbids them');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.playerboard_point_categories (organization_id, scope, department_id, team_id, name)
    values ('52000000-1000-4000-8000-000000000001', 'team', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', 'Ballgefuehl')$$,
  '42501', null, 'a coach cannot add team categories once the organization forbids them'
);
set local role postgres;
update public.playerboard_settings set team_categories_allowed = null
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';

-- --- Modul aus --------------------------------------------------------------------------------
-- 33-38: je Ebene einzeln (Verein, Abteilung, Mannschaft) sieht der Spieler nichts mehr, der Trainer
-- schreibt nichts mehr.
insert into public.policy_settings (organization_id, scope, enabled_modules, updated_by) values
  ('52000000-1000-4000-8000-000000000001', 'organization', '{social_media}', '52000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.playerboard_point_entries), 0, 'module off on the organization hides the points');
select is((select count(*)::integer from public.playerboard_point_categories), 0, 'module off on the organization hides point categories');
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', null, null, 'stats_visibility'), null,
  'module off on the organization hides settings through the exposed authz function');
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.playerboard_trainings (organization_id, department_id, team_id, training_date, created_by)
    values ('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', current_date, '52000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'module off on the organization blocks writing'
);
set local role postgres;
update public.policy_settings set enabled_modules = null where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'organization';
insert into public.policy_settings (organization_id, scope, department_id, enabled_modules, updated_by) values
  ('52000000-1000-4000-8000-000000000001', 'department', '52000000-1100-4000-8000-00000000000a', '{social_media}', '52000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.playerboard_point_entries), 0, 'module off on the department hides the points');
select is((select count(*)::integer from public.playerboard_settings where scope = 'department'), 0,
  'module off on the department hides department settings');
set local role postgres;
update public.policy_settings set enabled_modules = null where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
insert into public.policy_settings (organization_id, scope, department_id, team_id, enabled_modules, updated_by) values
  ('52000000-1000-4000-8000-000000000001', 'team', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1', '{}', '52000000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.playerboard_team_roster('52000000-1200-4000-8000-0000000000a1')), 0, 'module off on the team hides the squad');
set local role postgres;
update public.policy_settings set enabled_modules = null where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';

-- --- Fremder Verein ---------------------------------------------------------------------------
-- 37-40
set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.playerboard_trainings), 0, 'a foreign organization sees no trainings');
select is((select count(*)::integer from public.playerboard_settings), 0, 'a foreign organization sees no settings');
select is((select count(*)::integer from public.playerboard_team_ranking('52000000-1200-4000-8000-0000000000a1')), 0, 'a foreign organization gets no ranking');
select is(authz.playerboard_setting('52000000-1000-4000-8000-000000000001', null, null, 'stats_visibility'), null,
  'a foreign organization cannot read the settings through the exposed authz schema');

-- --- Oeffentliche Mannschaftsseite ------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- 41: ohne Slug und Schalter gibt es keine oeffentliche Seite.
select is((select count(*)::integer from public.playerboard_public_team_info('pgtap-playerboard', 'u13')), 0,
  'without a public slug there is no public team page');

set local role postgres;
update public.playerboard_settings set public_slug = 'u13', public_points_enabled = true
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';
set local role service_role;

-- 42-45: Rangliste nur mit Rueckennummer und Initialen.
select results_eq(
  $$select rank, label, total from public.playerboard_public_ranking('pgtap-playerboard', 'u13')$$,
  $$values (1::bigint, '#7 M. K.'::text, 5::bigint), (2::bigint, 'J. A.'::text, 3::bigint)$$,
  'the public ranking shows jersey number and initials only'
);
select is(
  (select count(*)::integer from (select to_jsonb(r)::text as payload from public.playerboard_public_ranking('pgtap-playerboard', 'u13') r) dump
    where payload ~ '(Mia|Keller|Jonas|Albers|2013|52000000-)'),
  0, 'the public ranking never contains names, birth years or ids'
);
select is(
  (select category_totals from public.playerboard_public_ranking('pgtap-playerboard', 'u13') where rank = 1),
  '[{"points": 5, "category": "Fairness"}]'::jsonb, 'public category totals carry names, not ids'
);
select is((select photos_enabled from public.playerboard_public_team_info('pgtap-playerboard', 'u13')), false,
  'public photos stay off until the coach enables them');

-- 46-47: public_sharing_allowed = false oder Modul aus schliesst die Seite.
set local role postgres;
update public.playerboard_settings set public_sharing_allowed = false
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
set local role service_role;
select is((select count(*)::integer from public.playerboard_public_ranking('pgtap-playerboard', 'u13')), 0,
  'public_sharing_allowed false on the department closes the public page');
set local role postgres;
update public.playerboard_settings set public_sharing_allowed = null
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'department';
update public.policy_settings set enabled_modules = '{social_media}' where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';
set local role service_role;
select is((select count(*)::integer from public.playerboard_public_ranking('pgtap-playerboard', 'u13')), 0,
  'module off closes the public page');
set local role postgres;
update public.policy_settings set enabled_modules = null where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';

-- 48-49: weder anon noch angemeldete Nutzer rufen die oeffentlichen Funktionen direkt auf.
set local role anon;
select throws_ok($$select * from public.playerboard_public_ranking('pgtap-playerboard', 'u13')$$, '42501', null,
  'anon cannot execute the public ranking function');
set local role authenticated;
select throws_ok($$select public.playerboard_public_label('52000000-2000-4000-8000-000000000001', 7)$$, '42501', null,
  'authenticated cannot execute the public label function');

-- --- Fotos ------------------------------------------------------------------------------------
set local role postgres;
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into public.consent_records (id, organization_id, directory_person_id, scope, scope_structured, origin, signer_role, created_by) values
  ('52000000-6000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001', '52000000-2000-4000-8000-000000000001', 'Website Training',
   '{"purposes": ["website"], "platforms": null, "mediaKinds": ["photo"], "contexts": ["training"], "namingAllowed": false, "departmentIds": null}', 'paper', 'self', '52000000-0000-4000-8000-000000000001'),
  ('52000000-6000-4000-8000-000000000002', '52000000-1000-4000-8000-000000000001', '52000000-2000-4000-8000-000000000002', 'Nur Social Media',
   '{"purposes": ["social_media"], "platforms": null, "mediaKinds": ["photo"], "contexts": null, "namingAllowed": false, "departmentIds": null}', 'paper', 'self', '52000000-0000-4000-8000-000000000001');
update public.playerboard_settings set public_photos_enabled = true
 where organization_id = '52000000-1000-4000-8000-000000000001' and scope = 'team';

set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);

-- 50-51: ein Foto startet privat und ungeprueft; "public" laesst sich beim Einfuegen gar nicht setzen.
select throws_ok(
  $$insert into public.playerboard_training_photos (organization_id, training_id, storage_path, content_type, size_bytes, uploaded_by, public)
    values ('52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001/52000000-1200-4000-8000-0000000000a1/52000000-5000-4000-8000-000000000001/x.jpg', 'image/jpeg', 1000, '52000000-0000-4000-8000-000000000002', true)$$,
  '42501', null, 'a photo cannot be inserted as public'
);
insert into public.playerboard_training_photos (id, organization_id, training_id, storage_path, content_type, size_bytes, uploaded_by)
  values ('52000000-7000-4000-8000-000000000001', '52000000-1000-4000-8000-000000000001', '52000000-5000-4000-8000-000000000001',
          '52000000-1000-4000-8000-000000000001/52000000-1200-4000-8000-0000000000a1/52000000-5000-4000-8000-000000000001/p1.jpg', 'image/jpeg', 1000, '52000000-0000-4000-8000-000000000002');
select is((select consent_review_status || '/' || public::text from public.playerboard_training_photos where id = '52000000-7000-4000-8000-000000000001'),
  'pending/false', 'a new photo is pending and private');

-- 53-59: oeffentlich nur nach vollstaendigem Review mit gueltigen Einwilligungen.
select throws_ok($$select public.playerboard_set_photo_public('52000000-7000-4000-8000-000000000001', true)$$,
  'P0001', 'photo_consent_not_approved', 'a photo cannot be made public before the consent review');
select throws_ok(
  $$select public.playerboard_review_photo_consent('52000000-7000-4000-8000-000000000001', null, true, true)$$,
  'P0001', 'invalid_people', 'the photo review requires a JSON array of people');
select throws_ok(
  $$select public.playerboard_review_photo_consent('52000000-7000-4000-8000-000000000001',
    '[{"directoryPersonId": "52000000-2000-4000-8000-000000000001", "consentRecordId": "52000000-6000-4000-8000-000000000001"}]', false, true)$$,
  'P0001', 'recognizable_people_not_confirmed', 'the review requires confirming that every recognizable person is listed'
);
select throws_ok(
  $$select public.playerboard_review_photo_consent('52000000-7000-4000-8000-000000000001',
    '[{"directoryPersonId": "52000000-2000-4000-8000-000000000001", "consentRecordId": "52000000-6000-4000-8000-000000000001"},
      {"directoryPersonId": "52000000-2000-4000-8000-000000000002", "consentRecordId": "52000000-6000-4000-8000-000000000002"}]', true, true)$$,
  'P0001', 'photo_consent_invalid', 'a person without a website consent blocks the release'
);
select is(
  (select consent_review_status || '/' || public::text from public.playerboard_review_photo_consent('52000000-7000-4000-8000-000000000001',
    '[{"directoryPersonId": "52000000-2000-4000-8000-000000000001", "consentRecordId": "52000000-6000-4000-8000-000000000001"}]', true, true)),
  'approved/true', 'a complete review with valid consents approves and publishes the photo'
);

-- 56-57: die Nachbarmannschaft sieht Fotos und Personenlisten auch bei weiter gefasster Sichtbarkeit nicht.
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.playerboard_training_photos), 0, 'training photos stay internal to the team');
select is((select count(*)::integer from public.playerboard_training_photo_people), 0,
  'photo person links stay internal to the team');

-- 62-65: oeffentliche Fotos, Ausnehmen, Widerruf.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*)::integer from public.playerboard_public_photos('pgtap-playerboard', 'u13')), 1,
  'an approved public photo appears on the public page');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select is((select public from public.playerboard_set_photo_public('52000000-7000-4000-8000-000000000001', false)), false,
  'a coach can exclude a single photo');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*)::integer from public.playerboard_public_photos('pgtap-playerboard', 'u13')), 0,
  'an excluded photo disappears from the public page');
set local role postgres;
update public.playerboard_training_photos set public = true where id = '52000000-7000-4000-8000-000000000001';
update public.consent_records set revoked_at = now(), revoked_by = 'guardian' where id = '52000000-6000-4000-8000-000000000001';
select is((select consent_review_status || '/' || public::text from public.playerboard_training_photos where id = '52000000-7000-4000-8000-000000000001'),
  'blocked/false', 'revoking a consent blocks the photo and makes it private');

-- --- Einladung eines Kaderspielers ------------------------------------------------------------
-- 62-63
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.create_invitation('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1',
    'lena@pgtap-pb.local', 'player', 'pgtap-pb-hash-lena', '52000000-2000-4000-8000-000000000003')$$,
  'P0001', 'directory_person_not_in_team', 'an invitation can only point to a person of this team''s squad'
);
select public.create_invitation('52000000-1000-4000-8000-000000000001', '52000000-1100-4000-8000-00000000000a', '52000000-1200-4000-8000-0000000000a1',
  'mia@pgtap-pb.local', 'player', encode(extensions.digest('pgtap-pb-token-mia', 'sha256'), 'hex'), '52000000-2000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000007', true);
select public.accept_invitation('pgtap-pb-token-mia');
set local role postgres;
select is((select profile_id from public.directory_people where id = '52000000-2000-4000-8000-000000000001'), '52000000-0000-4000-8000-000000000007'::uuid,
  'accepting a squad invitation links the account to the directory person');

select * from finish();
rollback;
