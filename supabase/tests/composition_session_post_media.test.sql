begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '46000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-session-media.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '46000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'viewer@pgtap-session-media.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '46000000-0000-4000-8000-000000000099', 'authenticated', 'authenticated', 'fremdverein@pgtap-session-media.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('46000000-1000-4000-8000-000000000001', 'PGTAP Session Media Verein', 'pgtap-session-media-verein'),
  ('46000000-1000-4000-8000-000000000002', 'PGTAP Session Media Fremdverein', 'pgtap-session-media-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('46000000-1100-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('46000000-1100-4000-8000-000000000002', '46000000-1000-4000-8000-000000000001', 'Handball', 'handball'),
  ('46000000-1100-4000-8000-000000000099', '46000000-1000-4000-8000-000000000002', 'Fremdabteilung', 'fremdabteilung');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', 'department_admin'),
  ('46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002', 'viewer');

insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, scan_status, upload_status, structural_validation_status, people_reviewed_at, created_by) values
  ('46000000-2000-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/x/departments/y/assets/1/a.jpg', 'image/jpeg', 1000, 'clean', 'ready', 'valid', now(), '46000000-0000-4000-8000-000000000001'),
  ('46000000-2000-4000-8000-000000000002', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000002', 'raw-media', 'organizations/x/departments/z/assets/2/b.jpg', 'image/jpeg', 1000, 'clean', 'ready', 'valid', now(), '46000000-0000-4000-8000-000000000001'),
  -- Zweites Fussball-Foto -- Plan 047, PR 0: mehrere Anhaenge je Sitzung.
  ('46000000-2000-4000-8000-000000000003', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/x/departments/y/assets/3/c.jpg', 'image/jpeg', 1000, 'clean', 'ready', 'valid', now(), '46000000-0000-4000-8000-000000000001');

insert into public.composition_sessions (id, organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values
  ('46000000-3000-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('a', 64), '46000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000002', true);

-- 1: a viewer without post.edit cannot attach a photo (RLS with check fails).
select throws_ok(
  $$insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, created_by) values ('46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a department viewer without post.edit cannot attach a photo to the session'
);

select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', true);

-- 2: an asset from a DIFFERENT department (same organization) is rejected by the RLS check --
-- the composite FKs alone only guarantee same-organization, not same-department.
select throws_ok(
  $$insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, created_by) values ('46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000002', '46000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'an asset from a different department than the session is rejected'
);

-- 3: a cross-tenant reference (organization_id vs. the session''s real organization) violates the
-- composite FK to composition_sessions -- checked under postgres (bypasses RLS) to isolate the FK
-- itself from the RLS write policy, which would independently reject the same row anyway.
set local role postgres;
select throws_ok(
  $$insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, created_by) values ('46000000-1000-4000-8000-000000000002', '46000000-3000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'a mismatched organization_id violates the composite foreign key to composition_sessions'
);
set local role authenticated;

-- 4-5: the department_admin can attach their own department''s ready photo to their own session.
select lives_ok(
  $$insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, created_by) values ('46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001')$$,
  'attaching a same-department, ready photo succeeds'
);
select is((select count(*)::integer from public.composition_session_post_media where composition_session_id = '46000000-3000-4000-8000-000000000001'), 1, 'exactly one attachment row exists for the session');

-- 6-8: Plan 047, PR 0 hebt "hoechstens ein Anhang je Sitzung" auf -- ein zweiter Anhang derselben
-- Sitzung auf einer ANDEREN Position gelingt jetzt, ein zweiter Anhang auf DERSELBEN Position
-- verletzt weiterhin die (jetzt zusammengesetzte) unique(composition_session_id, position).
select lives_ok(
  $$insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, position, role, created_by) values ('46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000003', 1, 'slide', '46000000-0000-4000-8000-000000000001')$$,
  'a second attachment for the same session on a different position now succeeds'
);
select is((select count(*)::integer from public.composition_session_post_media where composition_session_id = '46000000-3000-4000-8000-000000000001'), 2, 'both attachments now exist for the session');
select throws_ok(
  $$insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, created_by) values ('46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a second attachment for the same session on the SAME (default) position still violates the uniqueness constraint'
);

-- 7: negative read -- an unrelated tenant member cannot see this attachment at all.
select set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000099', true);
select is((select count(*)::integer from public.composition_session_post_media), 0, 'negative: an unrelated tenant member cannot read this session''s photo attachment');

-- The remaining constraint and cascading-deletion checks deliberately run as postgres, without
-- RLS. Keep any future authorization assertions above this boundary or restore authenticated.
-- 8-11: accept_text_generation_candidate wires the resolved derivative into a real post_media row,
-- exactly once, even across a retried accept call.
set local role postgres;
insert into public.llm_provider_configurations (id, label, protocol, base_url, model) values
  ('46000000-4000-4000-8000-000000000001', 'Session Media Smoke Provider', 'openai', 'https://provider.example.test', 'smoke-test-model');
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('46000000-5000-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000001', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/derivatives/1/pass-through.jpg', repeat('b', 64), 'image/jpeg', 1000, 'ready');
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, generated_content, provider_configuration_id, provider_model_id, provider_parameter_hash, prompt_template_version) values
  ('46000000-6000-4000-8000-000000000001', '46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', 'initial', 'ready', repeat('c', 64),
   '{"headline":"Training","caption":"Heute Training.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Foto","safetyFlags":[]}'::jsonb,
   '46000000-4000-4000-8000-000000000001', 'smoke-test-model', repeat('d', 64), 'v1');

-- Simulates apps/api/src/routes/content.ts resolving composition_session_post_media to a ready
-- derivative BEFORE calling this RPC -- a plain SQL function cannot copy storage bytes itself.
select (result->>'postVersionId')::uuid as version_id
  from (select public.accept_text_generation_candidate('46000000-6000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', array['46000000-5000-4000-8000-000000000001']::uuid[]) as result) rpc \gset
select is(
  (select count(*)::integer from public.post_media where post_version_id = :'version_id'),
  1, 'accepting the candidate creates exactly one post_media row from the session attachment'
);
select is(
  (select (media_derivative_id, position, role) from public.post_media where post_version_id = :'version_id'),
  ('46000000-5000-4000-8000-000000000001'::uuid, 0, 'primary'::text),
  'the post_media row points at the resolved pass-through derivative on position 0, role primary'
);

-- A retried accept (idempotent re-delivery) must not create a second post_media row.
select public.accept_text_generation_candidate('46000000-6000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', array['46000000-5000-4000-8000-000000000001']::uuid[]);
select is(
  (select count(*)::integer from public.post_media where post_version_id = :'version_id'),
  1, 'a retried accept call for the same candidate does not create a second post_media row'
);

-- Plan 047, PR 0: mehrere Medien-Derivate in EINEM Accept-Aufruf ergeben mehrere post_media-Zeilen,
-- in Array-Reihenfolge positioniert, Index 0 'primary' und alles danach 'slide'.
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('46000000-5000-4000-8000-000000000004', '46000000-1000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000003', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/derivatives/3/pass-through.jpg', repeat('9', 64), 'image/jpeg', 1000, 'ready');
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, generated_content, provider_configuration_id, provider_model_id, provider_parameter_hash, prompt_template_version) values
  ('46000000-6000-4000-8000-000000000004', '46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', 'initial', 'ready', repeat('4', 64),
   '{"headline":"Training","caption":"Heute Training.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Foto","safetyFlags":[]}'::jsonb,
   '46000000-4000-4000-8000-000000000001', 'smoke-test-model', repeat('d', 64), 'v1');
select (result->>'postVersionId')::uuid as multi_version_id
  from (select public.accept_text_generation_candidate('46000000-6000-4000-8000-000000000004', '46000000-0000-4000-8000-000000000001', array['46000000-5000-4000-8000-000000000001', '46000000-5000-4000-8000-000000000004']::uuid[]) as result) rpc \gset
select is(
  (select count(*)::integer from public.post_media where post_version_id = :'multi_version_id'),
  2, 'accepting with two derivative ids creates two post_media rows'
);
select is(
  (select (media_derivative_id, position, role) from public.post_media where post_version_id = :'multi_version_id' and position = 0),
  ('46000000-5000-4000-8000-000000000001'::uuid, 0, 'primary'::text),
  'position 0 points at the first derivative id and is role primary'
);
select is(
  (select (media_derivative_id, position, role) from public.post_media where post_version_id = :'multi_version_id' and position = 1),
  ('46000000-5000-4000-8000-000000000004'::uuid, 1, 'slide'::text),
  'position 1 points at the second derivative id and is role slide'
);

-- 12: an invalid (non-'ready') derivative id is rejected outright -- the RPC is trusted, but this
-- is defense in depth against an API-layer bug that resolves the wrong derivative.
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, generated_content, provider_configuration_id, provider_model_id, provider_parameter_hash, prompt_template_version) values
  ('46000000-6000-4000-8000-000000000002', '46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', 'initial', 'ready', repeat('e', 64),
   '{"headline":"Training","caption":"Heute Training.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Foto","safetyFlags":[]}'::jsonb,
   '46000000-4000-4000-8000-000000000001', 'smoke-test-model', repeat('d', 64), 'v1');
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('46000000-5000-4000-8000-000000000002', '46000000-1000-4000-8000-000000000001', '46000000-2000-4000-8000-000000000001', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/derivatives/1/pass-through-2.jpg', repeat('f', 64), 'image/jpeg', 1000, 'processing');
select throws_ok(
  $$select public.accept_text_generation_candidate('46000000-6000-4000-8000-000000000002', '46000000-0000-4000-8000-000000000001', array['46000000-5000-4000-8000-000000000002']::uuid[])$$,
  'P0001', 'invalid_media_derivative', 'a not-yet-ready derivative id is rejected instead of being linked into post_media'
);

-- 13: the pre-existing two-argument call shape (no photo attached) still works -- CREATE OR
-- REPLACE with an added default parameter must not break every caller that predates this PR.
insert into public.generation_candidates (id, organization_id, composition_session_id, generation_intent, status, input_hash, generated_content, provider_configuration_id, provider_model_id, provider_parameter_hash, prompt_template_version) values
  ('46000000-6000-4000-8000-000000000003', '46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000001', 'initial', 'ready', repeat('1', 64),
   '{"headline":"Training","caption":"Heute Training.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Foto","safetyFlags":[]}'::jsonb,
   '46000000-4000-4000-8000-000000000001', 'smoke-test-model', repeat('d', 64), 'v1');
select lives_ok(
  $$select public.accept_text_generation_candidate('46000000-6000-4000-8000-000000000003', '46000000-0000-4000-8000-000000000001')$$,
  'calling with only two arguments (text-only accept) still works after the added third parameter'
);

-- 14: cascading deletion -- removing the composition session removes its attachment row too. A
-- FRESH session/attachment, never accepted: the main session above now has post_generation_provenance
-- rows, and those are immutable even under an ON DELETE SET NULL cascade from composition_sessions.
insert into public.composition_sessions (id, organization_id, department_id, communication_goal, requested_formats, source_material, style_profile_snapshot, source_revision, input_hash, created_by) values
  ('46000000-3000-4000-8000-000000000002', '46000000-1000-4000-8000-000000000001', '46000000-1100-4000-8000-000000000001', 'inform', '["text_post"]', '{"facts":{"title":"Training"},"observations":[],"quotes":[],"doNotMention":[]}', '{}', 1, repeat('2', 64), '46000000-0000-4000-8000-000000000001');
insert into public.composition_session_post_media (organization_id, composition_session_id, media_asset_id, created_by) values
  ('46000000-1000-4000-8000-000000000001', '46000000-3000-4000-8000-000000000002', '46000000-2000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.composition_session_post_media where composition_session_id = '46000000-3000-4000-8000-000000000002'), 1, 'the attachment row still exists before the session is deleted');
delete from public.composition_sessions where id = '46000000-3000-4000-8000-000000000002';
select is((select count(*)::integer from public.composition_session_post_media where composition_session_id = '46000000-3000-4000-8000-000000000002'), 0, 'deleting the composition session cascades to its photo attachment row');

select * from finish();
rollback;
