begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'style-a@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'style-b@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'style-c@test.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('31000000-1000-4000-8000-000000000001', 'Style Organization A', 'style-organization-a'),
  ('32000000-2000-4000-8000-000000000002', 'Style Organization B', 'style-organization-b');
insert into public.departments (id, organization_id, name, slug) values
  ('31000000-1100-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', 'Style Department A', 'style-department-a'),
  ('32000000-2200-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', 'Style Department B', 'style-department-b');
insert into public.teams (id, organization_id, department_id, name) values
  ('32000000-2300-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'Style Team B');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('31000000-1000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'organization_viewer'),
  ('32000000-2000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', 'organization_viewer');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'editor'),
  ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', 'editor');
-- style-c has ONLY a team_memberships row (no department_memberships row) -- the exact shape
-- that composition_sessions_select must recognize via has_team_permission, not just
-- has_department_permission (regression coverage for the missing team_id branch).
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-2300-4000-8000-000000000002', '32000000-0000-4000-8000-000000000003', 'team_manager');
insert into public.content_style_profiles (id, organization_id, department_id, slug, name, description, style_rules, avoid_rules, created_by) values
  ('31000000-1200-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'klar-und-nah', 'Klar und nah', 'Kurze, konkrete Sätze', '{"toneTags":["klar","sachlich"],"catchphrases":[],"exampleInput":"","exampleOutput":"","additionalInstructions":""}', '{Floskeln}', '31000000-0000-4000-8000-000000000001'),
  ('32000000-2400-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'warm-und-nah', 'Warm und nah', 'Gemeinschaft zuerst', '{"toneTags":["warm","gemeinschaftlich"],"catchphrases":[],"exampleInput":"","exampleOutput":"","additionalInstructions":""}', '{Phrasen}', '32000000-0000-4000-8000-000000000002');
insert into public.composition_sessions (id, organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values
  ('32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-2300-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.content_style_profiles), 1, 'department editor can read its own organization style profile');
select is((select name from public.content_style_profiles), 'Klar und nah', 'style profile read is tenant-scoped');
select is((select count(*)::integer from public.content_style_profiles where organization_id = '32000000-2000-4000-8000-000000000002'), 0, 'negative: tenant A cannot read tenant B profile');
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'blocked-write', 'Blocked write', 'Must use privileged API', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'negative: browser role cannot write style profiles directly'
);

select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.composition_sessions), 1, 'a team-only team_manager (no department_memberships row) sees their own team''s composition session');

select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.composition_sessions), 0, 'negative: an unrelated tenant A member cannot see the team B composition session');

set local role postgres;
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, team_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', '32000000-2300-4000-8000-000000000002', 'cross-team', 'Cross team', 'Must fail', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'negative: a profile cannot reference a team from another organization'
);
-- Product decision (Plan 032): style profiles may name and imitate a real person -- safety is
-- organisational (role assignment, approval routes), not a database-level keyword filter.
select lives_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'mark-twain', 'Mark Twain', 'Schreibe wie Mark Twain', '{}', '31000000-0000-4000-8000-000000000001')$$,
  'a custom profile naming and imitating a real person is allowed'
);
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, avoid_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'null-avoid-rule', 'Null avoid rule', 'Must fail', '{}', array[null]::text[], '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a null element in avoid_rules'
);
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, avoid_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'blank-avoid-rule', 'Blank avoid rule', 'Must fail', '{}', array['   '], '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a whitespace-only element in avoid_rules'
);
-- do_rules mirrors avoid_rules exactly, same helper, same bounds.
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, do_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'null-do-rule', 'Null do rule', 'Must fail', '{}', array[null]::text[], '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a null element in do_rules'
);
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, do_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'blank-do-rule', 'Blank do rule', 'Must fail', '{}', array['   '], '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a whitespace-only element in do_rules'
);
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, do_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'too-many-do-rules', 'Too many do rules', 'Must fail', '{}', array(select 'r' || generate_series(1, 31)::text), '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects more than 30 do_rules elements'
);
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'klar_erklaerend', 'Duplikat', 'Must fail', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a custom profile shadowing a reserved system slug'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'not_a_real_goal', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects an unknown communication goal'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["video_post", "photo_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects video_post combined with another presentation type'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post", "text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects duplicate entries in requestedFormats'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', '32000000-2300-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '31000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'negative: a session cannot reference a team from another organization/department'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects source_material.facts that is not an object'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects source_material with no facts, observations, or quotes'
);

