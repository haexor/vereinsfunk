begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

set local role postgres;

-- Review-Fund PR #138: DELETE /v1/brand/assets/:id konnte ein noch referenziertes Asset auf
-- status='deleted' setzen, weil die Route nur nach status='ready' filterte, ohne
-- organization_/department_/team_brand_profiles oder image_style_presets zu pruefen. Diese Suite
-- deckt nur die organization_brand_profiles- und die image_style_presets-Verzweigung ab (andere
-- Spaltennamen, damit ein Tippfehler in der UNION ALL nicht unbemerkt bleibt) --
-- department_/team_brand_profiles teilen dieselben Spaltennamen wie organization_brand_profiles.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-delete-guard.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values ('68000000-1000-4000-8000-000000000001', 'PGTAP Delete Guard Verein', 'pgtap-delete-guard-verein');

insert into public.brand_assets (id, organization_id, kind, object_path, mime_type, byte_size, sha256, status, created_by) values
  ('68000000-8000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', 'logo_mark', 'organizations/x/brand/unreferenced.png', 'image/png', 100, repeat('1', 64), 'ready', '68000000-0000-4000-8000-000000000001'),
  ('68000000-8000-4000-8000-000000000002', '68000000-1000-4000-8000-000000000001', 'logo_primary', 'organizations/x/brand/active-logo.png', 'image/png', 100, repeat('2', 64), 'ready', '68000000-0000-4000-8000-000000000001'),
  ('68000000-8000-4000-8000-000000000003', '68000000-1000-4000-8000-000000000001', 'watermark', 'organizations/x/brand/preset-watermark.png', 'image/png', 100, repeat('3', 64), 'ready', '68000000-0000-4000-8000-000000000001'),
  ('68000000-8000-4000-8000-000000000004', '68000000-1000-4000-8000-000000000001', 'logo_mark', 'organizations/x/brand/still-processing.png', 'image/png', 100, repeat('4', 64), 'processing', '68000000-0000-4000-8000-000000000001');

insert into public.organization_brand_profiles (organization_id, logo_asset_id) values
  ('68000000-1000-4000-8000-000000000001', '68000000-8000-4000-8000-000000000002');

insert into public.image_style_presets (organization_id, name, logo_enabled, logo_brand_asset_id, logo_size_percent, logo_margin_percent, created_by) values
  ('68000000-1000-4000-8000-000000000001', 'PGTAP Preset', true, '68000000-8000-4000-8000-000000000003', 10, 5, '68000000-0000-4000-8000-000000000001');

-- 1-2: ein unreferenziertes Asset wird geloescht, unabhaengig von seinem bisherigen Status --
-- der status='ready'-Filter der urspruenglichen Route haette Nr. 4 (processing) faelschlich
-- dauerhaft unloeschbar gemacht.
select is(public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000001'), '68000000-8000-4000-8000-000000000001'::uuid,
  'an unreferenced ready asset is deleted and its id is returned');
select is(public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000004'), '68000000-8000-4000-8000-000000000004'::uuid,
  'an unreferenced processing asset is deletable too, not just ready ones');

-- 3-4: ein von organization_brand_profiles.logo_asset_id referenziertes Asset wird atomar
-- abgelehnt, statt eine tote Referenz zu hinterlassen.
select throws_ok(
  $$select public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000002')$$,
  'P0001', 'brand_asset_referenced', 'deleting a logo referenced by organization_brand_profiles.logo_asset_id is rejected'
);
select is((select status from public.brand_assets where id = '68000000-8000-4000-8000-000000000002'), 'ready',
  'the rejected asset keeps its ready status, unchanged by the failed delete attempt');

-- 5-6: dieselbe Ablehnung fuer die image_style_presets-Verzweigung (eigene Spaltennamen).
select throws_ok(
  $$select public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000003')$$,
  'P0001', 'brand_asset_referenced', 'deleting a watermark referenced by image_style_presets.logo_brand_asset_id is rejected'
);
select is((select status from public.brand_assets where id = '68000000-8000-4000-8000-000000000003'), 'ready',
  'the rejected preset watermark keeps its ready status, unchanged by the failed delete attempt');

-- 7: ein zweiter Loeschversuch desselben (jetzt bereits geloeschten) Assets liefert null statt
-- eines stillen Zweit-Updates oder Fehlers -- die Route macht daraus eine saubere 404.
select is(public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000001'), null,
  'deleting an already-deleted asset returns null instead of erroring or re-deleting');

-- 8: ein unbekanntes Asset liefert ebenfalls null.
select is(public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000099'), null,
  'deleting a nonexistent asset id returns null');

-- 9: nur die Service Role darf die Funktion aufrufen, dieselbe Grenze wie bei den anderen
-- brand_assets-Schreibzugriffen (siehe brand_assets_and_fonts.test.sql, 7-8).
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.delete_brand_asset_if_unused('68000000-8000-4000-8000-000000000004')$$,
  '42501', null, 'authenticated cannot call delete_brand_asset_if_unused directly'
);

select * from finish();
rollback;
