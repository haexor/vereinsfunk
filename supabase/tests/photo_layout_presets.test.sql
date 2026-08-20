begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

set local role postgres;

-- Dieselbe Konstellation wie image_style_presets.test.sql (Plan 045 PR 1): ein Verein mit zwei
-- Geschwister-Abteilungen und einer Mannschaft, weil photo_layout_presets_select/insert/update/
-- delete dieselbe Abschottung durchsetzen sollen -- kopiert statt geteilt, weil pgTAP-Testdateien
-- in diesem Repo bewusst eigenstaendig bleiben (jede Datei ihre eigene Fixture-Welt).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-photo-layout.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-photo-layout.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'handball-admin@pgtap-photo-layout.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fussball-editor@pgtap-photo-layout.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'team-a-manager@pgtap-photo-layout.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'handball-member@pgtap-photo-layout.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '49000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'plain-member@pgtap-photo-layout.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('49000000-1000-4000-8000-000000000001', 'PGTAP Bildkomposition Verein', 'pgtap-bildkomposition-verein'),
  ('49000000-1000-4000-8000-000000000002', 'PGTAP Bildkomposition Fremdverein', 'pgtap-bildkomposition-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('49000000-1100-4000-8000-000000000001', '49000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('49000000-1100-4000-8000-000000000002', '49000000-1000-4000-8000-000000000001', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('49000000-1200-4000-8000-000000000001', '49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', 'Team A');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('49000000-1000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('49000000-1000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000007', 'organization_viewer'),
  ('49000000-1000-4000-8000-000000000002', '49000000-0000-4000-8000-000000000001', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', '49000000-0000-4000-8000-000000000002', 'department_admin'),
  ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000002', '49000000-0000-4000-8000-000000000003', 'department_admin'),
  ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', '49000000-0000-4000-8000-000000000004', 'editor'),
  ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000002', '49000000-0000-4000-8000-000000000006', 'viewer');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', '49000000-1200-4000-8000-000000000001', '49000000-0000-4000-8000-000000000005', 'team_manager');

-- 1: RLS ist erzwungen, auch fuer den Tabelleneigentuemer.
select is((select relforcerowsecurity from pg_class where oid = 'public.photo_layout_presets'::regclass), true, 'photo_layout_presets has FORCE ROW LEVEL SECURITY enabled');

set local role authenticated;

-- 2: ein Abteilungsadmin legt ein Abteilungs-Preset an -- erlaubt.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$insert into public.photo_layout_presets (id, organization_id, department_id, name, kind, created_by)
    values ('49000000-9000-4000-8000-000000000001', '49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', 'Fußball Diagonal', 'diagonal_split', '49000000-0000-4000-8000-000000000002')$$,
  'a department_admin can create a department-scoped preset'
);

-- 3: eine Abteilungsleitung einer ANDEREN Abteilung darf kein Fussball-Preset anlegen.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$insert into public.photo_layout_presets (organization_id, department_id, name, kind, created_by)
    values ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', 'Fremdversuch', 'grid_2x2', '49000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'the handball department_admin cannot create a preset scoped to the fussball department'
);

-- 4: ein Editor (kein brand.manage) darf in der eigenen Abteilung kein Preset anlegen.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$insert into public.photo_layout_presets (organization_id, department_id, name, kind, created_by)
    values ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', 'Editor-Versuch', 'grid_2x2', '49000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'a department editor without brand.manage cannot create a preset'
);

-- 5-6: divider_color/team_id-CHECK-Constraints -- zurueck auf den Fussball-Abteilungsadmin
-- (brand.manage, created_by passt zu auth.uid()), sonst schlaegt schon die RLS-INSERT-Policy zu
-- (created_by = auth.uid()) und die CHECK-Constraint selbst wird nie erreicht -- genau das ist beim
-- Bauen dieses Tests passiert (Rest-Sub aus Test 4 stand noch auf dem Editor ohne brand.manage).
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000002', true);