-- Fixtures for the immutability test below: a post_generation_provenance row needs a real
-- post_version and an llm_provider_configurations row to satisfy its FKs.
insert into public.llm_provider_configurations (id, label, protocol, base_url, model) values
  ('31000000-4000-4000-8000-000000000001', 'Style Provider', 'openai', 'https://api.example.test', 'test-model');
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('31000000-5000-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'draft', '31000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type) values
  ('31000000-6000-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-5000-4000-8000-000000000001', 1, '{}', '{}', 'llm');
insert into public.post_generation_provenance (id, organization_id, post_version_id, style_profile_snapshot, prompt_template_version, provider_model_id, provider_configuration_id, provider_parameter_hash, input_hash) values
  ('31000000-7000-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-6000-4000-8000-000000000001', '{}', 'v1', 'test-model', '31000000-4000-4000-8000-000000000001', repeat('a', 64), repeat('a', 64));
select throws_ok(
  $$update public.post_generation_provenance set prompt_template_version = 'v2' where id = '31000000-7000-4000-8000-000000000001'$$,
  'P0001', 'post generation provenance is immutable', 'negative: an accepted generation provenance record cannot be updated'
);
select lives_ok(
  $$delete from public.post_versions where id = '31000000-6000-4000-8000-000000000001'$$,
  'deleting a post_version with existing provenance cascades instead of being blocked by the immutability trigger'
);
select is((select count(*)::integer from public.post_generation_provenance where id = '31000000-7000-4000-8000-000000000001'), 0, 'the cascade delete removed the now-orphaned provenance row');

-- Regression coverage for the review-fixed RLS branches: content_style_profiles' team branch
-- now reads via plain team membership (not the post.create write permission it wrongly reused),
-- and its org-wide branch reads via is_any_member_of_organization (not the narrower
-- is_organization_member, which misses the common member with only a department/team role).
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'style-d@test.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '32000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'style-e@test.local', '', '{}', '{}', now(), now());
-- style-d: ONLY a team_memberships row on team B, role 'viewer' -- the exact shape that used to
-- fail content_style_profiles_select's team branch because it required post.create.
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-2300-4000-8000-000000000002', '32000000-0000-4000-8000-000000000004', 'viewer');
-- style-e: ONLY a department_memberships row on department B, no organization role -- the exact
-- shape that used to fail the org-wide branch because it required is_organization_member.
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-0000-4000-8000-000000000005', 'viewer');
insert into public.content_style_profiles (id, organization_id, department_id, team_id, slug, name, description, style_rules, created_by) values
  ('32000000-2410-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-2300-4000-8000-000000000002', 'team-b-only', 'Team B only', 'Team-scoped style', '{}', '32000000-0000-4000-8000-000000000002'),
  ('32000000-2420-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', null, null, 'org-b-wide', 'Org B wide', 'Org-wide style', '{}', '32000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.content_style_profiles), 2, 'a team-only viewer (role=viewer, no post.create) sees their team-scoped and the org-wide profile via plain membership');
select is((select count(*)::integer from public.content_style_profiles where slug = 'warm-und-nah'), 0, 'negative: a team-only member still cannot see a department-scoped profile outside their team');

select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.content_style_profiles where slug = 'org-b-wide'), 1, 'a department-only member (no organization role) sees an org-wide style profile via is_any_member_of_organization');
select is((select count(*)::integer from public.content_style_profiles where slug = 'team-b-only'), 0, 'negative: a department-only member cannot see a profile scoped to a team they are not in');

