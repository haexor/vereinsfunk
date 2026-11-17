begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '52800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-pb-addr.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('52800000-1000-4000-8000-000000000001', 'PGTAP PB Address', 'pgtap-pb-addr'),
  ('52800000-1000-4000-8000-000000000002', 'PGTAP PB Address B', 'pgtap-pb-addr-b');
insert into public.departments (id, organization_id, name, slug) values
  ('52800000-1100-4000-8000-000000000001', '52800000-1000-4000-8000-000000000001', 'Handball', 'handball'),
  ('52800000-1100-4000-8000-000000000002', '52800000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('52800000-1100-4000-8000-000000000003', '52800000-1000-4000-8000-000000000001', 'Archiv', 'archiv'),
  ('52800000-1100-4000-8000-000000000004', '52800000-1000-4000-8000-000000000002', 'Handball B', 'handball-b');
insert into public.teams (id, organization_id, department_id, name) values
  ('52800000-1200-4000-8000-000000000001', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000001', 'U13'),
  ('52800000-1200-4000-8000-000000000002', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000002', 'U13'),
  ('52800000-1200-4000-8000-000000000003', '52800000-1000-4000-8000-000000000002', '52800000-1100-4000-8000-000000000004', 'U13'),
  ('52800000-1200-4000-8000-000000000004', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000001', 'U15'),
  ('52800000-1200-4000-8000-000000000005', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000003', 'U13');
insert into public.playerboard_settings (organization_id, scope, department_id, team_id, public_points_enabled, public_trainings_enabled, public_veo_stats_enabled, public_photos_enabled, updated_by)
select team.organization_id, 'team', team.department_id, team.id, true, true, true, true, '52800000-0000-4000-8000-000000000001'
  from public.teams team where team.organization_id in ('52800000-1000-4000-8000-000000000001', '52800000-1000-4000-8000-000000000002');
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, title, status) values
  ('52800000-5000-4000-8000-000000000001', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000001', '52800000-1200-4000-8000-000000000001', current_date - 1, 'Handball U13', 'saved'),
  ('52800000-5000-4000-8000-000000000002', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000002', '52800000-1200-4000-8000-000000000002', current_date - 2, 'Fussball U13', 'saved'),
  ('52800000-5000-4000-8000-000000000003', '52800000-1000-4000-8000-000000000002', '52800000-1100-4000-8000-000000000004', '52800000-1200-4000-8000-000000000003', current_date - 3, 'Club B U13', 'saved'),
  ('52800000-5000-4000-8000-000000000004', '52800000-1000-4000-8000-000000000001', '52800000-1100-4000-8000-000000000001', '52800000-1200-4000-8000-000000000004', current_date - 4, 'Handball U15', 'saved');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Each three-segment address resolves its own team, even though three teams share the name U13.
select is((select team_id from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')),
  '52800000-1200-4000-8000-000000000001'::uuid, 'club, department and team resolve the handball team');
select is((select team_id from public.playerboard_public_team_info('pgtap-pb-addr', 'fussball', 'u13')),
  '52800000-1200-4000-8000-000000000002'::uuid, 'the same team slug in another department resolves its own team');
select is((select team_id from public.playerboard_public_team_info('pgtap-pb-addr-b', 'handball-b', 'u13')),
  '52800000-1200-4000-8000-000000000003'::uuid, 'the same team slug in another club resolves its own team');
select results_eq(
  $$select organization_id, department_id, team_id from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')$$,
  $$values ('52800000-1000-4000-8000-000000000001'::uuid, '52800000-1100-4000-8000-000000000001'::uuid, '52800000-1200-4000-8000-000000000001'::uuid)$$,
  'the info function returns the organization, department and team id');
select results_eq(
  $$select training_id from public.playerboard_public_trainings('pgtap-pb-addr', 'handball', 'u13')$$,
  $$values ('52800000-5000-4000-8000-000000000001'::uuid)$$,
  'the training list holds only the trainings of the addressed team');
select results_eq(
  $$select training_id from public.playerboard_public_trainings('pgtap-pb-addr', 'fussball', 'u13')$$,
  $$values ('52800000-5000-4000-8000-000000000002'::uuid)$$,
  'the same-named team of another department lists only its own training');
select results_eq(
  $$select training_id from public.playerboard_public_trainings('pgtap-pb-addr-b', 'handball-b', 'u13')$$,
  $$values ('52800000-5000-4000-8000-000000000003'::uuid)$$,
  'the same-named team of another club lists only its own training');

-- Mismatching segments resolve nothing.
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'fussball', 'u15')), 0,
  'a team slug of another department of the club does not resolve under this department');
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr-b', 'fussball', 'u13')), 0,
  'a department of another club does not resolve');
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball-b', 'u13')), 0,
  'a department slug of another club does not resolve under this club');
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'unknown')), 0,
  'an unknown team slug does not resolve');

select is((select public.playerboard_public_training('pgtap-pb-addr', 'handball', 'u13', '52800000-5000-4000-8000-000000000004')), null,
  'a training id of another team does not resolve');
