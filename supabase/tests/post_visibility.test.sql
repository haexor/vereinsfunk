begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'orgowner@pgtap-visibility.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussballadmin@pgtap-visibility.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'handballviewer@pgtap-visibility.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'teamamember@pgtap-visibility.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'outsider@pgtap-visibility.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'teaminvitee@pgtap-visibility.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('62000000-1000-4000-8000-000000000001', 'PGTAP Sichtbarkeit Verein', 'pgtap-sichtbarkeit-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('62000000-1100-4000-8000-000000000001', '62000000-1000-4000-8000-000000000001', 'Fussball', 'fussball'),
  ('62000000-1100-4000-8000-000000000002', '62000000-1000-4000-8000-000000000001', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('62000000-1200-4000-8000-000000000001', '62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', 'Team A');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('62000000-1000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'organization_owner');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', '62000000-0000-4000-8000-000000000002', 'department_admin'),
  ('62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000002', '62000000-0000-4000-8000-000000000003', 'viewer');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', '62000000-1200-4000-8000-000000000001', '62000000-0000-4000-8000-000000000004', 'contributor');

insert into public.posts (id, organization_id, department_id, team_id, status, created_by) values
  ('62000000-2000-4000-8000-000000000001', '62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', null, 'draft', '62000000-0000-4000-8000-000000000002'),
  ('62000000-2000-4000-8000-000000000002', '62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', null, 'published', '62000000-0000-4000-8000-000000000002'),
  ('62000000-2000-4000-8000-000000000003', '62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', '62000000-1200-4000-8000-000000000001', 'draft', '62000000-0000-4000-8000-000000000002'),
  ('62000000-2000-4000-8000-000000000004', '62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000002', null, 'scheduled', '62000000-0000-4000-8000-000000000003');

insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('62000000-3000-4000-8000-000000000001', '62000000-1000-4000-8000-000000000001', '62000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '62000000-0000-4000-8000-000000000002'),
  ('62000000-3000-4000-8000-000000000002', '62000000-1000-4000-8000-000000000001', '62000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '62000000-0000-4000-8000-000000000002');

set local role authenticated;

-- 1-2: a plain department member of Handball (no org role) now sees a PUBLISHED post of a
-- different department (Fussball) -- the core of the new club-wide visibility -- but still not
-- its DRAFT.
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000002'),
  1, 'a Handball-only member sees a published Fussball post club-wide'
);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000001'),
  0, 'a Handball-only member does not see a draft Fussball post'
);

-- 3: the same member still sees their own department's scheduled post (unchanged behaviour).
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000004'),
  1, 'a Handball member sees their own department''s scheduled post'
);

-- 4-6: a person who is ONLY a member of Team A (no department_memberships row at all) sees the
-- draft assigned to their team, the club-wide published post, but not the OTHER Fussball draft
-- that has no team_id.
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000003'),
  1, 'a team-only member sees the draft assigned to their own team'
);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000001'),
  0, 'a team-only member does not see another draft of the same department without their team'
);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000002'),
  1, 'a team-only member sees a published post club-wide, same as any other member'
);

-- 7-8: someone outside the organization entirely sees nothing, published or not -- club-wide
-- visibility must not leak past the organization boundary.
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000005', true);
select is(
  (select count(*)::integer from public.posts where organization_id = '62000000-1000-4000-8000-000000000001'),
  0, 'an outsider sees no posts of this organization at all'
);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000002'),
  0, 'an outsider does not see the published post either'
);

-- 9-10: post_versions_select now mirrors posts_select instead of being unconditionally
-- organization-wide (the contradiction this package closes).
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.post_versions where id = '62000000-3000-4000-8000-000000000002'),
  1, 'a Handball member sees the version text of a published Fussball post'
);
select is(
  (select count(*)::integer from public.post_versions where id = '62000000-3000-4000-8000-000000000001'),
  0, 'a Handball member does not see the version text of a draft Fussball post'
);

-- 11-14: authz.is_any_member_of_organization -- true via any membership kind, false outside.
select ok(authz.is_any_member_of_organization('62000000-1000-4000-8000-000000000001'), 'true for a plain department member');
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000004', true);
select ok(authz.is_any_member_of_organization('62000000-1000-4000-8000-000000000001'), 'true for a team-only member');
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select ok(authz.is_any_member_of_organization('62000000-1000-4000-8000-000000000001'), 'true for an organization-role holder');
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000005', true);
select ok(not authz.is_any_member_of_organization('62000000-1000-4000-8000-000000000001'), 'false for a complete outsider');