-- 5: divider_color akzeptiert weder eine ungueltige Hex-Farbe noch eine unbekannte Rolle.
select throws_ok(
  $$insert into public.photo_layout_presets (organization_id, department_id, name, kind, divider_color, created_by)
    values ('49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', 'Ungueltige Farbe', 'grid_2x2', 'not-a-color', '49000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'an invalid divider_color value violates the CHECK constraint'
);

-- 6: team_id ohne department_id verletzt die CHECK-Constraint.
select throws_ok(
  $$insert into public.photo_layout_presets (organization_id, team_id, name, kind, created_by)
    values ('49000000-1000-4000-8000-000000000001', '49000000-1200-4000-8000-000000000001', 'Ohne Abteilung', 'grid_2x2', '49000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'a team_id without a department_id violates the CHECK constraint'
);

-- 7: eine Team-Managerin von Team A darf ein Team-Preset anlegen (brand.manage gehoert zu team_manager).
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$insert into public.photo_layout_presets (id, organization_id, department_id, team_id, name, kind, created_by)
    values ('49000000-9000-4000-8000-000000000002', '49000000-1000-4000-8000-000000000001', '49000000-1100-4000-8000-000000000001', '49000000-1200-4000-8000-000000000001', 'Team A Preset', 'mixed_grid', '49000000-0000-4000-8000-000000000005')$$,
  'a team_manager can create a preset scoped to their own team'
);

-- 8-9: Sichtbarkeit -- ein Handball-Mitglied sieht das Fussball-Preset nicht, der Vereinsadmin schon.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000001'), 0, 'a handball member cannot see the fussball-scoped preset');
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000001'), 1, 'the organization_admin can see every department''s preset');

-- 10: ein Vereinsmitglied ohne jede Abteilungs-/Mannschaftsrolle sieht das Fussball-Preset nicht.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000001'), 0, 'a plain organization member without any department role cannot see the fussball-scoped preset');

-- 11-12: der Fussball-Abteilungsadmin kann das eigene Preset aktualisieren.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$update public.photo_layout_presets set name = 'Fußball Diagonal (aktualisiert)', divider_width_px = 12 where id = '49000000-9000-4000-8000-000000000001'$$,
  'the fussball department_admin can update their own department''s preset'
);
select is((select name from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000001'), 'Fußball Diagonal (aktualisiert)', 'the update took effect');

-- 13: created_by ist unveraenderlich.
select throws_ok(
  $$update public.photo_layout_presets set created_by = '49000000-0000-4000-8000-000000000004' where id = '49000000-9000-4000-8000-000000000001'$$,
  'P0001', 'photo layout preset created_by is immutable', 'created_by cannot be changed by any update'
);

-- 14: ein Abteilungsadmin darf kein vereinsweites Preset anlegen (fehlt organization.manage).
select throws_ok(
  $$insert into public.photo_layout_presets (organization_id, name, kind, created_by) values ('49000000-1000-4000-8000-000000000001', 'Vereinsweit', 'grid_2x2', '49000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a department_admin cannot create an organization-wide preset'
);

-- 15: Cross-Tenant -- derselbe Nutzer sieht als Fremdverein-Admin nichts von diesem Verein.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.photo_layout_presets where organization_id = '49000000-1000-4000-8000-000000000002'), 0, 'no photo_layout_presets row exists for the foreign organization');

-- 16-17: der Fussball-Abteilungsadmin kann das eigene Preset loeschen.
select set_config('request.jwt.claim.sub', '49000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$delete from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000001'$$,
  'the fussball department_admin can delete their own department''s preset'
);
select is((select count(*)::integer from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000001'), 0, 'the deleted preset is gone');

-- 18-19: die Ebene der Loeschsperre kaskadiert ueber die Abteilung.
set local role postgres;
select is((select count(*)::integer from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000002'), 1, 'the team-scoped preset still exists before its department is deleted');
delete from public.departments where id = '49000000-1100-4000-8000-000000000001';
select is((select count(*)::integer from public.photo_layout_presets where id = '49000000-9000-4000-8000-000000000002'), 0, 'deleting the department cascades to its team-scoped photo layout preset');

select * from finish();
rollback;
