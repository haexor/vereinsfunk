begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'deptadminf@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'deptadminh@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'teammanager@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000000', '60000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'invitee@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'teaminvitee@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'wrongemail@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'plainviewer@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'orgadmin@pgtap-structure.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'secondowner@pgtap-structure.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('60000000-1000-4000-8000-000000000001', 'PGTAP Struktur Verein', 'pgtap-struktur-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('60000000-1100-4000-8000-000000000001', '60000000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('60000000-1100-4000-8000-000000000002', '60000000-1000-4000-8000-000000000001', 'Handball', 'handball'),
  ('60000000-1100-4000-8000-000000000003', '60000000-1000-4000-8000-000000000001', 'Leichtathletik', 'leichtathletik');
insert into public.teams (id, organization_id, department_id, name) values
  ('60000000-1200-4000-8000-000000000001', '60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000001', 'Team A');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('60000000-1000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'organization_owner'),
  ('60000000-1000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000009', 'organization_admin'),
  ('60000000-1000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000010', 'organization_owner');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 'department_admin'),
  ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003', 'department_admin');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000001', '60000000-1200-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', 'team_manager');

-- 1: a department_admin in Fussball cannot create a membership in Handball.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.department_memberships (organization_id, department_id, user_id, role)
    values ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000002', '60000000-0000-4000-8000-000000000008', 'editor')$$,
  '42501', null, 'a Fussball department_admin cannot manage members in Handball'
);

-- 2: a team_manager cannot create a department-level membership, even for their own team's department.
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$insert into public.department_memberships (organization_id, department_id, user_id, role)
    values ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000001', '60000000-0000-4000-8000-000000000008', 'viewer')$$,
  '42501', null, 'a team_manager cannot manage department-level memberships'
);

-- 3: authenticated cannot assign organization_owner via a direct membership insert, even with
-- organization-level member.invite (escalation protection via authz.can_assign_role).
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role)
    values ('60000000-1000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000008', 'organization_owner')$$,
  '42501', null, 'organization_owner cannot be assigned through a direct membership insert'
);
set local role postgres;

-- 4: authz.can_assign_role rejects organization_owner even for an organization_owner actor.
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select ok(
  not authz.can_assign_role('60000000-1000-4000-8000-000000000001', null, null, 'organization_owner'),
  'can_assign_role never allows organization_owner, even for the organization_owner itself'
);
select ok(
  authz.can_assign_role('60000000-1000-4000-8000-000000000001', null, null, 'organization_admin'),
  'an organization_owner can assign organization_admin'
);
set local role postgres;

-- 5: deleting the last department of an organization fails.
insert into public.organizations (id, name, slug) values ('60000000-2000-4000-8000-000000000001', 'PGTAP Solo Verein', 'pgtap-solo-verein');
insert into public.departments (id, organization_id, name, slug) values ('60000000-2100-4000-8000-000000000001', '60000000-2000-4000-8000-000000000001', 'Einzige Abteilung', 'einzige-abteilung');
select throws_ok(
  $$delete from public.departments where id = '60000000-2100-4000-8000-000000000001'$$,
  'P0001', null, 'the last department of an organization cannot be deleted'
);

-- 6: removing the last organization_owner fails.
select throws_ok(
  $$delete from public.organization_memberships where organization_id = '60000000-1000-4000-8000-000000000001' and role = 'organization_owner'$$,
  'P0001', null, 'the last organization_owner cannot be removed'
);

-- 7: a department with existing posts cannot be deleted.
insert into public.submissions (organization_id, department_id, content_type, preset_slug, communication_goal, requested_formats, source_material, facts, created_by)
values ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000003', 'event', 'event', 'inform', '["feed_image"]', '{"facts":{},"observations":[],"quotes":[],"doNotMention":[]}', '{}', '60000000-0000-4000-8000-000000000001');
select throws_ok(
  $$delete from public.departments where id = '60000000-1100-4000-8000-000000000003'$$,
  'P0001', null, 'a department with existing submissions cannot be deleted, archive it instead'
);

-- 8: an empty department (Handball, no posts) can be deleted.
select lives_ok(
  $$delete from public.departments where id = '60000000-1100-4000-8000-000000000002'$$,
  'an empty department without content can be deleted'
);

-- 9-10: create_department rejects a non-admin and generates a collision-safe slug for an admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000008', true);
select throws_ok(
  $$select public.create_department('60000000-1000-4000-8000-000000000001', 'Neue Abteilung')$$,
  'P0001', null, 'create_department rejects a caller without department.manage'
);
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
select isnt(public.create_department('60000000-1000-4000-8000-000000000001', 'Fussball'), null, 'create_department succeeds for an organization_owner');
set local role postgres;
select is(
  (select slug from public.departments where organization_id = '60000000-1000-4000-8000-000000000001' and name = 'Fussball' and slug <> 'fussball'),
  'fussball-1', 'a colliding department name gets a suffixed, unique slug'
);

