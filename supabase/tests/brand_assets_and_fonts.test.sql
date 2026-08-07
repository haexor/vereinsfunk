begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

set local role postgres;

-- Ein Verein mit zwei Geschwister-Abteilungen (Fussball, Handball) und zwei Geschwister-Mannschaften
-- innerhalb von Fussball (Team A, Team B) -- genau die Konstellation, die die Abschottung aus Plan
-- 013 ("ein Asset der Abteilung Fussball ist fuer ein Mitglied der Abteilung Handball nicht lesbar")
-- prueft. Ein zweiter Verein fuer die Mandantentrennung.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'handball-admin@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fussball-editor@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'team-a-manager@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'team-b-manager@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'team-a-only@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-brand.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'plain-member@pgtap-brand.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('67000000-1000-4000-8000-000000000001', 'PGTAP Brand Verein', 'pgtap-brand-verein'),
  ('67000000-1000-4000-8000-000000000002', 'PGTAP Brand Fremdverein', 'pgtap-brand-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('67000000-1100-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('67000000-1100-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('67000000-1200-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', 'Team A'),
  ('67000000-1200-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', 'Team B');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('67000000-1000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('67000000-1000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000009', 'organization_viewer'),
  ('67000000-1000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000008', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-0000-4000-8000-000000000002', 'department_admin'),
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000002', '67000000-0000-4000-8000-000000000003', 'department_admin'),
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-0000-4000-8000-000000000004', 'editor');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-1200-4000-8000-000000000001', '67000000-0000-4000-8000-000000000005', 'team_manager'),
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-1200-4000-8000-000000000002', '67000000-0000-4000-8000-000000000006', 'team_manager'),
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-1200-4000-8000-000000000001', '67000000-0000-4000-8000-000000000007', 'contributor');

-- 1-4: Lizenzpflicht haengt am Status, nicht am Insert (Plan 013, "Datenmodell").
select throws_ok(
  $$insert into public.brand_assets (organization_id, kind, object_path, mime_type, byte_size, sha256, status, created_by)
    values ('67000000-1000-4000-8000-000000000001', 'font', 'organizations/x/brand/font-a.woff2', 'font/woff2', 1000, repeat('a', 64), 'ready', '67000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a font asset cannot become ready without family, license holder, confirmation time and confirming person'
);
insert into public.brand_assets (id, organization_id, kind, object_path, mime_type, byte_size, sha256, status, created_by) values
  ('67000000-8000-4000-8000-000000000004', '67000000-1000-4000-8000-000000000001', 'font', 'organizations/x/brand/font-a.woff2', 'font/woff2', 1000, repeat('a', 64), 'processing', '67000000-0000-4000-8000-000000000001');
select ok(true, 'a font asset can be created in processing status without any license fields');
select throws_ok(
  $$update public.brand_assets set status = 'ready' where id = '67000000-8000-4000-8000-000000000004'$$,
  '23514', null, 'a processing font asset cannot move to ready without completing the license fields'
);
update public.brand_assets set status = 'ready', font_family = 'Custom Sans', font_weight = 400, font_style = 'normal',
  license_holder = 'Verein', license_confirmed_at = now(), license_confirmed_by = '67000000-0000-4000-8000-000000000001'
  where id = '67000000-8000-4000-8000-000000000004';
select ok(true, 'a font asset moves to ready once family, license holder, confirmation time and person are all set');

-- 5: department_id/team_id-Konsistenz.
select throws_ok(
  $$insert into public.brand_assets (organization_id, department_id, team_id, kind, object_path, mime_type, byte_size, sha256, created_by)
    values ('67000000-1000-4000-8000-000000000001', null, '67000000-1200-4000-8000-000000000001', 'logo_mark', 'organizations/x/brand/bad.png', 'image/png', 100, repeat('b', 64), '67000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'brand_assets rejects a team_id without a department_id'
);

-- Fixtures fuer die Sichtbarkeitspruefungen: ein vereinsweites Logo, ein Abteilungs-Logo
-- (Fussball), ein Mannschafts-Wortmark (Team A), ein Asset des Fremdvereins.
insert into public.brand_assets (id, organization_id, department_id, team_id, kind, object_path, mime_type, byte_size, sha256, status, created_by) values
  ('67000000-8000-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', null, null, 'logo_primary', 'organizations/a/brand/org-logo.png', 'image/png', 100, repeat('c', 64), 'ready', '67000000-0000-4000-8000-000000000001'),
  ('67000000-8000-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', null, 'logo_mark', 'organizations/a/brand/fussball-mark.png', 'image/png', 100, repeat('d', 64), 'ready', '67000000-0000-4000-8000-000000000002'),
  ('67000000-8000-4000-8000-000000000003', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-1200-4000-8000-000000000001', 'wordmark', 'organizations/a/brand/team-a-wordmark.png', 'image/png', 100, repeat('e', 64), 'ready', '67000000-0000-4000-8000-000000000005'),
  ('67000000-8000-4000-8000-000000000009', '67000000-1000-4000-8000-000000000002', null, null, 'logo_primary', 'organizations/b/brand/org-logo.png', 'image/png', 100, repeat('f', 64), 'ready', '67000000-0000-4000-8000-000000000008');

select is((select relforcerowsecurity from pg_class where oid = 'public.brand_assets'::regclass), true, 'brand_assets has FORCE ROW LEVEL SECURITY enabled');

-- 6-7: keine Schreibrechte fuer authenticated auf brand_assets -- nur die API mit Service Role.
set local role authenticated;
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.brand_assets (organization_id, kind, object_path, mime_type, byte_size, sha256, created_by)
    values ('67000000-1000-4000-8000-000000000001', 'watermark', 'organizations/a/brand/x.png', 'image/png', 10, repeat('0', 64), '67000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot insert into brand_assets even with organization.manage'
);
select throws_ok(
  $$update public.brand_assets set status = 'rejected' where id = '67000000-8000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update brand_assets even with organization.manage'
);

-- 8: vereinsweites Asset ist fuer jedes Vereinsmitglied sichtbar, auch ohne Abteilungsrolle.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000009', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000001'), 1,
  'the organization-wide logo is visible to a plain organization member');

-- 9-10: die eigentliche Anforderung -- ein Abteilungs-Asset ist nur innerhalb der eigenen
-- Abteilung sichtbar, nicht fuer eine Schwesterabteilung desselben Vereins.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000002'), 1,
  'the Fussball department logo is visible to a Fussball department admin');
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000002'), 0,
  'the Fussball department logo is invisible to the Handball department admin of the same club');

-- 11: Aufsicht von oben -- der Vereinsadmin sieht jedes Abteilungs-Asset.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000002'), 1,
  'the organization admin sees a department asset through management oversight');

-- 12-13: ein reines Mannschaftsmitglied ohne eigene Abteilungsmitgliedschaft sieht trotzdem die
-- Assets seiner Abteilung (Team A haengt an Fussball) -- ein Vereinsmitglied ohne jede Rolle in
-- Abteilung oder Mannschaft dagegen nicht.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000002'), 1,
  'a team-only member without a department membership row still sees their department''s own asset');
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000009', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000002'), 0,
  'a plain organization member with no department or team role does not see a department-owned asset');

