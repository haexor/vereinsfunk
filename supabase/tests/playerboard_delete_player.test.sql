begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- playerboard_delete_player loescht Kader-Eintrag und Punktestaende atomar unter einer Sperre.
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '41951000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-delete.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '41951000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'player@pgtap-pb-delete.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('41951000-1000-4000-8000-000000000001', 'PGTAP PB Delete', 'pgtap-pb-delete');
insert into public.departments (id, organization_id, name, slug) values
  ('41951000-1100-4000-8000-000000000001', '41951000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('41951000-1200-4000-8000-000000000001', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', 'U13');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', '41951000-0000-4000-8000-000000000001', 'team_manager'),
  ('41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', '41951000-0000-4000-8000-000000000002', 'player');
insert into public.directory_people (id, organization_id, department_id, team_id, first_name, last_name, birth_year) values
  ('41951000-2000-4000-8000-000000000001', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', 'Mia', 'Keller', 2013),
  ('41951000-2000-4000-8000-000000000002', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', 'Jonas', 'Albers', 2013),
  ('41951000-2000-4000-8000-000000000003', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', 'Lea', 'Sommer', 2013);
insert into public.playerboard_players (id, organization_id, department_id, team_id, directory_person_id) values
  ('41951000-3000-4000-8000-000000000001', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', '41951000-2000-4000-8000-000000000001'),
  ('41951000-3000-4000-8000-000000000002', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', '41951000-2000-4000-8000-000000000002'),
  ('41951000-3000-4000-8000-000000000003', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', '41951000-2000-4000-8000-000000000003');
insert into public.playerboard_point_categories (id, organization_id, scope, name, value_min, value_max) values
  ('41951000-4000-4000-8000-000000000001', '41951000-1000-4000-8000-000000000001', 'organization', 'Fairness', 0, 5);
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, status) values
  ('41951000-5000-4000-8000-000000000001', '41951000-1000-4000-8000-000000000001', '41951000-1100-4000-8000-000000000001', '41951000-1200-4000-8000-000000000001', current_date - 1, 'saved');
insert into public.playerboard_point_entries (organization_id, training_id, player_id, category_id, value) values
  ('41951000-1000-4000-8000-000000000001', '41951000-5000-4000-8000-000000000001', '41951000-3000-4000-8000-000000000001', '41951000-4000-4000-8000-000000000001', 4),
  ('41951000-1000-4000-8000-000000000001', '41951000-5000-4000-8000-000000000001', '41951000-3000-4000-8000-000000000003', '41951000-4000-4000-8000-000000000001', 2);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Negativ: ein Spieler ohne training.manage kann den Eintrag weder sperren noch loeschen.
select set_config('request.jwt.claim.sub', '41951000-0000-4000-8000-000000000002', true);
select is(public.playerboard_delete_player('41951000-3000-4000-8000-000000000002'), 'not_found', 'a player without training.manage cannot delete a squad entry');

select set_config('request.jwt.claim.sub', '41951000-0000-4000-8000-000000000001', true);
select is(public.playerboard_delete_player('41951000-3000-4000-8000-000000000001'), 'deleted', 'a squad entry and its points are deleted');
select is(public.playerboard_delete_player('41951000-3000-4000-8000-000000000002'), 'deleted', 'a squad entry without points is deleted');
select is(public.playerboard_delete_player('41951000-9000-4000-8000-000000000001'), 'not_found', 'an unknown squad entry is reported as not found');

-- Die API autorisiert training.manage selbst und loescht anschliessend ueber den Service-Client.
set local role service_role;
select is(public.playerboard_delete_player('41951000-3000-4000-8000-000000000003'), 'deleted', 'the service role can delete a squad entry and its points');

set local role postgres;
select is((select count(*)::integer from public.playerboard_players where organization_id = '41951000-1000-4000-8000-000000000001'), 0, 'all three removed squad entries are gone');
select is((select count(*)::integer from public.playerboard_point_entries where organization_id = '41951000-1000-4000-8000-000000000001'), 0, 'the removed squad entries points are gone as well');

set local role anon;
select throws_ok(
  $$select public.playerboard_delete_player('41951000-3000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot execute playerboard_delete_player'
);

select * from finish();
rollback;