-- Regression coverage for post_generation_provenance_select's added org-wide published/scheduled
-- branch (mirrors post_versions_select), plus a negative case proving it stays scoped to
-- published/scheduled posts and does not leak an unrelated draft's provenance.
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'style-f@test.local', '', '{}', '{}', now(), now());
-- style-f: department_memberships in a SIBLING department of org A, no organization role. Note
-- is_department_member() also falls back to any organization role -- an org-role member would
-- pass the pre-existing department branch regardless, so isolating the new org-wide branch
-- needs a member with a department/team role elsewhere in the org instead.
insert into public.departments (id, organization_id, name, slug) values
  ('31000000-1900-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', 'Style Department A2', 'style-department-a2');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('31000000-1000-4000-8000-000000000001', '31000000-1900-4000-8000-000000000001', '31000000-0000-4000-8000-000000000006', 'viewer');
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('31000000-5100-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'published', '31000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type) values
  ('31000000-6100-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-5100-4000-8000-000000000001', 1, '{}', '{}', 'llm');
insert into public.post_generation_provenance (id, organization_id, post_version_id, style_profile_snapshot, prompt_template_version, provider_model_id, provider_configuration_id, provider_parameter_hash, input_hash) values
  ('31000000-7100-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-6100-4000-8000-000000000001', '{}', 'v1', 'test-model', '31000000-4000-4000-8000-000000000001', repeat('b', 64), repeat('b', 64));

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.post_generation_provenance where id = '31000000-7100-4000-8000-000000000001'), 1, 'an organization-wide member with no department/team role reads provenance for a published post via the org-wide branch');
select is((select count(*)::integer from public.post_generation_provenance where id = '31000000-7000-4000-8000-000000000001'), 0, 'negative: the org-wide branch does not leak provenance for an unrelated draft post the member has no department/team role on');

-- composition_session_media and generation_candidates had no rows or RLS assertions at all;
-- exercise the creator-read and cross-tenant-negative shape already used for composition_sessions.
set local role postgres;
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, sha256, scan_status, created_by) values
  ('32000000-2600-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'raw-media', 'organizations/32000000-2000-4000-8000-000000000002/departments/32000000-2200-4000-8000-000000000002/assets/style/original.jpg', 'image/jpeg', 12, repeat('c', 64), 'clean', '32000000-0000-4000-8000-000000000002');
insert into public.composition_session_media (id, organization_id, composition_session_id, media_asset_id, position) values
  ('32000000-2700-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', '32000000-2600-4000-8000-000000000002', 0);
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, input_hash) values
  ('32000000-2800-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', repeat('b', 64));

-- Coverage for the compression_provenance immutability triggers on media_assets/media_derivatives:
-- the first null -> object transition must succeed, any change after that must fail.
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size) values
  ('32000000-2900-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2600-4000-8000-000000000002', '{}', 'v1', 'organizations/32000000-2000-4000-8000-000000000002/derivatives/style/original.jpg', repeat('d', 64), 'image/jpeg', 12);
select lives_ok(
  $$update public.media_assets set compression_provenance = '{"strategy":"device"}'::jsonb where id = '32000000-2600-4000-8000-000000000002'$$,
  'compression provenance can be set once on a media asset'
);
select throws_ok(
  $$update public.media_assets set compression_provenance = '{"strategy":"server"}'::jsonb where id = '32000000-2600-4000-8000-000000000002'$$,
  'P0001', null, 'negative: compression provenance on a media asset cannot be replaced once set'
);
select throws_ok(
  $$update public.media_assets set compression_provenance = null where id = '32000000-2600-4000-8000-000000000002'$$,
  'P0001', null, 'negative: compression provenance on a media asset cannot be cleared once set'
);
select lives_ok(
  $$update public.media_derivatives set compression_provenance = '{"strategy":"device"}'::jsonb where id = '32000000-2900-4000-8000-000000000002'$$,
  'compression provenance can be set once on a media derivative'
);
select throws_ok(
  $$update public.media_derivatives set compression_provenance = '{"strategy":"server"}'::jsonb where id = '32000000-2900-4000-8000-000000000002'$$,
  'P0001', null, 'negative: compression provenance on a media derivative cannot be replaced once set'
);
select throws_ok(
  $$update public.media_derivatives set compression_provenance = null where id = '32000000-2900-4000-8000-000000000002'$$,
  'P0001', null, 'negative: compression provenance on a media derivative cannot be cleared once set'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.composition_session_media), 1, 'the composition session''s creator can read its attached media');
