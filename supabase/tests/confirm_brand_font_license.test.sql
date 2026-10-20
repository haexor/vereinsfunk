begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

set local role postgres;

-- confirm-license loeste jede gleichnamige 'ready'-Schrift ab, auch eine, die ein Markenprofil
-- noch auswaehlte, und brachte geloeschte oder abgeloeste Schriften wieder auf 'ready'.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-font-license.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('95000000-1000-4000-8000-000000000001', 'PGTAP Font License Verein', 'pgtap-font-license-verein'),
  ('95000000-1000-4000-8000-000000000002', 'PGTAP Font License Fremdverein', 'pgtap-font-license-fremdverein');

insert into public.brand_assets (id, organization_id, kind, object_path, mime_type, byte_size, sha256, font_family, font_weight, font_style, license_holder, license_confirmed_at, license_confirmed_by, status, created_by) values
  -- 1: gleiche Schrift, vom Vereinsprofil ausgewaehlt
  ('95000000-8000-4000-8000-000000000001', '95000000-1000-4000-8000-000000000001', 'font', 'organizations/x/brand/font-referenced.woff2', 'font/woff2', 100, repeat('1', 64), 'Custom Sans', 400, 'normal', 'Verein', now(), '95000000-0000-4000-8000-000000000001', 'ready', '95000000-0000-4000-8000-000000000001'),
  -- 2: gleiche Schrift, nirgends ausgewaehlt
  ('95000000-8000-4000-8000-000000000002', '95000000-1000-4000-8000-000000000001', 'font', 'organizations/x/brand/font-unused.woff2', 'font/woff2', 100, repeat('2', 64), 'Custom Sans', 400, 'normal', 'Verein', now(), '95000000-0000-4000-8000-000000000001', 'ready', '95000000-0000-4000-8000-000000000001'),
  -- 3: neuer Upload derselben Schrift, wartet auf die Lizenzbestaetigung
  ('95000000-8000-4000-8000-000000000003', '95000000-1000-4000-8000-000000000001', 'font', 'organizations/x/brand/font-new.woff2', 'font/woff2', 100, repeat('3', 64), 'Custom Sans', 400, 'normal', null, null, null, 'processing', '95000000-0000-4000-8000-000000000001'),
  -- 4: geloeschte Schrift
  ('95000000-8000-4000-8000-000000000004', '95000000-1000-4000-8000-000000000001', 'font', 'organizations/x/brand/font-deleted.woff2', 'font/woff2', 100, repeat('4', 64), 'Other Serif', 700, 'normal', null, null, null, 'deleted', '95000000-0000-4000-8000-000000000001');
insert into public.brand_assets (id, organization_id, kind, object_path, mime_type, byte_size, sha256, status, created_by) values
  ('95000000-8000-4000-8000-000000000005', '95000000-1000-4000-8000-000000000001', 'logo_mark', 'organizations/x/brand/logo.png', 'image/png', 100, repeat('5', 64), 'processing', '95000000-0000-4000-8000-000000000001');

insert into public.organization_brand_profiles (organization_id, display_font_asset_id) values
  ('95000000-1000-4000-8000-000000000001', '95000000-8000-4000-8000-000000000001');

-- 1-4: die neue Schrift wird freigegeben, nur die unbenutzte alte abgeloest.
select is(
  (select (status, license_holder)::text from public.confirm_brand_font_license('95000000-1000-4000-8000-000000000001', '95000000-8000-4000-8000-000000000003', 'Verein', null, '95000000-0000-4000-8000-000000000001')),
  '(ready,Verein)', 'die wartende Schrift wird mit Rechteinhaber freigegeben'
);
select is((select status from public.brand_assets where id = '95000000-8000-4000-8000-000000000002'), 'replaced',
  'eine nirgends ausgewaehlte gleiche Schrift wird abgeloest');
select is((select status from public.brand_assets where id = '95000000-8000-4000-8000-000000000001'), 'ready',
  'eine vom Markenprofil ausgewaehlte gleiche Schrift bleibt ready');
select throws_ok(
  $$select public.confirm_brand_font_license('95000000-1000-4000-8000-000000000001', '95000000-8000-4000-8000-000000000003', 'Verein', null, '95000000-0000-4000-8000-000000000001')$$,
  'P0001', 'brand_asset_not_pending_license', 'eine bereits freigegebene Schrift laesst sich nicht erneut bestaetigen'
);

-- 5-6: eine geloeschte Schrift kommt nicht per Lizenzbestaetigung zurueck.
select throws_ok(
  $$select public.confirm_brand_font_license('95000000-1000-4000-8000-000000000001', '95000000-8000-4000-8000-000000000004', 'Verein', null, '95000000-0000-4000-8000-000000000001')$$,
  'P0001', 'brand_asset_not_pending_license', 'eine geloeschte Schrift wird abgewiesen'
);
select is((select status from public.brand_assets where id = '95000000-8000-4000-8000-000000000004'), 'deleted',
  'die geloeschte Schrift bleibt geloescht');

-- 7-8: kein Schrift-Asset bzw. ein Asset eines anderen Vereins.
select throws_ok(
  $$select public.confirm_brand_font_license('95000000-1000-4000-8000-000000000001', '95000000-8000-4000-8000-000000000005', 'Verein', null, '95000000-0000-4000-8000-000000000001')$$,
  'P0001', 'not_a_font_asset', 'ein Logo laesst sich nicht als Schrift bestaetigen'
);
select throws_ok(
  $$select public.confirm_brand_font_license('95000000-1000-4000-8000-000000000002', '95000000-8000-4000-8000-000000000003', 'Verein', null, '95000000-0000-4000-8000-000000000001')$$,
  'P0001', 'brand_asset_not_found', 'ein Asset eines anderen Vereins wird nicht gefunden'
);

-- 9: nur die Service Role darf die Funktion aufrufen.
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.confirm_brand_font_license('95000000-1000-4000-8000-000000000001', '95000000-8000-4000-8000-000000000003', 'Verein', null, '95000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated darf confirm_brand_font_license nicht direkt aufrufen'
);

select * from finish();
rollback;
