begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-delete-post-guard.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values ('70000000-1000-4000-8000-000000000001', 'PGTAP Delete Post Guard Verein', 'pgtap-delete-post-guard-verein');
insert into public.departments (id, organization_id, name, slug) values ('70000000-1100-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('70000000-2000-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', 'draft', '70000000-0000-4000-8000-000000000001'),
  ('70000000-2000-4000-8000-000000000002', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', 'awaiting_approval', '70000000-0000-4000-8000-000000000001');

insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('70000000-3000-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', '70000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '70000000-0000-4000-8000-000000000001');

-- 1-2: a plain draft (no approval history yet) is deleted, and its post_versions row cascades away
-- with it -- the loss of the version snapshot is fine, since the whole point is discarding it.
select is(public.delete_post_if_deletable('70000000-2000-4000-8000-000000000001'), '70000000-2000-4000-8000-000000000001'::uuid,
  'a plain draft is deleted and its id is returned');
select is((select count(*)::integer from public.post_versions where post_id = '70000000-2000-4000-8000-000000000001'), 0,
  'the deleted draft''s post_versions row cascades away with it');

-- 3-4: a post already awaiting approval is not silently removable -- it is part of a running
-- approval process a disappearance would confuse -- and keeps existing unchanged.
select throws_ok(
  $$select public.delete_post_if_deletable('70000000-2000-4000-8000-000000000002')$$,
  'P0001', 'post_not_deletable: awaiting_approval', 'a post already awaiting approval is rejected'
);
select is((select status from public.posts where id = '70000000-2000-4000-8000-000000000002'), 'awaiting_approval',
  'the rejected post keeps its status, unchanged by the failed delete attempt');

-- 5: a second delete attempt of the same (now-gone) draft returns null instead of erroring or
-- re-deleting -- the route turns this into a clean 404.
select is(public.delete_post_if_deletable('70000000-2000-4000-8000-000000000001'), null,
  'deleting an already-deleted post returns null instead of erroring or re-deleting');

-- 6: an unknown post id returns null too.
select is(public.delete_post_if_deletable('70000000-2000-4000-8000-000000000099'), null,
  'deleting a nonexistent post id returns null');

-- 7: only the service role may call the function directly -- the route's own permission check
-- ('post.edit') is what actually gates this for a browser-facing user.
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.delete_post_if_deletable('70000000-2000-4000-8000-000000000002')$$,
  '42501', null, 'authenticated cannot call delete_post_if_deletable directly'
);

select * from finish();
rollback;
