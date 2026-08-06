begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-expiry.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'orgadmin@pgtap-expiry.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'deptadmin@pgtap-expiry.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'contributor@pgtap-expiry.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('64000000-1000-4000-8000-000000000001', 'PGTAP Befristung Verein', 'pgtap-befristung-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('64000000-1100-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', 'Abteilung', 'abteilung');

insert into public.organization_memberships (id, organization_id, user_id, role) values
  ('64000000-3000-4000-8000-000000000001', '64000000-1000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', 'organization_owner'),
  ('64000000-3000-4000-8000-000000000002', '64000000-1000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000002', 'organization_admin');
insert into public.department_memberships (id, organization_id, department_id, user_id, role) values
  ('64000000-3000-4000-8000-000000000003', '64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003', 'department_admin'),
  ('64000000-3000-4000-8000-000000000004', '64000000-1000-4000-8000-000000000001', '64000000-1100-4000-8000-000000000001', '64000000-0000-4000-8000-000000000004', 'contributor');

set local role authenticated;

-- 1-2: a department_admin sets an expiry on a contributor in their own department.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$select public.set_membership_expiry('department', '64000000-3000-4000-8000-000000000004', now() + interval '30 days')$$,
  'a department_admin can set an expiry on a contributor in their own department'
);
set local role postgres;
select ok(
  (select expires_at from public.department_memberships where id = '64000000-3000-4000-8000-000000000004') is not null,
  'the expiry was actually persisted'
);

-- 3: a plain contributor (no member.invite) cannot set anyone's expiry.
set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.set_membership_expiry('department', '64000000-3000-4000-8000-000000000003', now() + interval '30 days')$$,
  'P0001', 'insufficient_permission', 'a contributor without member.invite cannot set anyone''s expiry'
);

-- 4: escalation protection -- an organization_admin cannot set the expiry of an
-- organization_owner, the same rank check as change_membership_role/DELETE.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.set_membership_expiry('organization', '64000000-3000-4000-8000-000000000001', now() + interval '30 days')$$,
  'P0001', 'insufficient_permission', 'an organization_admin cannot set an organization_owner''s expiry'
);

-- 5: clearing an expiry (setting it back to null) works the same way.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$select public.set_membership_expiry('department', '64000000-3000-4000-8000-000000000004', null)$$,
  'an expiry can be cleared back to null'
);

-- 6: a non-existent membership id is reported as not_found.
select throws_ok(
  $$select public.set_membership_expiry('department', '64000000-9999-4000-8000-000000000099', now())$$,
  'P0001', 'not_found', 'a non-existent membership id is reported as not_found'
);

-- 7: an unknown target_scope is rejected before any permission or membership lookup runs.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.set_membership_expiry('bogus_scope', '64000000-3000-4000-8000-000000000004', now())$$,
  'P0001', 'invalid_scope', 'an unknown target_scope raises invalid_scope'
);

-- 8: last-owner protection -- unlike a DELETE, expiring the sole organization_owner's own
-- membership never fires prevent_last_owner_removal(), since the row is never removed, only
-- timed out later. set_membership_expiry must reject it the same way regardless.
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.set_membership_expiry('organization', '64000000-3000-4000-8000-000000000001', now() + interval '30 days')$$,
  'P0001', 'the last organization_owner cannot be removed', 'expiring the sole organization_owner is rejected'
);

select * from finish();
rollback;
