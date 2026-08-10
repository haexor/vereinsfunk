begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

select * from finish();
rollback;
