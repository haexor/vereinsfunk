begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '45000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-people-review.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'viewer@pgtap-people-review.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('45000000-1000-4000-8000-000000000001', 'PGTAP People Review Verein', 'pgtap-people-review-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('45000000-1100-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('45000000-1000-4000-8000-000000000001', '45000000-1100-4000-8000-000000000001', '45000000-0000-4000-8000-000000000001', 'department_admin'),
  ('45000000-1000-4000-8000-000000000001', '45000000-1100-4000-8000-000000000001', '45000000-0000-4000-8000-000000000002', 'viewer');

insert into public.media_assets (
  id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size,
  scan_status, upload_status, structural_validation_status, created_by
) values (
  '45000000-2000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', '45000000-1100-4000-8000-000000000001',
  'raw-media', 'organizations/x/departments/y/assets/1/a.jpg', 'image/jpeg', 1000,
  'clean', 'ready', 'valid', '45000000-0000-4000-8000-000000000001'
);

set local role authenticated;

-- 1: post.edit is required -- a department viewer cannot confirm the people-review signal at all.
select set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', false)$$,
  'P0001', 'insufficient_permission', 'a department viewer without post.edit cannot confirm the people-review signal'
);

select set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-000000000001', true);

-- 2-3: "no people" contradicts an already marked face region -- this is the check that keeps
-- confirm_media_people_review from being the rubberstamp mediaGate.ts:42/130 used to be.
-- Inserted AS authenticated (department_admin), not postgres: this is what the browser's own
-- Foto-Markier-UI does directly, and it is what caught the missing SECURITY DEFINER on
-- invalidate_people_review_on_face_change() (real Playwright run, "permission denied for table
-- media_assets") -- a postgres-role fixture insert would never have exercised that trigger's own
-- privileges and would have stayed green despite the bug.
insert into public.face_regions (id, organization_id, media_asset_id, x, y, width, height, source, subject_kind, decision) values
  ('45000000-3000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', '45000000-2000-4000-8000-000000000001', 0.1, 0.1, 0.2, 0.2, 'manual', 'adult', 'pending');
select throws_ok(
  $$select public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', false)$$,
  'P0001', 'faces_present_mismatch', '"no people" is rejected while a face region already exists for this asset'
);
select throws_ok(
  $$select public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)$$,
  'P0001', 'faces_incomplete', '"people present" is rejected while a marked region is still undecided'
);

-- 4: deciding the region (no consent needed for 'exclude') makes "people present" succeed.
set local role postgres;
update public.face_regions set decision = 'exclude' where id = '45000000-3000-4000-8000-000000000001';
set local role authenticated;
select ok(
  (select people_reviewed_at from public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)) is not null,
  'confirm_media_people_review succeeds once every marked region has a decision'
);
select is(
  (select people_reviewed_by from public.media_assets where id = '45000000-2000-4000-8000-000000000001'),
  '45000000-0000-4000-8000-000000000001'::uuid, 'people_reviewed_by records the confirming member, never a client-supplied actor'
);

-- 5: a NEW face region invalidates the just-set signal (trigger on face_regions insert).
set local role postgres;
insert into public.face_regions (id, organization_id, media_asset_id, x, y, width, height, source, subject_kind, decision) values
  ('45000000-3000-4000-8000-000000000002', '45000000-1000-4000-8000-000000000001', '45000000-2000-4000-8000-000000000001', 0.5, 0.5, 0.1, 0.1, 'manual', 'adult', 'exclude');
select is(
  (select people_reviewed_at from public.media_assets where id = '45000000-2000-4000-8000-000000000001'),
  null, 'inserting a new face region resets the people-review signal'
);

-- 6: re-confirm, then an UPDATE to an existing region invalidates it again.
set local role authenticated;
select ok(
  (select people_reviewed_at from public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)) is not null,
  're-confirming succeeds once the new region also has a decision'
);
set local role postgres;
update public.face_regions set decision = 'obscure', obscuring_style = 'solid_blur' where id = '45000000-3000-4000-8000-000000000002';
select is(
  (select people_reviewed_at from public.media_assets where id = '45000000-2000-4000-8000-000000000001'),
  null, 'updating an existing face region resets the people-review signal'
);