select is((select count(*)::integer from public.generation_candidates), 1, 'the composition session''s creator can read its generation candidate');

select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.composition_session_media), 0, 'negative: an unrelated tenant A member cannot read tenant B''s session media');
select is((select count(*)::integer from public.generation_candidates), 0, 'negative: an unrelated tenant A member cannot read tenant B''s generation candidate');

-- Plan 033: a revision is a separately durable candidate for the same session.  The outbox
-- remains ID-only even when a human supplied revision instruction exists in database state.
set local role postgres;
select lives_ok(
  $$select public.create_text_generation_session(
    '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null,
    'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Revisionstraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{"name":"System","description":"","styleRules":{"toneTags":["klar"],"catchphrases":[],"exampleInput":"","exampleOutput":"","additionalInstructions":""},"avoidRules":[]}'::jsonb,
    '{}'::jsonb, array['instagram', 'facebook']::text[], 2200, 0.6, 1, repeat('e', 64), repeat('f', 64), 'initial', null,
    '32000000-0000-4000-8000-000000000002', '32000000-9000-4000-8000-000000000002', 'generation-initial',
    array['31000000-4000-4000-8000-000000000001']::uuid[]
  )$$,
  'initial text generation creates a durable session and candidate'
);
select lives_ok(
  $$select public.create_text_generation_session(
    '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null,
    'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Revisionstraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{"name":"System","description":"","styleRules":{"toneTags":["klar"],"catchphrases":[],"exampleInput":"","exampleOutput":"","additionalInstructions":""},"avoidRules":[]}'::jsonb,
    '{}'::jsonb, array['instagram', 'facebook']::text[], 2200, 0.6, 1, repeat('e', 64), repeat('0', 64), 'revise', 'Bitte kürzer formulieren',
    '32000000-0000-4000-8000-000000000002', '32000000-9000-4000-8000-000000000002', 'generation-revision',
    array['31000000-4000-4000-8000-000000000001']::uuid[]
  )$$,
  'revision creates a separate durable candidate in the existing session'
);
select is((select count(*)::integer from public.generation_candidates where composition_session_id = (select id from public.composition_sessions where organization_id = '32000000-2000-4000-8000-000000000002' and input_hash = repeat('e', 64))), 2, 'one session retains initial and revision candidates separately');
select lives_ok(
  $$select public.create_text_generation_session(
    '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null,
    'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Revisionstraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{"name":"System","description":"","styleRules":{"toneTags":["klar"],"catchphrases":[],"exampleInput":"","exampleOutput":"","additionalInstructions":""},"avoidRules":[]}'::jsonb,
    '{}'::jsonb, array['instagram', 'facebook']::text[], 2200, 0.6, 1, repeat('e', 64), repeat('1', 64), 'revise', 'Bitte mit mehr Energie formulieren',
    '32000000-0000-4000-8000-000000000002', '32000000-9000-4000-8000-000000000002', 'generation-revision-2',
    array['31000000-4000-4000-8000-000000000001']::uuid[]
  )$$,
  'a second revision receives its own durable outbox entry'
);
select is((select count(*)::integer from public.workflow_outbox where workflow_name = 'generate-text-post' and purpose like 'revise:%'), 2, 'each revision has a candidate-qualified workflow purpose');
select throws_ok(
  $$select public.accept_text_generation_candidate('32000000-2800-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001')$$,
  'P0001', 'generation_candidate_forbidden', 'negative: a member of another tenant cannot accept a candidate by ID'
);
select throws_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, task_kind, is_active) values ('Unsupported active provider', 'openai', 'https://example.invalid', 'test', 'image_generation', true)$$,
  '23514', null, 'negative: only implemented task kinds can be active'
);
-- Eigene Prioritaet: die Fixtur "Style Provider" oben ist ebenfalls aktiv und belegt seit
-- 2026081305 die Default-Prioritaet 100 fuer text_generation.
select lives_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, is_active, priority) values ('Anthropic native provider', 'anthropic', 'https://api.anthropic.com/v1', 'test', true, 200)$$,
  'regression: anthropic is an implemented protocol and can be active'
);
select is((select count(*)::integer from public.workflow_outbox where workflow_name = 'generate-text-post' and payload ? 'sourceMaterial'), 0, 'negative: text generation outbox payloads never contain source content');

