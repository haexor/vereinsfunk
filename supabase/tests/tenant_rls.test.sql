begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'a@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'b@test.local', '', '{}', '{}', now(), now());
insert into public.profiles (id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'User A'),
  ('20000000-0000-4000-8000-000000000002', 'User B')
on conflict (id) do update set display_name = excluded.display_name;
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
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, sha256, scan_status, created_by) values
  ('10000000-1200-4000-8000-000000000001', '10000000-1000-4000-8000-000000000001', '10000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/10000000-1000-4000-8000-000000000001/departments/10000000-1100-4000-8000-000000000001/assets/a/original.jpg', 'image/jpeg', 12, repeat('a',64), 'clean', '10000000-0000-4000-8000-000000000001'),
  ('20000000-2300-4000-8000-000000000002', '20000000-2000-4000-8000-000000000002', '20000000-2200-4000-8000-000000000002', 'raw-media', 'organizations/20000000-2000-4000-8000-000000000002/departments/20000000-2200-4000-8000-000000000002/assets/b/original.jpg', 'image/jpeg', 12, repeat('b',64), 'clean', '20000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.organizations), 1, 'member sees only their organization');
select is((select name from public.organizations), 'Organization A', 'member sees organization A');
select is((select count(*)::integer from public.departments), 1, 'member sees only their department scope');
select ok(authz.has_department_permission('10000000-1100-4000-8000-000000000001', 'post.edit'), 'editor can edit');
select ok(not authz.has_department_permission('10000000-1100-4000-8000-000000000001', 'post.approve'), 'editor cannot approve');
select ok(not authz.is_organization_member('20000000-2000-4000-8000-000000000002'), 'user A is not member of B');
select is((select count(*)::integer from public.media_assets), 1, 'user A cannot read media metadata from organization B');

select throws_ok(
  $$insert into public.submissions (organization_id, department_id, content_type, facts, created_by)
    values ('20000000-2000-4000-8000-000000000002', '20000000-2200-4000-8000-000000000002', 'event', '{}', '10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'cross-tenant insert is denied by RLS'
);
select throws_ok(
  $$insert into public.submissions (organization_id, department_id, content_type, preset_slug, communication_goal, requested_formats, source_material, facts, created_by)
    values ('20000000-2000-4000-8000-000000000002', '10000000-1100-4000-8000-000000000001', 'event', 'event', 'inform', '["feed_image"]', '{"facts":{},"observations":[],"quotes":[],"forbiddenTopics":[]}', '{}', '10000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'cross-tenant foreign key is denied'
);

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select ok(authz.has_department_permission('20000000-2200-4000-8000-000000000002', 'post.approve'), 'approver can approve in their department');
select is((select count(*)::integer from public.media_assets), 1, 'user B cannot read media metadata from organization A');
select is((select upload_status from public.media_assets where id = '10000000-1200-4000-8000-000000000001'), null, 'cross-tenant media mutation target is not visible');

select * from finish();
rollback;