-- 7: re-confirm, then DELETE-ing a region invalidates it again too. Deleted AS authenticated, not
-- postgres: the browser's own "Markierung entfernen" button does exactly this and needs a real
-- DELETE grant on face_regions, which the original 202608030001 migration never issued (found via
-- the same Playwright run as the SECURITY DEFINER gap above).
select ok(
  (select people_reviewed_at from public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)) is not null,
  're-confirming succeeds a second time'
);
delete from public.face_regions where id = '45000000-3000-4000-8000-000000000002';
select is(
  (select people_reviewed_at from public.media_assets where id = '45000000-2000-4000-8000-000000000001'),
  null, 'deleting a face region resets the people-review signal'
);

-- 8: re-confirm, then a content-identifying change on media_assets itself invalidates it --
-- but an unrelated column (contains_minors) does NOT.
set local role authenticated;
select ok(
  (select people_reviewed_at from public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)) is not null,
  're-confirming succeeds a third time (one remaining, decided region)'
);
set local role postgres;
update public.media_assets set upload_status = 'ready' where id = '45000000-2000-4000-8000-000000000001';
select is(
  (select people_reviewed_at from public.media_assets where id = '45000000-2000-4000-8000-000000000001'),
  null, 'touching a content-identifying column (upload_status) resets the people-review signal, even to the same value'
);
set local role authenticated;
select ok(
  (select people_reviewed_at from public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)) is not null,
  're-confirming succeeds a fourth time'
);
set local role postgres;
update public.media_assets set contains_minors = true where id = '45000000-2000-4000-8000-000000000001';
select is(
  (select people_reviewed_at from public.media_assets where id = '45000000-2000-4000-8000-000000000001') is not null,
  true, 'touching an unrelated column (contains_minors) leaves the people-review signal intact'
);

-- 9: the blanket UPDATE grant is gone -- a browser role can no longer self-certify this field.
set local role authenticated;
select throws_ok(
  $$update public.media_assets set people_reviewed_at = now() where id = '45000000-2000-4000-8000-000000000001'$$,
  '42501', null, 'a browser role cannot set people_reviewed_at directly, only through confirm_media_people_review'
);

-- 10: schedule_publication's new fifth media_blockers clause. A fully clean chain (scan clean,
-- derivative ready, no pending/consented face region) still blocks on people_review_pending alone
-- until confirmed, then succeeds once confirmed.
set local role postgres;
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('45000000-4000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', '45000000-1100-4000-8000-000000000001', 'approved', '45000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('45000000-5000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', '45000000-4000-4000-8000-000000000001', 1, '{}', '{}', 'user', '45000000-0000-4000-8000-000000000001');
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('45000000-6000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', '45000000-2000-4000-8000-000000000001', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/departments/y/derivatives/1.jpg', repeat('a', 64), 'image/jpeg', 1000, 'ready');
insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('45000000-7000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', '45000000-5000-4000-8000-000000000001', '45000000-6000-4000-8000-000000000001', 0, 'primary');
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name) values
  ('45000000-8000-4000-8000-000000000001', '45000000-1000-4000-8000-000000000001', 'instagram', 'ext-1', 'PGTAP Verein');
insert into public.channel_scopes (organization_id, social_connection_id, scope, created_by) values
  ('45000000-1000-4000-8000-000000000001', '45000000-8000-4000-8000-000000000001', 'organization', '45000000-0000-4000-8000-000000000001');
-- The 42501 test above left people_reviewed_at set from the prior successful confirm (its own
-- update was rejected, not applied) -- invalidate it once more via the content-change trigger so
-- this block starts from a genuinely unreviewed asset.
update public.media_assets set contains_minors = false, upload_status = 'ready' where id = '45000000-2000-4000-8000-000000000001';

set local role authenticated;
select throws_ok(
  $$select public.schedule_publication('45000000-5000-4000-8000-000000000001', '45000000-8000-4000-8000-000000000001', now() + interval '1 hour')$$,
  'P0001', 'media_gate_blocked: people_review_pending', 'schedule_publication blocks on people_review_pending alone once the photo has never been reviewed'
);
select ok(
  (select people_reviewed_at from public.confirm_media_people_review('45000000-2000-4000-8000-000000000001', true)) is not null,
  'confirming the review clears the way for scheduling'
);
select ok(
  (select status from public.schedule_publication('45000000-5000-4000-8000-000000000001', '45000000-8000-4000-8000-000000000001', now() + interval '1 hour')) = 'queued',
  'schedule_publication now succeeds once the photo has been reviewed for people'
);

select * from finish();
rollback;