-- Plan 034: acquire_generation_candidate must reclaim a candidate stuck on 'generating' past the
-- recovery threshold (a crashed worker never released it), but must not touch one still within
-- it, since that attempt may legitimately still be running. A premature call for the latter must
-- raise instead of returning null -- a null used to be indistinguishable from a safe duplicate
-- delivery, which let TextGenerationExecutor.execute report false success (see context.ts).
set local role postgres;
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, updated_at) values
  ('32000000-2810-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'generating', repeat('c', 64), now() - interval '20 minutes'),
  ('32000000-2820-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'generating', repeat('d', 64), now()),
  ('32000000-2830-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'failed', repeat('9', 64), now());
select isnt(
  (select public.acquire_generation_candidate('32000000-2810-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002')),
  null,
  'a candidate stuck on generating past the recovery threshold is reacquired after a worker crash'
);
select throws_ok(
  $$select public.acquire_generation_candidate('32000000-2820-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002')$$,
  'P0001', 'generation_candidate_still_in_progress',
  'negative: a candidate still within the recovery threshold raises instead of silently reporting success while a legitimate attempt may still be running'
);
select is(
  (select public.acquire_generation_candidate('32000000-2830-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002')),
  null,
  'a duplicate delivery of an already-terminal candidate still returns null, not an exception'
);

-- Plan 035: a stale worker that crashed but was not actually dead must not overwrite the result
-- of a second delivery that reclaimed the candidate past the 15-minute lease. generation_lease_token
-- is the fencing token: mark_generation_candidate_ready must reject a write carrying the token
-- issued to the first (now-superseded) delivery and accept one carrying the current token.
set local role postgres;
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, updated_at) values
  ('32000000-2840-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'pending', repeat('8', 64), now());
select public.acquire_generation_candidate('32000000-2840-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002');
select set_config('test.lease_t1', generation_lease_token::text, false) from public.generation_candidates where id = '32000000-2840-4000-8000-000000000002';
-- set_generation_candidates_updated_at would otherwise overwrite this backdating on the UPDATE below.
alter table public.generation_candidates disable trigger set_generation_candidates_updated_at;
update public.generation_candidates set updated_at = now() - interval '20 minutes' where id = '32000000-2840-4000-8000-000000000002';
alter table public.generation_candidates enable trigger set_generation_candidates_updated_at;
select public.acquire_generation_candidate('32000000-2840-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002');
select isnt(
  (select generation_lease_token::text from public.generation_candidates where id = '32000000-2840-4000-8000-000000000002'),
  current_setting('test.lease_t1'),
  'reacquiring a candidate past the 15-minute lease issues a fresh token distinct from the crashed worker''s'
);
select throws_ok(
  $$select public.mark_generation_candidate_ready('32000000-2840-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', current_setting('test.lease_t1')::uuid, '{}'::jsonb, '31000000-4000-4000-8000-000000000001', 'test-model', repeat('a', 64), 'v1')$$,
  'P0001', 'generation_candidate_ready_update_lost',
  'negative: a stale worker''s late write carrying the superseded lease token is fenced out'
);
select lives_ok(
  $$select public.mark_generation_candidate_ready('32000000-2840-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', (select generation_lease_token from public.generation_candidates where id = '32000000-2840-4000-8000-000000000002'), '{}'::jsonb, '31000000-4000-4000-8000-000000000001', 'test-model', repeat('a', 64), 'v1')$$,
  'the delivery holding the current lease token can mark the candidate ready'
);

-- Plan 035: triggered_by defaults to 'member' for the existing create_text_generation_session
-- callers (member-initiated generation/revision) and is independently settable, so a member can
-- tell an automatically retried result apart from one they themselves asked for.
-- Paket 046: die Kandidatenzeile traegt nicht mehr repeat('f', 64) als eigenen input_hash --
-- dieser wird jetzt je Provider abgeleitet (sha256(round_hash || provider_id)). round_input_hash
-- bleibt aber exakt der uebergebene p_candidate_input_hash, solange p_round_input_hash weggelassen
-- wird (der Regelfall fuer jede Mitglieder-Anfrage, siehe Migration 2026081912).
select is(
  (select triggered_by from public.generation_candidates where composition_session_id = (select id from public.composition_sessions where organization_id = '32000000-2000-4000-8000-000000000002' and input_hash = repeat('e', 64)) and round_input_hash = repeat('f', 64)),
  'member',
  'create_text_generation_session defaults triggered_by to member for an existing caller'
);
select lives_ok(
  $$insert into public.generation_candidates (organization_id, composition_session_id, generation_intent, status, input_hash, triggered_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'pending', repeat('7', 64), 'automatic_recovery')$$,
  'a candidate can be inserted with triggered_by = automatic_recovery'
);
select throws_ok(
  $$insert into public.generation_candidates (organization_id, composition_session_id, generation_intent, status, input_hash, triggered_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'pending', repeat('6', 64), 'not_a_real_trigger')$$,
  '23514', null, 'negative: database rejects an unknown triggered_by value'
);

-- Plan 035: composition_sessions.candidate_count enforces a hard ceiling identically for a manual
-- revision and (later) an automatic recovery attempt, not just an application-side count kept by
-- whichever caller happens to be retrying. Seeded with candidate_count = 0 (a real session's
-- first-candidate-included default is 1) purely to isolate the counting arithmetic: eight
-- consecutive revision calls should succeed and only the ninth should hit the placeholder ceiling.
set local role postgres;
insert into public.composition_sessions (id, organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, status, candidate_count, created_by) values
  ('32000000-2900-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null, 'inform', '["text_post"]', '{"facts":{"title":"Limittraining"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('2', 64), 'queued', 0, '32000000-0000-4000-8000-000000000002');
do $$
begin
  for i in 1..8 loop
    perform public.create_text_generation_session(
      '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null,
      'inform', '["text_post"]'::jsonb,
      '{"facts":{"title":"Limittraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
      null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1, repeat('2', 64), encode(sha256(('limit-revision-' || i::text)::bytea), 'hex'), 'revise', 'Bitte kuerzer',
      '32000000-0000-4000-8000-000000000002', '32000000-9000-4000-8000-000000000002', 'generation-limit-revise-' || i::text,
      array['31000000-4000-4000-8000-000000000001']::uuid[]
    );
  end loop;
end;
$$;
select is(
  (select candidate_count from public.composition_sessions where id = '32000000-2900-4000-8000-000000000002'),
  8,
  'candidate_count reaches the placeholder ceiling of 8 after eight successful revision calls'
);
select is(
  (select count(*)::integer from public.generation_candidates where composition_session_id = '32000000-2900-4000-8000-000000000002'),
  8,
  'candidate_count matches the actual row count in generation_candidates'
);
select throws_ok(
  $$select public.create_text_generation_session(
    '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null,
    'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Limittraining"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{}'::jsonb, '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1, repeat('2', 64), encode(sha256('limit-revision-overflow'::bytea), 'hex'), 'revise', 'Zu viel',
    '32000000-0000-4000-8000-000000000002', '32000000-9000-4000-8000-000000000002', 'generation-limit-overflow',
    array['31000000-4000-4000-8000-000000000001']::uuid[]
  )$$,
  'P0001', 'composition_session_candidate_limit_reached',
  'negative: a ninth candidate attempt on one session is rejected once the placeholder ceiling is reached'
);

-- Plan 035: claim_stalled_generation_candidates is the trigger independent of Hatchet's own retry
-- budget -- it must claim only a candidate stuck on 'generating' past the 15-minute threshold,
-- leave one still within it alone, and (review fix on PR #52) leave the claimed row reclaimable
-- rather than terminally failing it immediately -- a crash between claim and the replacement
-- attempt must not lose the candidate. finalize_stalled_generation_recovery is the caller's
-- explicit, fenced closing step once the replacement's fate is known. Repeated sequential calls
-- are this codebase's established way of testing this claim-and-advance pattern (see
-- claim_workflow_outbox's own test), rather than a new dblink-based true multi-transaction test not
-- used anywhere else in this suite.
set local role postgres;
insert into public.composition_sessions (id, organization_id, department_id, team_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, status, created_by) values
  ('32000000-3000-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', null, 'inform', '["text_post"]', '{"facts":{"title":"Recoverytraining"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('3', 64), 'generating', '32000000-0000-4000-8000-000000000002');
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, generation_lease_token, updated_at) values
  ('32000000-3010-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-3000-4000-8000-000000000002', 'initial', 'generating', repeat('4', 64), gen_random_uuid(), now() - interval '20 minutes'),
  ('32000000-3020-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2500-4000-8000-000000000002', 'initial', 'generating', repeat('5', 64), null, now());
select set_config('test.stale_lease_before', (select generation_lease_token::text from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'), false);
select is(
  (select count(*)::integer from public.claim_stalled_generation_candidates(10)),
  1,
  'only the candidate stuck past the 15-minute threshold is claimed'
);
select is(
  (select status::text from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'),
  'generating',
  'the claimed candidate is left reclaimable, not terminally failed, so a crash before finalization does not lose it'
);
select isnt(
  (select generation_lease_token::text from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'),
  current_setting('test.stale_lease_before'),
  'claiming issues a fresh fencing token distinct from the one a crashed worker last saw'
);
select is(
  (select status::text from public.composition_sessions where id = '32000000-3000-4000-8000-000000000002'),
  'generating',
  'the session is left untouched by the claim itself'
);
select is(
  (select status::text from public.generation_candidates where id = '32000000-3020-4000-8000-000000000002'),
  'generating',
  'negative: a candidate still within the 15-minute threshold is left untouched'
);
select is(
  (select count(*)::integer from public.claim_stalled_generation_candidates(10)),
  0,
  'a repeated call does not reclaim a row it just claimed, since claiming refreshes updated_at'
);
select throws_ok(
  $$select public.finalize_stalled_generation_recovery('32000000-3010-4000-8000-000000000002', '32000000-3000-4000-8000-000000000002', current_setting('test.stale_lease_before')::uuid, 'stalled_after_crash')$$,
  'P0001', 'generation_candidate_recovery_finalize_lost',
  'negative: finalizing with a superseded lease token is fenced out'
);
select lives_ok(
  $$select public.finalize_stalled_generation_recovery('32000000-3010-4000-8000-000000000002', '32000000-3000-4000-8000-000000000002', (select generation_lease_token from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'), 'stalled_after_crash')$$,
  'finalizing with the current lease token terminally fails the candidate'
);
select is(
  (select status::text from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'),
  'failed',
  'the finalized candidate is terminally failed'
);
select is(
  (select failure_code from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'),
  'stalled_after_crash',
  'the finalized candidate carries the stalled-after-crash failure code'
);
select is(
  (select generation_lease_token from public.generation_candidates where id = '32000000-3010-4000-8000-000000000002'),
  null,
  'the finalized candidate''s lease token is cleared'
);
select is(
  (select status::text from public.composition_sessions where id = '32000000-3000-4000-8000-000000000002'),
  'failed',
  'the stalled candidate''s session is failed alongside it, mirroring mark_generation_candidate_failed'
);

-- Plan 042: target_platforms/max_characters/temperature are frozen at session creation, like
-- effective_config_snapshot -- create_text_generation_session's p_target_platforms:
-- array['instagram','facebook'], p_max_characters: 2200, p_temperature: 0.6 (used throughout
-- this file) must land unchanged.
select is(
  (select row(target_platforms, max_characters, temperature) from public.composition_sessions where organization_id = '32000000-2000-4000-8000-000000000002' and input_hash = repeat('e', 64)),
  row(array['instagram', 'facebook']::text[], 2200, 0.6),
  'create_text_generation_session freezes target_platforms/max_characters/temperature onto the new session'
);
-- 'mastodon' statt 'twitter': seit Paket 045 ist twitter eine gueltige Zielplattform, dieser Test
-- braucht deshalb einen weiterhin nicht implementierten Wert.
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('paket-042-invalid-platform'::bytea), 'hex'), array['mastodon']::text[], '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: target_platforms only accepts instagram, facebook, twitter, linkedin or website'
);
-- Mehrfachauswahl darf keine Doppelung enthalten, sonst zaehlt eine Plattform bei einer kuenftigen
-- Pro-Plattform-Ausgabe (Plan 005) doppelt. Der Wert kaeme sonst am <@-Test vorbei.
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, target_platforms, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('paket-042-duplicate-platform'::bytea), 'hex'), array['instagram', 'instagram']::text[], '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: target_platforms rejects a duplicated platform'
);
-- Das leere Array bleibt erlaubt: Sitzungen von vor dieser Migration haben nie eine Plattform
-- gewaehlt (siehe Migrationskommentar). Die API verlangt fuer neue Sitzungen mindestens eine.
select lives_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('paket-042-no-platform'::bytea), 'hex'), '32000000-0000-4000-8000-000000000002')$$,
  'a pre-migration session without any platform choice stays valid'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, max_characters, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('paket-042-invalid-characters'::bytea), 'hex'), 99, '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: max_characters below 100 is rejected'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, temperature, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, encode(sha256('paket-042-invalid-temperature'::bytea), 'hex'), 0.5, '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: temperature only accepts one of the four fixed regler steps'
);

-- Textwerkstatt-Autosaves are personal, tenant-scoped drafts. They are deliberately not exposed
-- through a broad department membership policy: another editor can see the eventual post, but
-- never the unfinished raw input of this member.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('32000000-5100-4000-8000-000000000099', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'draft_ready', '32000000-0000-4000-8000-000000000002');
insert into public.text_workshop_drafts (id, organization_id, department_id, post_id, payload, created_by) values
  ('32000000-5200-4000-8000-000000000099', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-5100-4000-8000-000000000099', '{"factsText":"Übung: Passen"}', '32000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.text_workshop_drafts where id = '32000000-5200-4000-8000-000000000099'), 1, 'positive: a draft creator can read their own text workshop draft');
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.text_workshop_drafts where id = '32000000-5200-4000-8000-000000000099'), 0, 'negative: a member of another tenant cannot read a text workshop draft');
select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.text_workshop_drafts where id = '32000000-5200-4000-8000-000000000099'), 0, 'negative: another member of the same organization cannot read a personal text workshop draft');
set local role postgres;
update public.posts set status = 'awaiting_approval' where id = '32000000-5100-4000-8000-000000000099';
select is((select count(*)::integer from public.text_workshop_drafts where id = '32000000-5200-4000-8000-000000000099'), 0, 'a linked workshop draft is removed once its post is submitted for review');

select * from finish();
rollback;
