begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- 2026101911: Rohmedien auf Vereinsebene (department_id null, Pfad organizations/<org>/assets/...)
-- sehen nur Mitglieder mit Vereinsrolle, nicht reine Team-Mitglieder wie die Rolle 'player'.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'vereinsadmin@pgtap-org-raw-media.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'spieler@pgtap-org-raw-media.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('a2000000-1000-4000-8000-000000000001', 'PGTAP Vereinsmedien', 'pgtap-vereinsmedien');
insert into public.departments (id, organization_id, name, slug) values
  ('a2000000-1100-4000-8000-000000000001', 'a2000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('a2000000-1200-4000-8000-000000000001', 'a2000000-1000-4000-8000-000000000001', 'a2000000-1100-4000-8000-000000000001', 'U13');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('a2000000-1000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'organization_admin');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('a2000000-1000-4000-8000-000000000001', 'a2000000-1100-4000-8000-000000000001', 'a2000000-1200-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'player');

insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, upload_status, scan_status, created_by) values
  ('a2000000-1700-4000-8000-000000000001', 'a2000000-1000-4000-8000-000000000001', null, 'raw-media', 'organizations/a2000000-1000-4000-8000-000000000001/assets/a2000000-1700-4000-8000-000000000001/foto.jpg', 'image/jpeg', 1024, 'ready', 'clean', 'a2000000-0000-4000-8000-000000000001');
insert into public.face_regions (id, organization_id, media_asset_id, x, y, width, height, source, subject_kind, decision) values
  ('a2000000-1800-4000-8000-000000000001', 'a2000000-1000-4000-8000-000000000001', 'a2000000-1700-4000-8000-000000000001', 0.1, 0.1, 0.2, 0.2, 'manual', 'minor', 'pending');
insert into storage.objects (bucket_id, name) values
  ('raw-media', 'organizations/a2000000-1000-4000-8000-000000000001/assets/a2000000-1700-4000-8000-000000000001/foto.jpg');

set local role authenticated;

-- 1-3: positiv -- die Vereinsadministration sieht Asset, Gesichtsregion und Originaldatei.
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.media_assets where id = 'a2000000-1700-4000-8000-000000000001'), 1,
  'an organization member reads the organization-level media asset');
select is((select count(*)::integer from public.face_regions where media_asset_id = 'a2000000-1700-4000-8000-000000000001'), 1,
  'an organization member reads the face regions of the organization-level media asset');
select is((select count(*)::integer from storage.objects where name like 'organizations/a2000000-1000-4000-8000-000000000001/assets/%'), 1,
  'an organization member reads the organization-level raw media object');

-- 4-6: negativ -- ein reines Team-Mitglied (Spieler) sieht nichts davon.
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.media_assets where id = 'a2000000-1700-4000-8000-000000000001'), 0,
  'negative: a team-only player cannot read the organization-level media asset');
select is((select count(*)::integer from public.face_regions where media_asset_id = 'a2000000-1700-4000-8000-000000000001'), 0,
  'negative: a team-only player cannot read its face regions');
select is((select count(*)::integer from storage.objects where name like 'organizations/a2000000-1000-4000-8000-000000000001/assets/%'), 0,
  'negative: a team-only player cannot read the organization-level raw media object');

select * from finish();
rollback;
