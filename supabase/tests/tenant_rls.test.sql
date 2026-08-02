begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'a@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'b@test.local', '', '{}', '{}', now(), now());
insert into public.profiles (id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'User A'),
  ('20000000-0000-4000-8000-000000000002', 'User B');
insert into public.organizations (id, name, slug) values
  ('10000000-1000-4000-8000-000000000001', 'Organization A', 'organization-a'),
  ('20000000-2000-4000-8000-000000000002', 'Organization B', 'organization-b');
insert into public.departments (id, organization_id, name, slug) values
  ('10000000-1100-4000-8000-000000000001', '10000000-1000-4000-8000-000000000001', 'Department A', 'department-a'),
  ('20000000-2200-4000-8000-000000000002', '20000000-2000-4000-8000-000000000002', 'Department B', 'department-b');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('10000000-1000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'organization_viewer'),
  ('20000000-2000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'organization_viewer');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('10000000-1000-4000-8000-000000000001', '10000000-1100-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'editor'),
  ('20000000-2000-4000-8000-000000000002', '20000000-2200-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'approver');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.organizations), 1, 'member sees only their organization');
select is((select name from public.organizations), 'Organization A', 'member sees organization A');
select is((select count(*)::integer from public.departments), 1, 'member sees only their department scope');
select ok(authz.has_department_permission('10000000-1100-4000-8000-000000000001', 'post.edit'), 'editor can edit');
select ok(not authz.has_department_permission('10000000-1100-4000-8000-000000000001', 'post.approve'), 'editor cannot approve');
select ok(not authz.is_organization_member('20000000-2000-4000-8000-000000000002'), 'user A is not member of B');

select throws_ok(
  $$insert into public.submissions (organization_id, department_id, content_type, facts, created_by)
    values ('20000000-2000-4000-8000-000000000002', '20000000-2200-4000-8000-000000000002', 'event', '{}', '10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'cross-tenant insert is denied by RLS'
);
select throws_ok(
  $$insert into public.submissions (organization_id, department_id, content_type, facts, created_by)
    values ('20000000-2000-4000-8000-000000000002', '10000000-1100-4000-8000-000000000001', 'event', '{}', '10000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'cross-tenant foreign key is denied'
);

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select ok(authz.has_department_permission('20000000-2200-4000-8000-000000000002', 'post.approve'), 'approver can approve in their department');

select * from finish();
rollback;