select is((select public.playerboard_public_training('pgtap-pb-addr', 'handball', 'u13', '52800000-5000-4000-8000-000000000002')), null,
  'a training id of the same-named team in another department does not resolve');
select isnt((select public.playerboard_public_training('pgtap-pb-addr', 'handball', 'u13', '52800000-5000-4000-8000-000000000001')), null,
  'the own training id resolves');

-- Archived department and archived team.
set local role postgres;
update public.departments set archived_at = now() where id = '52800000-1100-4000-8000-000000000003';
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'archiv', 'u13')), 0,
  'an archived department serves nothing');
set local role postgres;
update public.teams set archived_at = now() where id = '52800000-1200-4000-8000-000000000004';
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u15')), 0,
  'an archived team serves nothing');

-- Sharing closed at club, department and team level, and the module closed.
set local role postgres;
insert into public.playerboard_settings (organization_id, scope, public_sharing_allowed, updated_by)
values ('52800000-1000-4000-8000-000000000001', 'organization', false, '52800000-0000-4000-8000-000000000001');
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')), 0,
  'sharing closed at club level hides the team');
set local role postgres;
delete from public.playerboard_settings where organization_id = '52800000-1000-4000-8000-000000000001' and scope = 'organization';
insert into public.playerboard_settings (organization_id, scope, department_id, public_sharing_allowed, updated_by)
values ('52800000-1000-4000-8000-000000000001', 'department', '52800000-1100-4000-8000-000000000001', false, '52800000-0000-4000-8000-000000000001');
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')), 0,
  'sharing closed at department level hides the team');
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'fussball', 'u13')), 1,
  'sharing closed in one department leaves the other department public');
set local role postgres;
delete from public.playerboard_settings where organization_id = '52800000-1000-4000-8000-000000000001' and scope = 'department';
update public.playerboard_settings set public_sharing_allowed = false where team_id = '52800000-1200-4000-8000-000000000001';
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')), 0,
  'sharing closed at team level hides the team');
set local role postgres;
update public.playerboard_settings set public_sharing_allowed = null where team_id = '52800000-1200-4000-8000-000000000001';
insert into public.subscription_plans (key, display_name, storage_bytes, included_modules)
values ('pgtap_no_playerboard', 'PGTAP without PlayerBoard', 1, '{}');
insert into public.organization_subscriptions (organization_id, plan_key)
values ('52800000-1000-4000-8000-000000000001', 'pgtap_no_playerboard');
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')), 0,
  'a club without the PlayerBoard module serves nothing');
set local role postgres;
delete from public.organization_subscriptions where organization_id = '52800000-1000-4000-8000-000000000001';

-- Data switches.
update public.playerboard_settings
   set public_points_enabled = false, public_trainings_enabled = false, public_veo_stats_enabled = false, public_photos_enabled = false
 where team_id = '52800000-1200-4000-8000-000000000001';
set local role service_role;
select is((select count(*)::int from public.playerboard_public_team_info('pgtap-pb-addr', 'handball', 'u13')), 0,
  'a team with every data switch off serves nothing');
select is((select count(*)::int from public.playerboard_public_trainings('pgtap-pb-addr', 'handball', 'u13')), 0,
  'the trainings switch off hides the training list');
select is((select public.playerboard_public_veo_stats('pgtap-pb-addr', 'handball', 'u13')), '[]'::jsonb,
  'the Veo switch off returns no matches');

-- Old two-argument signatures are gone, new ones are service-role only.
select hasnt_function('authz', 'playerboard_public_team', array['text', 'text'], 'the two-argument resolver no longer exists');
select is(
  (select count(*)::int from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public' and proc.proname like 'playerboard\_public\_%'
      and proc.proname in ('playerboard_public_team_info', 'playerboard_public_trainings', 'playerboard_public_training',
                           'playerboard_public_ranking', 'playerboard_public_photos', 'playerboard_public_veo_stats')
      and not (proc.proargnames @> array['department_slug'])),
  0, 'every public PlayerBoard function takes the department slug');
select is(
  (select count(*)::int from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public' and proc.proname in ('playerboard_public_team_info', 'playerboard_public_trainings',
          'playerboard_public_training', 'playerboard_public_ranking', 'playerboard_public_photos', 'playerboard_public_veo_stats')
      and has_function_privilege('service_role', proc.oid, 'execute')),
  6, 'service_role executes all six public functions');
select is(
  (select count(*)::int from pg_proc proc join pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public' and proc.proname in ('playerboard_public_team_info', 'playerboard_public_trainings',
          'playerboard_public_training', 'playerboard_public_ranking', 'playerboard_public_photos', 'playerboard_public_veo_stats')
      and (has_function_privilege('anon', proc.oid, 'execute') or has_function_privilege('authenticated', proc.oid, 'execute'))),
  0, 'anon and authenticated execute none of the public functions');

select * from finish();
rollback;
