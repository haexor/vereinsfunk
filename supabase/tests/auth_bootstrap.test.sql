begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'meta@test.local', '', '{}', '{"display_name": "Meta User"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'nometa@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'viewer@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'deptadmin@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unrelated@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'scope@test.local', '', '{}', '{}', now(), now());

select is((select display_name from public.profiles where id = '30000000-0000-4000-8000-000000000001'), 'Meta User', 'trigger derives display_name from raw_user_meta_data when present');
select is((select display_name from public.profiles where id = '30000000-0000-4000-8000-000000000002'), 'nometa', 'trigger falls back to the email local part when metadata has no display_name');

insert into public.organizations (id, name, slug) values
  ('30000000-1000-4000-8000-000000000001', 'Org Bootstrap', 'org-bootstrap');
insert into public.departments (id, organization_id, name, slug) values
  ('30000000-1100-4000-8000-000000000001', '30000000-1000-4000-8000-000000000001', 'Department Bootstrap', 'department-bootstrap');
insert into public.teams (id, organization_id, department_id, name) values
  ('30000000-1200-4000-8000-000000000001', '30000000-1000-4000-8000-000000000001', '30000000-1100-4000-8000-000000000001', 'Team Bootstrap');

insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('30000000-1000-4000-8000-000000000001', '30000000-1100-4000-8000-000000000001', '30000000-1200-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'viewer'),
  ('30000000-1000-4000-8000-000000000001', '30000000-1100-4000-8000-000000000001', '30000000-1200-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'contributor');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('30000000-1000-4000-8000-000000000001', '30000000-1100-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'department_admin'),
  ('30000000-1000-4000-8000-000000000001', '30000000-1100-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'editor');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('30000000-1000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'organization_viewer');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.profiles), 1, 'authenticated user sees only their own profile row');
select is((select count(*)::integer from public.profiles where id = '30000000-0000-4000-8000-000000000002'), 0, 'authenticated user cannot see another users profile row');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select ok(authz.has_team_permission('30000000-1200-4000-8000-000000000001', 'analytics.view'), 'team viewer role grants analytics.view');
select ok(not authz.has_team_permission('30000000-1200-4000-8000-000000000001', 'post.create'), 'team viewer role does not grant post.create');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000005', true);
select ok(not authz.has_team_permission('30000000-1200-4000-8000-000000000001', 'analytics.view'), 'user with no relationship to the team has no team permission');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000004', true);
select ok(authz.has_team_permission('30000000-1200-4000-8000-000000000001', 'post.edit'), 'department admin escalation grants team-level permission');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000006', true);
select is((select authz.membership_scopes()->0->>'organizationId'), '30000000-1000-4000-8000-000000000001', 'membership_scopes includes the users organization id');
select is((select authz.membership_scopes()->0->>'organizationName'), 'Org Bootstrap', 'membership_scopes includes the users organization name');
select is((select authz.membership_scopes()->0->'departments'->0->>'id'), '30000000-1100-4000-8000-000000000001', 'membership_scopes includes the users department id');
select is((select authz.membership_scopes()->0->'departments'->0->'teams'->0->>'id'), '30000000-1200-4000-8000-000000000001', 'membership_scopes includes the users team id');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000005', true);
select is((select authz.membership_scopes()), '[]'::jsonb, 'user with no memberships anywhere gets an empty scopes array');

select * from finish();
rollback;
