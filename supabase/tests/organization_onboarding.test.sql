begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

set local role postgres;

-- Test personas. U_expired_member and U_viewer get their organization_memberships row on
-- org X inserted further below, once org X's id is known (via slug lookup, since a plain
-- SQL script has no psql variables to capture it into).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-onboarding.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unrelated@pgtap-onboarding.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'otherorg@pgtap-onboarding.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'expired@pgtap-onboarding.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'slugsecond@pgtap-onboarding.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'limit@pgtap-onboarding.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'viewer@pgtap-onboarding.local', '', '{}', '{}', now(), now());

-- A pre-existing, unrelated organization so U_other_org_member has a membership that does
-- NOT belong to org X -- used by the responsible-person trigger's cross-tenant rejection test.
insert into public.organizations (id, name, slug) values
  ('40000000-9000-4000-8000-000000000001', 'PGTAP Other Org', 'pgtap-other-org');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('40000000-9000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'organization_owner');

set local role authenticated;

-- 1: authentication is mandatory, independent of the API layer.
select throws_ok(
  $$select public.create_organization('PGTAP No Auth Org', 'Hauptabteilung')$$,
  'P0001', null, 'create_organization requires auth.uid() to be present'
);

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);

-- 2: the happy path succeeds and returns the new organization id.
select isnt(
  public.create_organization('PGTAP Onboarding Owner Org', 'Hauptabteilung'),
  null, 'create_organization succeeds for an authenticated user and returns an id'
);

-- 3: exactly one row landed in every table the function touches.
select is((select count(*)::integer from public.organizations where slug = 'pgtap-onboarding-owner-org'), 1, 'exactly one organization was created');
select is((select count(*)::integer from public.organization_profiles where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 1, 'exactly one organization_profiles row was created');
select is((select count(*)::integer from public.organization_onboarding where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 1, 'exactly one organization_onboarding row was created');
select is((select count(*)::integer from public.departments where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 1, 'exactly one department was created');
select is((select count(*)::integer from public.organization_memberships where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org') and user_id = '40000000-0000-4000-8000-000000000001' and role = 'organization_owner'), 1, 'the creator became organization_owner');
select is((select count(*)::integer from public.department_memberships where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org') and user_id = '40000000-0000-4000-8000-000000000001' and role = 'department_admin'), 1, 'the creator became department_admin of the first department');
select is((select count(*)::integer from public.audit_events where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org') and action = 'organization.created'), 1, 'an audit event was recorded');

-- 4: a second, unrelated user cannot see the organization at all -- including the two new
-- tables, not just public.organizations.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.organizations where slug = 'pgtap-onboarding-owner-org'), 0, 'an unrelated user cannot see the new organization');
select is((select count(*)::integer from public.organization_profiles where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 0, 'an unrelated user cannot see its organization_profiles row');
select is((select count(*)::integer from public.organization_onboarding where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 0, 'an unrelated user cannot see its organization_onboarding row');

-- 5: a name collision is resolved with a numeric suffix, not an error.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000005', true);
select isnt(
  public.create_organization('PGTAP Onboarding Owner Org', 'Zweite Abteilung'),
  null, 'a colliding organization name still succeeds'
);
select is((select count(*)::integer from public.organizations where slug = 'pgtap-onboarding-owner-org-1'), 1, 'the colliding organization receives a numeric slug suffix');

-- 6: the per-owner limit is enforced inside the function itself, not only by the API caller.
set local role postgres;
insert into public.organization_memberships (organization_id, user_id, role, expires_at)
  select id, '40000000-0000-4000-8000-000000000004', 'organization_viewer', now() - interval '1 day'
  from public.organizations where slug = 'pgtap-onboarding-owner-org';
insert into public.organization_memberships (organization_id, user_id, role)
  select id, '40000000-0000-4000-8000-000000000007', 'organization_viewer'
  from public.organizations where slug = 'pgtap-onboarding-owner-org';
set local role authenticated;

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000006', true);
-- The limit must not be overridable by a caller-supplied argument -- otherwise
-- rpc('create_organization', { max_organizations_per_owner: 999 }) from the browser would
-- defeat the exact abuse guard this function exists to enforce. The 4-argument form must
-- not exist at all.
select throws_ok(
  $$select public.create_organization('PGTAP Should Not Exist', 'Abteilung', 'Europe/Berlin', 999)$$,
  '42883', null, 'the owner limit cannot be overridden by a caller-supplied parameter -- no 4-argument overload exists'
);
select isnt(public.create_organization('PGTAP Limit Org A', 'Abteilung'), null, 'organization 1 of 3 succeeds');
select isnt(public.create_organization('PGTAP Limit Org B', 'Abteilung'), null, 'organization 2 of 3 succeeds');
select isnt(public.create_organization('PGTAP Limit Org C', 'Abteilung'), null, 'organization 3 of 3 succeeds');
select throws_ok(
  $$select public.create_organization('PGTAP Limit Org D', 'Abteilung')$$,
  'P0001', null, 'a direct call over the hardcoded owner limit fails, independent of any API-side check'
);

-- 7: the responsible-person trigger enforces active membership of the *same* organization.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$update public.organization_profiles set responsible_person_profile_id = '40000000-0000-4000-8000-000000000001' where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')$$,
  'an active member of the organization can be set as the responsible person'
);
select is(
  (select responsible_person_profile_id from public.organization_profiles where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')),
  '40000000-0000-4000-8000-000000000001', 'the responsible person was actually persisted'
);
select throws_ok(
  $$update public.organization_profiles set responsible_person_profile_id = '40000000-0000-4000-8000-000000000003' where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')$$,
  'P0001', null, 'a member of a different organization is rejected as responsible person'
);
select throws_ok(
  $$update public.organization_profiles set responsible_person_profile_id = '40000000-0000-4000-8000-000000000002' where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')$$,
  'P0001', null, 'a profile with no membership anywhere is rejected as responsible person'
);
select throws_ok(
  $$update public.organization_profiles set responsible_person_profile_id = '40000000-0000-4000-8000-000000000004' where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')$$,
  'P0001', null, 'a member whose membership already expired is rejected as responsible person'
);

-- 8: organization.manage gates writes on organization_profiles/organization_onboarding; plain
-- membership (an organization_viewer here) only grants read access, matching the brand_profiles
-- policy shape this migration mirrors.
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.organization_profiles where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 1, 'a plain member can read organization_profiles');
update public.organization_profiles set legal_name = 'Hijacked by viewer' where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org');
select is((select legal_name from public.organization_profiles where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), null, 'a viewer without organization.manage cannot update organization_profiles');
update public.organization_onboarding set dismissed_at = now() where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org');
select is((select dismissed_at from public.organization_onboarding where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), null, 'a viewer without organization.manage cannot update organization_onboarding');

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
update public.organization_onboarding set completed_steps = array['branding'] where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org');
select is((select completed_steps from public.organization_onboarding where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), array['branding'], 'the owner can update onboarding progress');

-- 9: the queryable department-count invariant reports reality. service_role-only (see the
-- migration comment on its grant): authenticated must not be able to probe department
-- counts of organizations it is not a member of.
select throws_ok(
  $$select public.organization_department_count((select id from public.organizations where slug = 'pgtap-onboarding-owner-org'))$$,
  '42501', null, 'authenticated cannot call organization_department_count directly'
);
set local role postgres;
select is(public.organization_department_count((select id from public.organizations where slug = 'pgtap-onboarding-owner-org')), 1, 'organization_department_count reflects the single department created atomically');

select * from finish();
rollback;