-- 14-15: dieselbe Abschottung zwischen Geschwistermannschaften.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000003'), 1,
  'the Team A wordmark is visible to the Team A manager');
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000003'), 0,
  'the Team A wordmark is invisible to the Team B manager, its sister team');

-- 16: der Abteilungsadmin sieht die Mannschafts-Assets seiner Abteilung.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.brand_assets where id = '67000000-8000-4000-8000-000000000003'), 1,
  'the Fussball department admin sees an asset owned by one of its teams');

-- 17: Mandantentrennung -- kein Mitglied des Fremdvereins sieht ein Asset dieses Vereins.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000008', true);
select is((select count(*)::integer from public.brand_assets where organization_id = '67000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no brand_assets row of this club');

-- 18-20: authz.participates_in_department -- die strikte Pruefung ohne Org-weiten Fallback.
select is(authz.participates_in_department('67000000-1100-4000-8000-000000000001'), true,
  'participates_in_department is true for a real department membership row') from (select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000004', true)) _;
select is(authz.participates_in_department('67000000-1100-4000-8000-000000000001'), true,
  'participates_in_department is true for a team-only member of a team in that department') from (select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000007', true)) _;
select is(authz.participates_in_department('67000000-1100-4000-8000-000000000001'), false,
  'participates_in_department is false for a plain organization member with no department or team role') from (select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000009', true)) _;

-- 21-23: brand.manage in has_department_permission/has_team_permission.
select is(authz.has_department_permission('67000000-1100-4000-8000-000000000001', 'brand.manage'), true,
  'the department admin has brand.manage in their own department') from (select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000002', true)) _;
select is(authz.has_department_permission('67000000-1100-4000-8000-000000000001', 'brand.manage'), false,
  'an editor does not have brand.manage') from (select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000004', true)) _;
select is(authz.has_team_permission('67000000-1200-4000-8000-000000000001', 'brand.manage'), true,
  'the team manager has brand.manage in their own team') from (select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000005', true)) _;

-- 24-27: Schreibrechte auf department_brand_profiles.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000002', true);
insert into public.department_brand_profiles (organization_id, department_id, primary_color, updated_by) values
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '#112233', '67000000-0000-4000-8000-000000000002');
select ok(true, 'the Fussball department admin can create their own department brand profile');
select throws_ok(
  format($$insert into public.department_brand_profiles (organization_id, department_id, primary_color, updated_by)
    values ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000002', '#112233', %L)$$, '67000000-0000-4000-8000-000000000002'),
  '42501', null, 'the Fussball department admin cannot write a brand profile for the Handball department'
);
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000004', true);
select throws_ok(
  format($$insert into public.department_brand_profiles (organization_id, department_id, primary_color, updated_by)
    values ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '#445566', %L)$$, '67000000-0000-4000-8000-000000000004'),
  '42501', null, 'an editor without brand.manage cannot write a department brand profile'
);
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000009', true);
select is((select count(*)::integer from public.department_brand_profiles where department_id = '67000000-1100-4000-8000-000000000001'), 1,
  'a plain organization member can read the (non-confidential) department brand profile');

-- 29-30: Schreibrechte auf team_brand_profiles.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000005', true);
insert into public.team_brand_profiles (organization_id, department_id, team_id, primary_color, updated_by) values
  ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-1200-4000-8000-000000000001', '#665544', '67000000-0000-4000-8000-000000000005');
select ok(true, 'the Team A manager can create their own team brand profile');
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000006', true);
select throws_ok(
  format($$insert into public.team_brand_profiles (organization_id, department_id, team_id, primary_color, updated_by)
    values ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', '67000000-1200-4000-8000-000000000001', '#000000', %L)$$, '67000000-0000-4000-8000-000000000006'),
  '42501', null, 'the Team B manager cannot write Team A''s brand profile'
);

-- 31: tone-CHECK gilt auch fuer department_brand_profiles (Ergaenzung gegenueber dem Plan-Entwurf).
set local role postgres;
select throws_ok(
  $$insert into public.department_brand_profiles (organization_id, department_id, tone, updated_by)
    values ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000002', 'laut', '67000000-0000-4000-8000-000000000003')$$,
  '23514', null, 'department_brand_profiles rejects a tone value outside the curated set'
);

-- 32: zusammengesetzter Fremdschluessel verhindert eine Asset-Referenz eines fremden Vereins
-- (Ergaenzung gegenueber dem Plan-Entwurf).
select throws_ok(
  format($$insert into public.department_brand_profiles (organization_id, department_id, logo_asset_id, updated_by)
    values ('67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000002', %L, '67000000-0000-4000-8000-000000000003')$$, '67000000-8000-4000-8000-000000000009'),
  '23503', null, 'department_brand_profiles cannot reference a brand asset belonging to another organization'
);

-- 33-36: Fund aus der adversarialen Pruefung -- authz.brand_asset_is_selectable() als zweite
-- Grenze in RLS selbst, nicht nur im API-Endpunkt (siehe Migrationskommentar). Ohne sie liesse
-- sich eine Schwesterabteilungs-Referenz per direktem PostgREST-Zugriff setzen, obwohl die
-- Berechtigungspruefung (brand.manage in der EIGENEN Abteilung) das nicht verhindert.
insert into public.brand_assets (id, organization_id, department_id, team_id, kind, object_path, mime_type, byte_size, sha256, status, created_by) values
  ('67000000-8000-4000-8000-000000000005', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000002', null, 'logo_mark', 'organizations/a/brand/handball-mark.png', 'image/png', 100, repeat('9', 64), 'ready', '67000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000002', true);
select throws_ok(
  format($$update public.department_brand_profiles set logo_asset_id = %L where department_id = '67000000-1100-4000-8000-000000000001'$$, '67000000-8000-4000-8000-000000000005'),
  '42501', null, 'the Fussball department admin cannot set a Handball-owned asset as their own department logo, even with brand.manage in their own department'
);
update public.department_brand_profiles set logo_asset_id = '67000000-8000-4000-8000-000000000001' where department_id = '67000000-1100-4000-8000-000000000001';
select is(
  (select logo_asset_id::text from public.department_brand_profiles where department_id = '67000000-1100-4000-8000-000000000001'),
  '67000000-8000-4000-8000-000000000001',
  'the Fussball department admin can still set the organization-wide logo as their own department logo'
);
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000005', true);
select throws_ok(
  format($$update public.team_brand_profiles set logo_asset_id = %L where team_id = '67000000-1200-4000-8000-000000000001'$$, '67000000-8000-4000-8000-000000000005'),
  '42501', null, 'the Team A manager cannot set the Handball department''s asset as their own team logo (wrong department)'
);

-- 36: organization_brand_profiles traegt die neuen Farbrollen mit den dokumentierten Defaults.
set local role postgres;
insert into public.organization_brand_profiles (organization_id) values ('67000000-1000-4000-8000-000000000001')
  on conflict (organization_id) do nothing;
select is((select background_color from public.organization_brand_profiles where organization_id = '67000000-1000-4000-8000-000000000001'), '#f6f4ec',
  'organization_brand_profiles.background_color defaults to the documented value');

select * from finish();
rollback;
