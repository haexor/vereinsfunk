begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

set local role postgres;

-- apply_image_style_render muss selbst pruefen, ob die post_media-Zeile noch zur aktuellen Fassung
-- gehoert: die Route prueft das vor einem Rendering, das 30 s und laenger dauern kann, und eine in
-- dieser Zeit angelegte neue Fassung liess das gestylte Bild sonst auf der alten Fassung landen.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-style-render-version.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('94000000-1000-4000-8000-000000000001', 'PGTAP Style Render Version Verein', 'pgtap-style-render-version-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('94000000-1100-4000-8000-000000000001', '94000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');

insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, scan_status, upload_status, structural_validation_status, people_reviewed_at, created_by) values
  ('94000000-2000-4000-8000-000000000001', '94000000-1000-4000-8000-000000000001', '94000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/x/departments/y/assets/1/a.jpg', 'image/jpeg', 1000, 'clean', 'ready', 'valid', now(), '94000000-0000-4000-8000-000000000001');

-- Ein bearbeitbarer Beitrag mit zwei Fassungen: das Foto haengt an Fassung 1, aktuell ist Fassung 2.
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('94000000-3000-4000-8000-000000000001', '94000000-1000-4000-8000-000000000001', '94000000-1100-4000-8000-000000000001', 'draft_ready', '94000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('94000000-3100-4000-8000-000000000001', '94000000-1000-4000-8000-000000000001', '94000000-3000-4000-8000-000000000001', 1, '{}', '{}', 'user', '94000000-0000-4000-8000-000000000001'),
  ('94000000-3100-4000-8000-000000000002', '94000000-1000-4000-8000-000000000001', '94000000-3000-4000-8000-000000000001', 2, '{}', '{}', 'user', '94000000-0000-4000-8000-000000000001');
update public.posts set current_version_id = '94000000-3100-4000-8000-000000000002' where id = '94000000-3000-4000-8000-000000000001';
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('94000000-4000-4000-8000-000000000001', '94000000-1000-4000-8000-000000000001', '94000000-2000-4000-8000-000000000001', '{"kind":"pass_through_v1"}', 'pass-through-v1', 'organizations/x/derivatives/94/pass-through.jpg', repeat('b', 64), 'image/jpeg', 1000, 'ready');
insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('94000000-5000-4000-8000-000000000001', '94000000-1000-4000-8000-000000000001', '94000000-3100-4000-8000-000000000001', '94000000-4000-4000-8000-000000000001', 0, 'primary');

-- 1: das Foto einer nicht mehr aktuellen Fassung wird abgewiesen.
select throws_ok(
  $$select public.apply_image_style_render('94000000-5000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', '94000000-4000-4000-8000-000000000001', '94000000-2000-4000-8000-000000000001', 'organizations/x/derivatives/94/styled.png', repeat('d', 64), 'image/png', 1000, 100, 100, '{"kind":"image_style_v1"}')$$,
  'P0001', 'post_version_not_current', 'das Foto einer nicht mehr aktuellen Fassung wird abgewiesen'
);

-- 2: der post_media-Zeiger der alten Fassung bleibt unveraendert.
select is(
  (select media_derivative_id from public.post_media where id = '94000000-5000-4000-8000-000000000001'),
  '94000000-4000-4000-8000-000000000001'::uuid,
  'der abgewiesene Lauf hat den Zeiger der alten Fassung nicht veraendert'
);

-- 3: ist dieselbe Fassung wieder aktuell, laeuft der Aufruf durch.
update public.posts set current_version_id = '94000000-3100-4000-8000-000000000001' where id = '94000000-3000-4000-8000-000000000001';
select lives_ok(
  $$select public.apply_image_style_render('94000000-5000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', '94000000-4000-4000-8000-000000000001', '94000000-2000-4000-8000-000000000001', 'organizations/x/derivatives/94/styled.png', repeat('d', 64), 'image/png', 1000, 100, 100, '{"kind":"image_style_v1"}')$$,
  'das Foto der aktuellen Fassung wird weiterhin gestylt'
);

select * from finish();
rollback;
