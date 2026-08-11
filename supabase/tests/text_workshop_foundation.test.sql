begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

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
  ('31000000-1200-4000-8000-000000000001', '31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'klar-und-nah', 'Klar und nah', 'Kurze, konkrete Sätze', '{"sentenceLength":"short","energy":3,"humour":"none","formality":"balanced","perspective":"we","bannedPhrases":[],"additionalInstructions":""}', '{Floskeln}', '31000000-0000-4000-8000-000000000001'),
  ('32000000-2400-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'warm-und-nah', 'Warm und nah', 'Gemeinschaft zuerst', '{"sentenceLength":"mixed","energy":3,"humour":"light","formality":"balanced","perspective":"we","bannedPhrases":[],"additionalInstructions":""}', '{Phrasen}', '32000000-0000-4000-8000-000000000002');
insert into public.composition_sessions (id, organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values
  ('32000000-2500-4000-8000-000000000002', '32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', '32000000-2300-4000-8000-000000000002', 'training-update', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002');

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
select throws_ok(
  $$insert into public.content_style_profiles (organization_id, department_id, slug, name, description, style_rules, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', 'klar_erklaerend', 'Duplikat', 'Must fail', '{}', '31000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'negative: database rejects a custom profile shadowing a reserved system slug'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'training-update', 'not_a_real_goal', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects an unknown communication goal'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'training-update', 'inform', '["video_post", "photo_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects video_post combined with another presentation type'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'training-update', 'inform', '["text_post", "text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects duplicate entries in requestedFormats'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('31000000-1000-4000-8000-000000000001', '31000000-1100-4000-8000-000000000001', '32000000-2300-4000-8000-000000000002', 'training-update', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '31000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'negative: a session cannot reference a team from another organization/department'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'training-update', 'inform', '["text_post"]', '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects source_material.facts that is not an object'
);
select throws_ok(
  $$insert into public.composition_sessions (organization_id, department_id, preset_slug, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values ('32000000-2000-4000-8000-000000000002', '32000000-2200-4000-8000-000000000002', 'training-update', 'inform', '["text_post"]', '{"facts":{},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '32000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'negative: database rejects source_material with no facts, observations, or quotes'
);

-- Fixtures for the immutability test below: a post_generation_provenance row needs a real
-- post_version and an llm_provider_configurations row to satisfy its FKs.
insert into public.llm_provider_configurations (id, label, protocol, base_url, model) values
  ('31000000-4000-4000-8000-000000000001', 'Style Provider', 'anthropic', 'https://api.example.test', 'test-model');
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

select * from finish();
rollback;
