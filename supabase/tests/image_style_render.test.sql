begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-style-render.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('48000000-1000-4000-8000-000000000001', 'PGTAP Style Render Verein', 'pgtap-style-render-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('48000000-1100-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');

insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, scan_status, upload_status, structural_validation_status, people_reviewed_at, created_by) values
  ('48000000-2000-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/x/departments/y/assets/1/a.jpg', 'image/jpeg', 1000, 'clean', 'ready', 'valid', now(), '48000000-0000-4000-8000-000000000001');

-- Post 1: draft_ready -- noch bearbeitbar, das eigentliche Ziel dieses Tests.
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('48000000-3000-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'draft_ready', '48000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('48000000-3100-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-3000-4000-8000-000000000001', 1, '{}', '{}', 'user', '48000000-0000-4000-8000-000000000001');
update public.posts set current_version_id = '48000000-3100-4000-8000-000000000001' where id = '48000000-3000-4000-8000-000000000001';
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('48000000-4000-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-2000-4000-8000-000000000001', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/derivatives/1/pass-through.jpg', repeat('b', 64), 'image/jpeg', 1000, 'ready');
insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('48000000-5000-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-3100-4000-8000-000000000001', '48000000-4000-4000-8000-000000000001', 0, 'primary');

-- Post 2: awaiting_approval -- bereits eingereicht, darf nicht mehr veraendert werden. Referenziert
-- denselben Ursprungs-media_asset wie Post 1 (zwei Beitraege koennen legitim dasselbe Foto zeigen).
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('48000000-3000-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'awaiting_approval', '48000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('48000000-3100-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', '48000000-3000-4000-8000-000000000002', 1, '{}', '{}', 'user', '48000000-0000-4000-8000-000000000001');
update public.posts set current_version_id = '48000000-3100-4000-8000-000000000002' where id = '48000000-3000-4000-8000-000000000002';
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('48000000-4000-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', '48000000-2000-4000-8000-000000000001', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/derivatives/1/pass-through-2.jpg', repeat('c', 64), 'image/jpeg', 1000, 'ready');
insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('48000000-5000-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', '48000000-3100-4000-8000-000000000002', '48000000-4000-4000-8000-000000000002', 0, 'primary');

-- 1: authenticated darf diese Funktion nicht direkt aufrufen -- die Berechtigungspruefung
-- ('post.edit') laeuft in der Route ueber den Nutzer-Client, diese Funktion ist Service-Role-only.
set local role authenticated;
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.apply_image_style_render('48000000-5000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', '48000000-2000-4000-8000-000000000001', 'organizations/x/derivatives/1/styled-1.png', repeat('d', 64), 'image/png', 1000, 100, 100, '{"kind":"image_style_v1"}')$$,
  '42501', null, 'authenticated darf apply_image_style_render nicht direkt aufrufen'
);

set local role postgres;

-- 2-4: Post 1 (draft_ready) -- der Aufruf legt ein neues 'ready'-Derivat an und aktualisiert
-- post_media auf dessen ID.
select lives_ok(
  $$select public.apply_image_style_render('48000000-5000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', '48000000-2000-4000-8000-000000000001', 'organizations/x/derivatives/1/styled-1.png', repeat('d', 64), 'image/png', 1000, 100, 100, '{"kind":"image_style_v1","stylePresetId":"00000000-0000-4000-8000-000000000000"}')$$,
  'ein bearbeitbarer Post (draft_ready) laesst apply_image_style_render erfolgreich durchlaufen'
);
select is(
  (select (recipe->>'kind', status)::text from public.media_derivatives where object_path = 'organizations/x/derivatives/1/styled-1.png'),
  ('(image_style_v1,ready)')::text,
  'das neue Derivat ist sofort ready und traegt das uebergebene Rezept'
);
select is(
  (select media_derivative_id from public.post_media where id = '48000000-5000-4000-8000-000000000001'),
  (select id from public.media_derivatives where object_path = 'organizations/x/derivatives/1/styled-1.png'),
  'post_media zeigt danach auf das neue, gestylte Derivat statt auf den Pass-Through'
);

-- 5: ein Retry mit demselben object_path (deterministisches Sharp-Ergebnis) liefert dieselbe
-- Derivat-ID zurueck, statt an der Immutability-Sperre eines bereits 'ready'-Derivats zu scheitern.
select is(
  (select public.apply_image_style_render('48000000-5000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', '48000000-2000-4000-8000-000000000001', 'organizations/x/derivatives/1/styled-1.png', repeat('d', 64), 'image/png', 1000, 100, 100, '{"kind":"image_style_v1"}')),
  (select id from public.media_derivatives where object_path = 'organizations/x/derivatives/1/styled-1.png'),
  'ein Retry mit demselben object_path liefert dieselbe Derivat-ID zurueck statt ein zweites Mal zu schreiben'
);
select is(
  (select count(*)::integer from public.media_derivatives where object_path = 'organizations/x/derivatives/1/styled-1.png'),
  1, 'der Retry hat keine zweite Zeile fuer denselben object_path angelegt'
);

-- 6: Post 2 (awaiting_approval) -- bereits eingereicht, der Aufruf muss abgewiesen werden.
select throws_ok(
  $$select public.apply_image_style_render('48000000-5000-4000-8000-000000000002', '48000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', '48000000-2000-4000-8000-000000000001', 'organizations/x/derivatives/1/styled-2.png', repeat('e', 64), 'image/png', 1000, 100, 100, '{"kind":"image_style_v1"}')$$,
  'P0001', 'post_not_editable', 'ein bereits zur Freigabe eingereichter Post (awaiting_approval) lehnt den Aufruf ab'
);

-- 7-8: derselbe Ursprungs-media_asset an zwei Beitraegen -- das Abweisen von Post 2 darf dessen
-- post_media-Zeile nicht veraendert haben, und Post 1s bereits geschriebenes Derivat bleibt unberuehrt.
select is(
  (select media_derivative_id from public.post_media where id = '48000000-5000-4000-8000-000000000002'),
  '48000000-4000-4000-8000-000000000002'::uuid,
  'die abgewiesene Anfrage fuer Post 2 hat dessen post_media-Zeiger nicht veraendert'
);
select is(
  (select media_derivative_id from public.post_media where id = '48000000-5000-4000-8000-000000000001'),
  (select id from public.media_derivatives where object_path = 'organizations/x/derivatives/1/styled-1.png'),
  'Post 1s Derivat-Zeiger ist von der abgewiesenen Anfrage fuer Post 2 unberuehrt'
);

select * from finish();
rollback;
