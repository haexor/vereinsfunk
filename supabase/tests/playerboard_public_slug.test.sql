begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '52700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-slug.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('52700000-1000-4000-8000-000000000001', 'PGTAP PB Slug', 'pgtap-pb-slug'),
  ('52700000-1000-4000-8000-000000000002', 'PGTAP PB Slug Other', 'pgtap-pb-slug-other');
insert into public.organization_memberships (organization_id, user_id, role)
values ('52700000-1000-4000-8000-000000000001', '52700000-0000-4000-8000-000000000001', 'organization_owner');
insert into public.departments (id, organization_id, name, slug) values
  ('52700000-1100-4000-8000-000000000001', '52700000-1000-4000-8000-000000000001', 'Handball', 'pb-slug-handball'),
  ('52700000-1100-4000-8000-000000000002', '52700000-1000-4000-8000-000000000001', 'Fussball', 'pb-slug-fussball'),
  ('52700000-1100-4000-8000-000000000003', '52700000-1000-4000-8000-000000000002', 'Handball', 'pb-slug-handball-other');
insert into public.teams (id, organization_id, department_id, name) values
  ('52700000-1200-4000-8000-000000000001', '52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'Team Name'),
  ('52700000-1200-4000-8000-000000000002', '52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'Without Settings');
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, public_slug, updated_by)
values ('52700000-1000-4000-8000-000000000001', 'team', '52700000-1100-4000-8000-000000000001', '52700000-1200-4000-8000-000000000001', 'ignored-manual-slug', '52700000-0000-4000-8000-000000000001');

create function pg_temp.slug_of(target_team_id uuid) returns text language sql as
  $$ select public_slug from public.playerboard_settings where team_id = target_team_id $$;

select is(pg_temp.slug_of('52700000-1200-4000-8000-000000000001'), 'team-name',
  'the team slug is the normalized team name without department part or id');

update public.departments set name = 'Handball Abteilung' where id = '52700000-1100-4000-8000-000000000001';
select is(pg_temp.slug_of('52700000-1200-4000-8000-000000000001'), 'team-name',
  'renaming the department leaves the team slug unchanged');

update public.teams set name = 'U15' where id = '52700000-1200-4000-8000-000000000001';
select is(pg_temp.slug_of('52700000-1200-4000-8000-000000000001'), 'u15',
  'renaming a team regenerates its slug');

insert into public.teams (id, organization_id, department_id, name)
values ('52700000-1200-4000-8000-000000000003', '52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'U-13');
select throws_ok(
  $$insert into public.teams (organization_id, department_id, name)
    values ('52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'u_13')$$,
  '23505', 'duplicate key value violates unique constraint "teams_active_url_slug_unique"',
  'a team whose normalized name equals an active team of the department is rejected on insert');
select throws_ok(
  $$insert into public.teams (organization_id, department_id, name)
    values ('52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'u 13')$$,
  '23505', 'duplicate key value violates unique constraint "teams_active_url_slug_unique"',
  'spaces normalize to the same segment and are rejected on insert');
select throws_ok(
  $$update public.teams set name = 'U 13' where id = '52700000-1200-4000-8000-000000000001'$$,
  '23505', 'duplicate key value violates unique constraint "teams_active_url_slug_unique"',
  'renaming a team onto an active sibling name is rejected');
select is(pg_temp.slug_of('52700000-1200-4000-8000-000000000001'), 'u15',
  'the rejected rename leaves the slug unchanged');

insert into public.teams (id, organization_id, department_id, name)
values ('52700000-1200-4000-8000-000000000004', '52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000002', 'U-13');
select pass('the same team name is accepted in another department of the club');
insert into public.teams (id, organization_id, department_id, name)
values ('52700000-1200-4000-8000-000000000005', '52700000-1000-4000-8000-000000000002', '52700000-1100-4000-8000-000000000003', 'U-13');
select pass('the same team name is accepted in another club');

update public.teams set archived_at = now() where id = '52700000-1200-4000-8000-000000000003';
insert into public.teams (id, organization_id, department_id, name)
values ('52700000-1200-4000-8000-000000000006', '52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000001', 'U-13');
select pass('an archived team does not block a new team with its name');
select throws_ok(
  $$update public.teams set archived_at = null where id = '52700000-1200-4000-8000-000000000003'$$,
  '23505', 'duplicate key value violates unique constraint "teams_active_url_slug_unique"',
  'un-archiving into a name clash is rejected');
update public.teams set name = 'U-13 alt' where id = '52700000-1200-4000-8000-000000000003';
update public.teams set archived_at = null where id = '52700000-1200-4000-8000-000000000003';
select pass('un-archiving succeeds once the name no longer clashes');

update public.teams set name = '!!!' where id = '52700000-1200-4000-8000-000000000003';
select is(authz.team_url_slug('!!!'), 'mannschaft', 'a symbol-only name falls back to mannschaft');
select is(authz.team_url_slug(''), 'mannschaft', 'an empty name falls back to mannschaft');
select is(authz.team_url_slug('Mädchen Ü15 Straße'), 'madchen-u15-strasse',
  'umlauts and sharp s map like the shared slug part function');
select is(authz.team_url_slug(repeat('a', 79) || ' b'), repeat('a', 79),
  'the slug is cut to 80 characters without a trailing hyphen');
select is(char_length(authz.team_url_slug(repeat('a', 120))), 80, 'the slug never exceeds 80 characters');

insert into public.playerboard_settings (organization_id, scope, updated_by)
values ('52700000-1000-4000-8000-000000000001', 'organization', '52700000-0000-4000-8000-000000000001');
select is(
  (select public_slug from public.playerboard_settings where organization_id = '52700000-1000-4000-8000-000000000001' and scope = 'organization'),
  null, 'non-team settings rows keep public_slug null');

update public.playerboard_settings
   set public_sharing_allowed = true, public_trainings_enabled = true, public_points_enabled = false,
       public_player_name_format = 'full_name'
 where team_id = '52700000-1200-4000-8000-000000000001';
update public.teams set name = 'U16' where id = '52700000-1200-4000-8000-000000000001';
select results_eq(
  $$select public_slug, public_sharing_allowed, public_trainings_enabled, public_points_enabled, public_player_name_format
      from public.playerboard_settings where team_id = '52700000-1200-4000-8000-000000000001'$$,
  $$values ('u16'::text, true, true, false, 'full_name'::text)$$,
  'regenerating the slug leaves sharing, switches and the name format unchanged');

select is((select count(*)::int from public.playerboard_settings where team_id = '52700000-1200-4000-8000-000000000002'), 0,
  'a team without a settings row gets none');

set local role authenticated;
select set_config('request.jwt.claim.sub', '52700000-0000-4000-8000-000000000001', true);
insert into public.teams (organization_id, department_id, name)
values ('52700000-1000-4000-8000-000000000001', '52700000-1100-4000-8000-000000000002', 'Frauen');
select pass('a team can be inserted as authenticated with the slug index in place');
update public.teams set name = 'Frauen 2' where name = 'Frauen' and department_id = '52700000-1100-4000-8000-000000000002';
select pass('a team can be renamed as authenticated with the slug index in place');

select * from finish();
rollback;