-- 11-13: invitations_role_matches_scope rejects organization_owner and scope/role mismatches.
select throws_ok(
  $$insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
    values ('60000000-1000-4000-8000-000000000001', 'nobody@pgtap-structure.local', 'organization_owner', repeat('a', 64), '60000000-0000-4000-8000-000000000001', now() + interval '14 days')$$,
  '23514', null, 'organization_owner is never a valid invitation role'
);
select throws_ok(
  $$insert into public.invitations (organization_id, department_id, email, role, token_hash, invited_by, expires_at)
    values ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000001', 'nobody@pgtap-structure.local', 'organization_admin', repeat('b', 64), '60000000-0000-4000-8000-000000000001', now() + interval '14 days')$$,
  '23514', null, 'an organization-only role is rejected for a department-scoped invitation'
);
select throws_ok(
  $$insert into public.invitations (organization_id, team_id, email, role, token_hash, invited_by, expires_at)
    values ('60000000-1000-4000-8000-000000000001', '60000000-1200-4000-8000-000000000001', 'nobody@pgtap-structure.local', 'editor', repeat('c', 64), '60000000-0000-4000-8000-000000000001', now() + interval '14 days')$$,
  '23514', null, 'a team-scoped invitation without a departmentId violates invitations_scope_check'
);

-- 14: the partial unique index rejects a second open invitation for the same address and scope.
insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
values ('60000000-1000-4000-8000-000000000001', 'duplicate@pgtap-structure.local', 'organization_viewer', repeat('d', 64), '60000000-0000-4000-8000-000000000001', now() + interval '14 days');
select throws_ok(
  $$insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
    values ('60000000-1000-4000-8000-000000000001', 'duplicate@pgtap-structure.local', 'organization_admin', repeat('e', 64), '60000000-0000-4000-8000-000000000001', now() + interval '14 days')$$,
  '23505', null, 'a second open invitation for the same email and scope is rejected'
);

-- 15-16: resend rate limiting -- touching last_sent_at within an hour of itself raises, other
-- updates (e.g. revoking) do not. now() is the transaction start time and constant for the
-- whole test file, so clock_timestamp() is used here to get two genuinely different instants.
insert into public.invitations (id, organization_id, email, role, token_hash, invited_by, expires_at, last_sent_at)
values ('60000000-3000-4000-8000-000000000001', '60000000-1000-4000-8000-000000000001', 'resend@pgtap-structure.local', 'organization_viewer', repeat('f', 64), '60000000-0000-4000-8000-000000000001', now() + interval '14 days', clock_timestamp());
select throws_ok(
  $$update public.invitations set last_sent_at = clock_timestamp() where id = '60000000-3000-4000-8000-000000000001'$$,
  'P0001', null, 'resending an invitation within an hour of the last send is rejected'
);
select lives_ok(
  $$update public.invitations set revoked_at = now() where id = '60000000-3000-4000-8000-000000000001'$$,
  'revoking does not trip the resend rate limit trigger'
);

-- 17-19: accept_invitation happy path (organization-scoped).
insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
values ('60000000-1000-4000-8000-000000000001', 'invitee@pgtap-structure.local', 'organization_viewer', encode(digest('pgtap-raw-token-happy-path', 'sha256'), 'hex'), '60000000-0000-4000-8000-000000000001', now() + interval '14 days');
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$select public.accept_invitation('pgtap-raw-token-happy-path')$$,
  'accept_invitation succeeds for a matching, unexpired invitation'
);
set local role postgres;
select is(
  (select role::text from public.organization_memberships where organization_id = '60000000-1000-4000-8000-000000000001' and user_id = '60000000-0000-4000-8000-000000000005'),
  'organization_viewer', 'accepting the invitation created the organization membership'
);
select is(
  (select accepted_at is not null from public.invitations where token_hash = encode(digest('pgtap-raw-token-happy-path', 'sha256'), 'hex')),
  true, 'the invitation is marked accepted'
);

-- 20: accepting the same token twice fails (already accepted).
set local role authenticated;
select throws_ok(
  $$select public.accept_invitation('pgtap-raw-token-happy-path')$$,
  'P0001', null, 'accepting an already-accepted invitation fails'
);
set local role postgres;

-- 21: an expired invitation cannot be accepted.
insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
values ('60000000-1000-4000-8000-000000000001', 'invitee@pgtap-structure.local', 'organization_viewer', encode(digest('pgtap-raw-token-expired', 'sha256'), 'hex'), '60000000-0000-4000-8000-000000000001', now() - interval '1 day');
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.accept_invitation('pgtap-raw-token-expired')$$,
  'P0001', null, 'an expired invitation cannot be accepted'
);
set local role postgres;

-- 22: accepting with a mismatched account email fails. A distinct email is used here purely to
-- keep this invitation's (organization, email, scope) key free of the still-open "expired"
-- invitation above -- the accepting user (wrongemail@) never matches either address.
insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
values ('60000000-1000-4000-8000-000000000001', 'invitee2@pgtap-structure.local', 'organization_viewer', encode(digest('pgtap-raw-token-mismatch', 'sha256'), 'hex'), '60000000-0000-4000-8000-000000000001', now() + interval '14 days');
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$select public.accept_invitation('pgtap-raw-token-mismatch')$$,
  'P0001', null, 'accepting an invitation with a different account email fails'
);
set local role postgres;

