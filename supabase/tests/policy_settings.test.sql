begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-policy.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'deptaadmin@pgtap-policy.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'deptbadmin@pgtap-policy.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'teamxmanager@pgtap-policy.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'deptbviewer@pgtap-policy.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'deptbeditor@pgtap-policy.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('63000000-1000-4000-8000-000000000001', 'PGTAP Policy Verein', 'pgtap-policy-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('63000000-1100-4000-8000-000000000001', '63000000-1000-4000-8000-000000000001', 'Abteilung A', 'abteilung-a'),
  ('63000000-1100-4000-8000-000000000002', '63000000-1000-4000-8000-000000000001', 'Abteilung B', 'abteilung-b');
insert into public.teams (id, organization_id, department_id, name) values
  ('63000000-1200-4000-8000-000000000001', '63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', 'Team X');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('63000000-1000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'organization_owner');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', '63000000-0000-4000-8000-000000000002', 'department_admin'),
  ('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000002', '63000000-0000-4000-8000-000000000003', 'department_admin'),
  ('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000002', '63000000-0000-4000-8000-000000000005', 'viewer'),
  ('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000002', '63000000-0000-4000-8000-000000000006', 'editor');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', '63000000-1200-4000-8000-000000000001', '63000000-0000-4000-8000-000000000004', 'team_manager');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('63000000-2000-4000-8000-000000000001', '63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', 'published', '63000000-0000-4000-8000-000000000002'),
  ('63000000-2000-4000-8000-000000000002', '63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000002', 'published', '63000000-0000-4000-8000-000000000003');

set local role authenticated;

-- 1: with no policy_settings row at all, both flags default to true (opt-out, not opt-in).
select ok(
  authz.resolve_policy_flag('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', null, 'invite_allowed'),
  'invite_allowed defaults to true when nothing overrides it'
);

-- 2-3: the organization owner disables invite_allowed club-wide; a department without its own
-- override now inherits false.
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'organization', null, null, 'invite_allowed', false);
select is(
  (select invite_allowed from public.policy_settings where organization_id = '63000000-1000-4000-8000-000000000001' and scope = 'organization'),
  false, 'the organization-level row was written'
);
select ok(
  not authz.resolve_policy_flag('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', null, 'invite_allowed'),
  'a department without its own row inherits the organization''s false'
);

-- 4: a department can never loosen what the organization tightened -- even if its own row says
-- true, the effective value stays false (AND-reduction, not "innermost row always wins").
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'department', '63000000-1100-4000-8000-000000000001', null, 'invite_allowed', true);
select ok(
  not authz.resolve_policy_flag('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000001', null, 'invite_allowed'),
  'a department cannot loosen an organization-level restriction, even by storing true on its own row'
);

-- 5-6: set_policy_setting enforces the same manage-permission per scope as the rest of the app --
-- a department_admin of Abteilung B cannot touch the organization-level row.
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'organization', null, null, 'invite_allowed', false)$$,
  'P0001', 'insufficient_permission', 'a department_admin cannot set the organization-level policy row'
);

-- 7: a team_manager (without team.manage, same gap as struktur.vue's existing archive controls)
-- cannot set their own team's policy row -- only a department_admin of the parent department can.
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'team', '63000000-1100-4000-8000-000000000001', '63000000-1200-4000-8000-000000000001', 'invite_allowed', false)$$,
  'P0001', 'insufficient_permission', 'a team_manager without team.manage cannot set their team''s policy row'
);
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'team', '63000000-1100-4000-8000-000000000001', '63000000-1200-4000-8000-000000000001', 'invite_allowed', false)$$,
  'the parent department''s department_admin can set the team''s policy row'
);

-- 8-9: invite_allowed = false on Abteilung B blocks a NEW department membership there, even for
-- its own department_admin who otherwise holds member.invite.
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'department', '63000000-1100-4000-8000-000000000002', null, 'invite_allowed', false);
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$insert into public.department_memberships (organization_id, department_id, user_id, role)
    values ('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000002', '63000000-0000-4000-8000-000000000001', 'viewer')$$,
  '42501', null, 'invite_allowed = false blocks a new department membership even for that department''s own admin'
);