-- 15-17: accept_invitation() no longer grants a department viewer membership for a team-scoped
-- invitation (Rueckbau) -- the invitee still ends up with only the team membership, and
-- posts_select's has_team_membership clause is what makes their team's content visible now.
set local role postgres;
insert into public.invitations (id, organization_id, department_id, team_id, email, role, token_hash, invited_by, expires_at)
values ('62000000-4000-4000-8000-000000000001', '62000000-1000-4000-8000-000000000001', '62000000-1100-4000-8000-000000000001', '62000000-1200-4000-8000-000000000001', 'teaminvitee@pgtap-visibility.local', 'contributor', encode(digest('pgtap-visibility-team-token', 'sha256'), 'hex'), '62000000-0000-4000-8000-000000000002', now() + interval '14 days');
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000006', true);
select public.accept_invitation('pgtap-visibility-team-token');
select is(
  (select count(*)::integer from public.team_memberships where team_id = '62000000-1200-4000-8000-000000000001' and user_id = '62000000-0000-4000-8000-000000000006'),
  1, 'accepting a team invitation creates the team membership'
);
set local role postgres;
select is(
  (select count(*)::integer from public.department_memberships where department_id = '62000000-1100-4000-8000-000000000001' and user_id = '62000000-0000-4000-8000-000000000006'),
  0, 'accepting a team invitation no longer creates a department viewer membership'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000006', true);
select is(
  (select count(*)::integer from public.posts where id = '62000000-2000-4000-8000-000000000003'),
  1, 'the new team member still sees their team''s draft via has_team_membership, without a department membership'
);

-- 18-21: Beitrag auf Vereinsebene (Migration 2026082504/2026082506). posts_select/
-- post_versions_select haben ihren Vereinszweig in 2026082504 bekommen, die beiden Tabellen
-- daneben nicht: post_status_events (Statushistorie) und post_generation_provenance (Herkunft der
-- generierten Version) haengen weiter allein an der Abteilung. Fuer department_id null ist
-- authz.has_department_permission(null, ...)/authz.is_department_member(null) false -- beide
-- Tabellen waren fuer einen Vereinsbeitrag also von NIEMANDEM lesbar.
set local role postgres;
-- Der posts_status_history_insert-Trigger schreibt die erste Statuszeile selbst.
insert into public.posts (id, organization_id, department_id, team_id, status, created_by) values
  ('62000000-2000-4000-8000-000000000005', '62000000-1000-4000-8000-000000000001', null, null, 'draft', '62000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('62000000-3000-4000-8000-000000000005', '62000000-1000-4000-8000-000000000001', '62000000-2000-4000-8000-000000000005', 1, '{}', '{}', 'user', '62000000-0000-4000-8000-000000000001');
insert into public.llm_provider_configurations (id, label, protocol, base_url, model) values
  ('62000000-4000-4000-8000-000000000001', 'PGTAP Sichtbarkeit Provider', 'openai', 'https://provider.example.test', 'smoke-test-model');
insert into public.post_generation_provenance (organization_id, post_version_id, style_profile_snapshot, prompt_template_version, provider_model_id, provider_configuration_id, provider_parameter_hash, input_hash) values
  ('62000000-1000-4000-8000-000000000001', '62000000-3000-4000-8000-000000000005', '{}', 'v1', 'smoke-test-model', '62000000-4000-4000-8000-000000000001', repeat('e', 64), repeat('f', 64));

set local role authenticated;
-- Statushistorie: analytics.view auf Vereinsebene, dieselbe Stufe wie der Abteilungszweig daneben.
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.post_status_events where post_id = '62000000-2000-4000-8000-000000000005'),
  1, 'an organization owner reads the status history of a post without a department'
);
-- Eine Abteilungs-viewer-Rolle traegt analytics.view nur in ihrer Abteilung, nicht im Verein.
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.post_status_events where post_id = '62000000-2000-4000-8000-000000000005'),
  0, 'a department viewer without an organization role reads no organization-level status history'
);
-- Herkunft: derselbe Zweig wie posts_select -- jedes Vereinsmitglied, auch ohne Organisationsrolle
-- und ohne die (nicht vorhandene) Abteilung des Beitrags.
select is(
  (select count(*)::integer from public.post_generation_provenance where post_version_id = '62000000-3000-4000-8000-000000000005'),
  1, 'any club member reads the provenance of an organization-level draft, mirroring posts_select'
);
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000005', true);
select is(
  (select count(*)::integer from public.post_generation_provenance where post_version_id = '62000000-3000-4000-8000-000000000005'),
  0, 'negative tenant isolation: an outsider reads no organization-level provenance'
);

select * from finish();
rollback;