-- 23-24: a team-scoped invitation, once accepted, creates both the team membership and an
-- automatic viewer membership in the parent department (otherwise no content policy applies).
insert into public.invitations (organization_id, department_id, team_id, email, role, token_hash, invited_by, expires_at)
values ('60000000-1000-4000-8000-000000000001', '60000000-1100-4000-8000-000000000001', '60000000-1200-4000-8000-000000000001', 'teaminvitee@pgtap-structure.local', 'contributor', encode(digest('pgtap-raw-token-team', 'sha256'), 'hex'), '60000000-0000-4000-8000-000000000001', now() + interval '14 days');
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000006', true);
select lives_ok(
  $$select public.accept_invitation('pgtap-raw-token-team')$$,
  'accepting a team-scoped invitation succeeds'
);
set local role postgres;
select is(
  (select role::text from public.team_memberships where team_id = '60000000-1200-4000-8000-000000000001' and user_id = '60000000-0000-4000-8000-000000000006'),
  'contributor', 'the team membership was created with the invited role'
);
select is(
  (select role::text from public.department_memberships where department_id = '60000000-1100-4000-8000-000000000001' and user_id = '60000000-0000-4000-8000-000000000006'),
  'viewer', 'an automatic viewer membership was created in the parent department'
);

-- 25-27: email_has_membership requires member.invite at the target scope (Mandantentrennung
-- fix: it used to be callable by anyone as a cross-tenant membership oracle) and, once
-- authorized, correctly reports an existing member vs. a non-member.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000008', true);
select throws_ok(
  $$select public.email_has_membership('60000000-1000-4000-8000-000000000001', null, null, 'invitee@pgtap-structure.local')$$,
  'P0001', null, 'email_has_membership rejects a caller without member.invite at the scope'
);
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
select ok(
  public.email_has_membership('60000000-1000-4000-8000-000000000001', null, null, 'invitee@pgtap-structure.local'),
  'email_has_membership reports true for an existing member'
);
select ok(
  not public.email_has_membership('60000000-1000-4000-8000-000000000001', null, null, 'plainviewer@pgtap-structure.local'),
  'email_has_membership reports false for a non-member'
);
set local role postgres;

-- 26-27: archived_at columns exist and can be toggled without affecting content-delete protection.
select lives_ok(
  $$update public.departments set archived_at = now() where id = '60000000-1100-4000-8000-000000000001'$$,
  'a department can be archived'
);
select lives_ok(
  $$update public.departments set archived_at = null where id = '60000000-1100-4000-8000-000000000001'$$,
  'a department can be restored from archived'
);

-- 28-29: authenticated has no direct insert privilege on departments (only via create_department).
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.departments (organization_id, name, slug) values ('60000000-1000-4000-8000-000000000001', 'Direktes Insert', 'direktes-insert')$$,
  '42501', null, 'authenticated has no direct insert privilege on departments'
);
select lives_ok(
  $$update public.teams set archived_at = now() where id = '60000000-1200-4000-8000-000000000001' and organization_id = '60000000-1000-4000-8000-000000000001'$$,
  'an organization_owner can archive a team directly via RLS'
);

-- 30-32: an organization_admin (rank 90) cannot remove or demote an organization_owner (rank
-- 100), even though it holds member.remove/member.invite -- the rank check must run against the
-- TARGET's current role, not just the role being assigned (the critical gap found in this
-- package's Rechte review: only assignment was rank-checked before, never removal/demotion).
-- A DELETE blocked by RLS does not raise 42501 (unlike INSERT's WITH CHECK) -- it silently
-- matches zero rows, so the assertion is "the row still exists afterward", not throws_ok.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000009', true);
select lives_ok(
  $$delete from public.organization_memberships where organization_id = '60000000-1000-4000-8000-000000000001' and user_id = '60000000-0000-4000-8000-000000000010'$$,
  'the delete statement itself does not raise (RLS silently filters the row instead)'
);
set local role postgres;
select is(
  (select count(*)::integer from public.organization_memberships where organization_id = '60000000-1000-4000-8000-000000000001' and user_id = '60000000-0000-4000-8000-000000000010'),
  1, 'the organization_owner row still exists -- organization_admin could not remove it'
);
select ok(
  not authz.can_remove_role('60000000-1000-4000-8000-000000000001', null, null, 'organization_owner'),
  'can_remove_role directly confirms organization_admin cannot remove organization_owner (rank 90 <= 100 is false)'
);
select ok(
  authz.can_remove_role('60000000-1000-4000-8000-000000000001', null, null, 'organization_admin'),
  'can_remove_role confirms organization_admin can remove a peer organization_admin (rank 90 <= 90)'
);

select * from finish();
rollback;