-- 10: the same flag does NOT block changing an EXISTING member's role -- invite_allowed is about
-- letting new people in, not about managing people already there (Plan 023, "Umsetzung 1").
select is(
  (select (public.change_membership_role(
    'department',
    (select id from public.department_memberships where department_id = '63000000-1100-4000-8000-000000000002' and user_id = '63000000-0000-4000-8000-000000000005'),
    'editor'
  ))->>'role'),
  'editor', 'invite_allowed = false does not block a role change for an existing member'
);

-- 11: ...nor does it block create_invitation() from being reachable for a department that still
-- allows it (Abteilung A never had invite_allowed set to false on its own or its org, only on
-- Abteilung B) -- a control check that the earlier organization-level false from test 2 was
-- itself reverted before this point would be wrong; instead this checks create_invitation still
-- raises the same insufficient_permission for the now-closed Abteilung B.
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_invitation('63000000-1000-4000-8000-000000000001', '63000000-1100-4000-8000-000000000002', null, 'freshinvite@pgtap-policy.local', 'viewer', repeat('a', 64))$$,
  'P0001', 'insufficient_permission', 'create_invitation respects invite_allowed = false for Abteilung B'
);

-- 12-14: posts_visible_org_wide = false on Abteilung A removes the new club-wide visibility of
-- its published posts for outsiders to that department, without touching Abteilung A's own
-- members or Abteilung B's independent club-wide visibility.
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select public.set_policy_setting('63000000-1000-4000-8000-000000000001', 'department', '63000000-1100-4000-8000-000000000001', null, 'posts_visible_org_wide', false);
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000006', true);
select is(
  (select count(*)::integer from public.posts where id = '63000000-2000-4000-8000-000000000001'),
  0, 'an Abteilung B member no longer sees Abteilung A''s published post once it opts out club-wide'
);
select is(
  (select count(*)::integer from public.posts where id = '63000000-2000-4000-8000-000000000002'),
  1, 'the same member still sees Abteilung B''s own published post'
);
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.posts where id = '63000000-2000-4000-8000-000000000001'),
  1, 'Abteilung A''s own members still see their department''s published post regardless of the club-wide opt-out'
);

-- 15-16: the scope/department_id/team_id check constraint holds -- a department-scoped row
-- without a department_id, or a team-scoped row without a team_id, is rejected outright.
set local role postgres;
select throws_ok(
  $$insert into public.policy_settings (organization_id, scope, department_id, team_id, updated_by)
    values ('63000000-1000-4000-8000-000000000001', 'department', null, null, '63000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a department-scoped policy row without a department_id is rejected'
);
select throws_ok(
  $$insert into public.policy_settings (organization_id, scope, department_id, team_id, updated_by)
    values ('63000000-1000-4000-8000-000000000001', 'team', '63000000-1100-4000-8000-000000000001', null, '63000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a team-scoped policy row without a team_id is rejected'
);

-- 17: Regression (Geheimnisse-Review) -- der Tabellen-Grant war zunaechst spaltenblind und liess
-- jeden Vereinsangehoerigen sehen, WER zuletzt eine Richtlinie geaendert hat, ausserhalb der
-- betroffenen Ebene. Der Grant ist jetzt spaltenweise ohne updated_by; die beiden Schalter
-- bleiben wie gewollt lesbar.
select is(
  has_column_privilege('authenticated', 'public.policy_settings', 'updated_by', 'SELECT'),
  false, 'authenticated cannot see who last changed a policy setting'
);
select ok(
  has_column_privilege('authenticated', 'public.policy_settings', 'invite_allowed', 'SELECT'),
  'authenticated can still read the invite_allowed flag itself'
);

select * from finish();
rollback;
