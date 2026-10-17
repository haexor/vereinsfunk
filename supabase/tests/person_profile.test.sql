begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

set local role postgres;

-- Spielerprofil auf Vereinsebene (2026101701_person_profile.sql). Verein O1 mit Abteilung A
-- (Mannschaften A1, A2) und Abteilung B (Mannschaft B1), fremder Verein O2. Mia steht in A1 und A2,
-- Jonas nur in A1, Ghost hat keinen Kader-Eintrag.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-pp.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'coach@pgtap-pp.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'player@pgtap-pp.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'neighbor@pgtap-pp.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'otherdept@pgtap-pp.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '58000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'foreign@pgtap-pp.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('58000000-1000-4000-8000-000000000001', 'PGTAP Profil', 'pgtap-profil'),
  ('58000000-1000-4000-8000-000000000002', 'PGTAP Profil Fremd', 'pgtap-profil-fremd');
insert into public.departments (id, organization_id, name, slug) values
  ('58000000-1100-4000-8000-00000000000a', '58000000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('58000000-1100-4000-8000-00000000000b', '58000000-1000-4000-8000-000000000001', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('58000000-1200-4000-8000-0000000000a1', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', 'U13'),
  ('58000000-1200-4000-8000-0000000000a2', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', 'U15'),
  ('58000000-1200-4000-8000-0000000000b1', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000b', 'Handball U13');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('58000000-1000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000001', 'organization_owner'),
  ('58000000-1000-4000-8000-000000000002', '58000000-0000-4000-8000-000000000006', 'organization_owner');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', '58000000-0000-4000-8000-000000000002', 'team_manager'),
  ('58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', '58000000-0000-4000-8000-000000000003', 'player'),
  ('58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a2', '58000000-0000-4000-8000-000000000004', 'player'),
  ('58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000b', '58000000-1200-4000-8000-0000000000b1', '58000000-0000-4000-8000-000000000005', 'player');

insert into public.directory_people (id, organization_id, department_id, team_id, first_name, last_name, birth_year, is_minor, email) values
  ('58000000-2000-4000-8000-000000000001', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', 'Mia', 'Keller', 2013, true, 'mia@pgtap-pp.local'),
  ('58000000-2000-4000-8000-000000000002', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', 'Jonas', 'Albers', 2013, true, null),
  ('58000000-2000-4000-8000-000000000003', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', 'Ghost', 'Gruber', 1980, false, null);
insert into public.playerboard_players (id, organization_id, department_id, team_id, directory_person_id, jersey_number, position) values
  ('58000000-3000-4000-8000-000000000001', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', '58000000-2000-4000-8000-000000000001', 7, 'Sturm'),
  ('58000000-3000-4000-8000-000000000002', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', '58000000-2000-4000-8000-000000000002', null, null),
  ('58000000-3000-4000-8000-000000000003', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a2', '58000000-2000-4000-8000-000000000001', 9, 'Mittelfeld');
insert into public.playerboard_point_categories (id, organization_id, scope, department_id, team_id, name, value_min, value_max) values
  ('58000000-4000-4000-8000-000000000001', '58000000-1000-4000-8000-000000000001', 'organization', null, null, 'Fairness', 0, 5);
-- Gestern gespeichert (Mia 5, Jonas 3), ein Entwurf (Mia 2) und ein altes gespeichertes Training (Mia 4).
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, title, status) values
  ('58000000-5000-4000-8000-000000000001', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', current_date - 1, 'Dienstag', 'saved'),
  ('58000000-5000-4000-8000-000000000002', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', current_date - 2, 'Entwurf', 'draft'),
  ('58000000-5000-4000-8000-000000000003', '58000000-1000-4000-8000-000000000001', '58000000-1100-4000-8000-00000000000a', '58000000-1200-4000-8000-0000000000a1', current_date - 400, 'Letzte Saison', 'saved');
insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value) values
  ('58000000-1000-4000-8000-000000000001', '58000000-5000-4000-8000-000000000001', '58000000-3000-4000-8000-000000000001', '58000000-4000-4000-8000-000000000001', 5),
  ('58000000-1000-4000-8000-000000000001', '58000000-5000-4000-8000-000000000001', '58000000-3000-4000-8000-000000000002', '58000000-4000-4000-8000-000000000001', 3),
  ('58000000-1000-4000-8000-000000000001', '58000000-5000-4000-8000-000000000002', '58000000-3000-4000-8000-000000000001', '58000000-4000-4000-8000-000000000001', 2),
  ('58000000-1000-4000-8000-000000000001', '58000000-5000-4000-8000-000000000003', '58000000-3000-4000-8000-000000000001', '58000000-4000-4000-8000-000000000001', 4);
-- Saisonbeginn vor 30 Tagen: das gestrige Training zaehlt zur laufenden Saison, das alte nicht.
insert into public.playerboard_settings (organization_id, scope, season_start, updated_by) values
  ('58000000-1000-4000-8000-000000000001', 'organization', current_date - 30, '58000000-0000-4000-8000-000000000001');

-- dieselben Faelle wie currentSeasonStart in packages/domain/src/playerboard.test.ts.
select is(authz.current_season_start('2026-07-01', '2026-10-08'), '2026-07-01'::date, 'season start earlier this year is the current season');
select is(authz.current_season_start('2026-07-01', '2027-03-15'), '2026-07-01'::date, 'season start of the previous calendar year still counts');
select is(authz.current_season_start('2020-08-15', '2026-08-15'), '2026-08-15'::date, 'the season start day itself starts the season');
select is(authz.current_season_start(null, '2026-10-08'), null, 'without a season start there is no season');
select is(authz.current_season_start('2024-02-29', '2025-03-01'), '2025-02-28'::date, 'a February 29 start is clamped in non-leap years');
select is(authz.current_season_start('2024-02-29', '2025-02-27'), '2024-02-29'::date, 'before the clamped day the previous season still runs');

-- --- Trainer der Mannschaft A1 ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000002', true);

-- Trainer sieht Jonas mit genau einer Mannschaft.
select is(public.person_profile('58000000-2000-4000-8000-000000000002')->>'firstName', 'Jonas', 'a coach sees a player of their team');
select is(jsonb_array_length(public.person_profile('58000000-2000-4000-8000-000000000002')->'teams'), 1, 'Jonas has one team');
-- Person ohne Kader, aber im Verzeichnis der Mannschaft (directory.read).
select is(public.person_profile('58000000-2000-4000-8000-000000000003')->>'firstName', 'Ghost', 'a coach with directory.read sees a person without a squad entry');
-- nie Geburtsjahr, Minderjaehrigkeit, E-Mail oder Konto.
select ok(
  not (public.person_profile('58000000-2000-4000-8000-000000000001') ?| array['birthYear', 'birth_year', 'isMinor', 'is_minor', 'email', 'hasAccount', 'profileId', 'profile_id']),
  'the profile never carries a birth year, a minor flag, an e-mail address or an account'
);

-- --- Spieler der Mannschaft A1 ----------------------------------------------------------------
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000003', true);

-- Mia steht in A1 und A2, der Spieler sieht nur A1.
select is(jsonb_array_length(public.person_profile('58000000-2000-4000-8000-000000000001')->'teams'), 1, 'a player sees only the teams whose figures they may see');
select is(public.person_profile('58000000-2000-4000-8000-000000000001')->'teams'->0->>'jerseyNumber', '7', 'the visible team carries the jersey number of that team');
-- Person ohne Kader ohne directory.read -> nicht sichtbar.
select is(public.person_profile('58000000-2000-4000-8000-000000000003'), null, 'a player does not see a person without a squad entry');

-- --- Spieler der Nachbarmannschaft A2 ---------------------------------------------------------
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000004', true);

-- Jonas steht nur in A1, bei stats_visibility team nicht sichtbar.
select is(public.person_profile('58000000-2000-4000-8000-000000000002'), null, 'a neighboring team does not see a player of another team');
-- Mia steht auch in A2 -> sichtbar, aber nur mit A2.
select is(public.person_profile('58000000-2000-4000-8000-000000000001')->'teams'->0->>'jerseyNumber', '9', 'a person in two teams shows only the team the viewer may see');

-- --- Spieler der anderen Abteilung -------------------------------------------------------------
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000005', true);
-- 13
select is(public.person_profile('58000000-2000-4000-8000-000000000001'), null, 'another department sees nothing');

-- --- Fremder Verein ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000006', true);
-- genauso wie bei einer unbekannten Id.
select is(public.person_profile('58000000-2000-4000-8000-000000000001'), null, 'a member of another club does not see the person');
select is(public.person_profile('58000000-2000-4000-8000-0000000000ff'), null, 'an unknown id answers the same way');

-- --- Vereinsinhaber ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000001', true);
-- Person ohne Kader: Profil mit leerer Mannschaftsliste.
select is(jsonb_array_length(public.person_profile('58000000-2000-4000-8000-000000000003')->'teams'), 0, 'a person without a squad entry has no teams');
-- Mia mit beiden Mannschaften.
select is(jsonb_array_length(public.person_profile('58000000-2000-4000-8000-000000000001')->'teams'), 2, 'one profile lists every team of a person in two teams');

-- gesamte Zeit zaehlt gespeicherte Trainings (5 + 4), der Entwurf zaehlt nie; die Saison nur das gestrige.
select is((select t->>'total' from jsonb_array_elements(public.person_profile('58000000-2000-4000-8000-000000000001', 'all')->'teams') t where t->>'teamId' = '58000000-1200-4000-8000-0000000000a1'),
  '9', 'the whole period adds saved trainings and ignores the draft');
select is((select t->>'total' from jsonb_array_elements(public.person_profile('58000000-2000-4000-8000-000000000001', 'season')->'teams') t where t->>'teamId' = '58000000-1200-4000-8000-0000000000a1'),
  '5', 'the current season counts only trainings since the season start');
-- gleiche Summen und Kategorien wie die Rangliste derselben Mannschaft.
select results_eq(
  $$select (t->>'total')::bigint, t->'categoryTotals'
      from jsonb_array_elements(public.person_profile('58000000-2000-4000-8000-000000000001', 'all')->'teams') t
     where t->>'teamId' = '58000000-1200-4000-8000-0000000000a1'$$,
  $$select ranking.total, ranking.category_totals
      from public.playerboard_team_ranking('58000000-1200-4000-8000-0000000000a1', null, null) ranking
     where ranking.player_id = '58000000-3000-4000-8000-000000000001'$$,
  'profile points and categories equal the team ranking for the same period'
);
-- Platz wie in der Rangliste (Mia 9 vor Jonas 3).
select is((select t->>'rank' from jsonb_array_elements(public.person_profile('58000000-2000-4000-8000-000000000001', 'all')->'teams') t where t->>'teamId' = '58000000-1200-4000-8000-0000000000a1'),
  '1', 'the rank equals the place in the team ranking');
-- ungueltiger Zeitraum.
select throws_ok($$select public.person_profile('58000000-2000-4000-8000-000000000001', 'foo')$$, 'P0001', 'invalid_period', 'an unknown period is rejected');

-- isSelf nur fuer das verknuepfte Konto.
set local role postgres;
update public.directory_people set profile_id = '58000000-0000-4000-8000-000000000003' where id = '58000000-2000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000003', true);
select is(public.person_profile('58000000-2000-4000-8000-000000000001')->'teams'->0->>'isSelf', 'true', 'the linked account sees its own profile marked');
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000002', true);
select is(public.person_profile('58000000-2000-4000-8000-000000000001')->'teams'->0->>'isSelf', 'false', 'another account does not');

-- stats_visibility department macht Jonas fuer die Nachbarmannschaft sichtbar, nicht fuer Abteilung B.
set local role postgres;
insert into public.playerboard_settings (organization_id, scope, department_id, stats_visibility, updated_by) values
  ('58000000-1000-4000-8000-000000000001', 'department', '58000000-1100-4000-8000-00000000000a', 'department', '58000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000004', true);
select is(public.person_profile('58000000-2000-4000-8000-000000000002')->>'firstName', 'Jonas', 'with stats_visibility department the neighboring team sees the player');
select set_config('request.jwt.claim.sub', '58000000-0000-4000-8000-000000000005', true);
select is(public.person_profile('58000000-2000-4000-8000-000000000002'), null, 'with stats_visibility department another department still sees nothing');

-- ohne Anmeldung nicht aufrufbar.
set local role anon;
select throws_ok($$select public.person_profile('58000000-2000-4000-8000-000000000001')$$, '42501', null, 'an anonymous caller cannot call the function');
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select is(public.person_profile('58000000-2000-4000-8000-000000000001'), null, 'a caller without a user answers like an unknown person');

select * from finish();
rollback;
