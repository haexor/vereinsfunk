begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- 2026101912: authenticated legt weder media_assets-Zeilen noch raw-media-Objekte direkt an --
-- beides laeuft ueber reserve_storage_upload() und eine signierte Upload-URL.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'redaktion@pgtap-no-direct-media.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('a3000000-1000-4000-8000-000000000001', 'PGTAP Keine Direktmedien', 'pgtap-keine-direktmedien');
insert into public.departments (id, organization_id, name, slug) values
  ('a3000000-1100-4000-8000-000000000001', 'a3000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('a3000000-1000-4000-8000-000000000001', 'a3000000-1100-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'department_admin');

select ok(not has_table_privilege('authenticated', 'public.media_assets', 'INSERT'), 'authenticated holds no INSERT privilege on media_assets');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);

-- Ein department_admin (post.create) kann keine als fertig gepruefte Zeile faelschen ...
select throws_ok(
  $$insert into public.media_assets (organization_id, department_id, bucket_id, object_path, mime_type, byte_size, upload_status, scan_status, structural_validation_status, people_reviewed_at, created_by)
    values ('a3000000-1000-4000-8000-000000000001', 'a3000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/a3000000-1000-4000-8000-000000000001/departments/a3000000-1100-4000-8000-000000000001/assets/x/foto.jpg', 'image/jpeg', 12, 'ready', 'clean', 'valid', now(), 'a3000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'negative: a department admin cannot insert a forged ready/clean media asset'
);

-- ... und keine Bytes am Upload-Pfad vorbei in raw-media ablegen.
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('raw-media', 'organizations/a3000000-1000-4000-8000-000000000001/departments/a3000000-1100-4000-8000-000000000001/assets/x/foto.jpg')$$,
  '42501', null, 'negative: a department admin cannot upload raw media directly into storage'
);

set local role postgres;
select is((select count(*)::integer from public.media_assets where organization_id = 'a3000000-1000-4000-8000-000000000001'), 0, 'no media asset was created by the direct attempts');

select * from finish();
rollback;
