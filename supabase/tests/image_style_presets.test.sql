begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

set local role postgres;

-- Ein Verein mit zwei Geschwister-Abteilungen (Fussball, Handball) und zwei Geschwister-
-- Mannschaften innerhalb von Fussball (Team A, Team B) -- dieselbe Konstellation wie
-- brand_assets_and_fonts.test.sql, weil image_style_presets_select/insert/update/delete
-- dieselbe Abschottung durchsetzen sollen. Ein zweiter Verein fuer die Mandantentrennung.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-image-style.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-image-style.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'handball-admin@pgtap-image-style.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fussball-editor@pgtap-image-style.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'team-a-manager@pgtap-image-style.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'handball-member@pgtap-image-style.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '48000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'plain-member@pgtap-image-style.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('48000000-1000-4000-8000-000000000001', 'PGTAP Bildstil Verein', 'pgtap-bildstil-verein'),
  ('48000000-1000-4000-8000-000000000002', 'PGTAP Bildstil Fremdverein', 'pgtap-bildstil-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('48000000-1100-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('48000000-1100-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('48000000-1200-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Team A');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('48000000-1000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('48000000-1000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000007', 'organization_viewer'),
  -- Fuer den Cross-Tenant-Sichtbarkeitstest unten: dieselbe Person ist auch im Fremdverein
  -- organization_admin, damit die Negativpruefung wirklich RLS testet, nicht bloss fehlende
  -- Mitgliedschaft. Unter postgres eingefuegt (Setup, nicht die zu pruefende Aktion).
  ('48000000-1000-4000-8000-000000000002', '48000000-0000-4000-8000-000000000001', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', '48000000-0000-4000-8000-000000000002', 'department_admin'),
  ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000002', '48000000-0000-4000-8000-000000000003', 'department_admin'),
  ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', '48000000-0000-4000-8000-000000000004', 'editor'),
  ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000002', '48000000-0000-4000-8000-000000000006', 'viewer');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', '48000000-1200-4000-8000-000000000001', '48000000-0000-4000-8000-000000000005', 'team_manager');

-- Brand-Assets als Referenzziele: ein vereinsweites 'frame' und 'watermark' (beide ready), ein
-- Fussball-Abteilungs-'frame', ein Handball-Abteilungs-'frame' (fuer den Cross-Department-Test),
-- und ein 'logo_primary' (falscher kind, fuer den typisierten-FK-Test).
insert into public.brand_assets (id, organization_id, department_id, kind, object_path, mime_type, byte_size, sha256, status, created_by) values
  ('48000000-8000-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', null, 'frame', 'organizations/x/brand/org-frame.png', 'image/png', 100, repeat('a', 64), 'ready', '48000000-0000-4000-8000-000000000001'),
  ('48000000-8000-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', null, 'watermark', 'organizations/x/brand/org-watermark.png', 'image/png', 100, repeat('b', 64), 'ready', '48000000-0000-4000-8000-000000000001'),
  ('48000000-8000-4000-8000-000000000003', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'frame', 'organizations/x/brand/fussball-frame.png', 'image/png', 100, repeat('c', 64), 'ready', '48000000-0000-4000-8000-000000000002'),
  ('48000000-8000-4000-8000-000000000004', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000002', 'frame', 'organizations/x/brand/handball-frame.png', 'image/png', 100, repeat('d', 64), 'ready', '48000000-0000-4000-8000-000000000003'),
  ('48000000-8000-4000-8000-000000000005', '48000000-1000-4000-8000-000000000001', null, 'logo_primary', 'organizations/x/brand/org-logo.png', 'image/png', 100, repeat('e', 64), 'ready', '48000000-0000-4000-8000-000000000001');

-- 1: RLS ist erzwungen, auch fuer den Tabelleneigentuemer.
select is((select relforcerowsecurity from pg_class where oid = 'public.image_style_presets'::regclass), true, 'image_style_presets has FORCE ROW LEVEL SECURITY enabled');

set local role authenticated;

-- 2: ein Abteilungsadmin legt ein Abteilungs-Preset mit dem vereinsweiten Rahmen an -- erlaubt.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$insert into public.image_style_presets (id, organization_id, department_id, name, frame_type, frame_color, frame_width_px, frame_brand_asset_id, created_by)
    values ('48000000-9000-4000-8000-000000000001', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Fußball Rahmen', 'custom', null, null, '48000000-8000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000002')$$,
  'a department_admin can create a department-scoped preset referencing the organization-wide frame asset'
);

-- 3: eine Abteilungsleitung einer ANDEREN Abteilung darf kein Fussball-Preset anlegen.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$insert into public.image_style_presets (organization_id, department_id, name, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Fremdversuch', '48000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'the handball department_admin cannot create a preset scoped to the fussball department'
);

-- 4: ein Editor (kein brand.manage) darf in der eigenen Abteilung kein Preset anlegen.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$insert into public.image_style_presets (organization_id, department_id, name, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Editor-Versuch', '48000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'a department editor without brand.manage cannot create a preset'
);

-- 5: Cross-Department-Leck -- ein Fussball-Preset darf keinen Handball-Rahmen referenzieren.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.image_style_presets (organization_id, department_id, name, frame_type, frame_brand_asset_id, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Cross-Dept', 'custom', '48000000-8000-4000-8000-000000000004', '48000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a fussball-scoped preset cannot reference a handball-scoped frame asset'
);

-- 6: der typisierte Fremdschluessel akzeptiert nur kind='frame' fuer frame_brand_asset_id -- ein
-- vorhandenes, waehlbares 'logo_primary'-Asset erzeugt keinen Treffer und verletzt die FK selbst.
select throws_ok(
  $$insert into public.image_style_presets (organization_id, department_id, name, frame_type, frame_brand_asset_id, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Falscher Kind', 'custom', '48000000-8000-4000-8000-000000000005', '48000000-0000-4000-8000-000000000002')$$,
  '23503', null, 'frame_brand_asset_id rejects an asset whose kind is not frame via the typed composite foreign key'
);

-- 7: ein paramterischer Rahmen ohne Farbe/Breite verletzt die CHECK-Constraint.
select throws_ok(
  $$insert into public.image_style_presets (organization_id, department_id, name, frame_type, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Unvollstaendig', 'parametric', '48000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'a parametric frame without frameColor and frameWidthPx violates the CHECK constraint'
);

-- 8: logo_enabled ohne vollstaendiges Logo-Feldtrio verletzt die CHECK-Constraint.
select throws_ok(
  $$insert into public.image_style_presets (organization_id, department_id, name, logo_enabled, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', 'Unvollstaendiges Logo', true, '48000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'logo_enabled without the full logo field set violates the CHECK constraint'
);

-- 9: team_id ohne department_id verletzt die CHECK-Constraint.
select throws_ok(
  $$insert into public.image_style_presets (organization_id, team_id, name, created_by)
    values ('48000000-1000-4000-8000-000000000001', '48000000-1200-4000-8000-000000000001', 'Ohne Abteilung', '48000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'a team_id without a department_id violates the CHECK constraint'
);

-- 10: eine Team-Managerin von Team A darf ein Team-Preset anlegen (brand.manage gehoert zu
-- team_manager, siehe 2026080702_brand_assets_and_fonts.sql).
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$insert into public.image_style_presets (id, organization_id, department_id, team_id, name, created_by)
    values ('48000000-9000-4000-8000-000000000002', '48000000-1000-4000-8000-000000000001', '48000000-1100-4000-8000-000000000001', '48000000-1200-4000-8000-000000000001', 'Team A Preset', '48000000-0000-4000-8000-000000000005')$$,
  'a team_manager can create a preset scoped to their own team'
);

-- 11-12: Sichtbarkeit -- ein vereinsweites Preset (keins bislang angelegt) waere fuer jedes
-- Mitglied sichtbar; das Fussball-Preset ist fuer ein Handball-Mitglied unsichtbar (negativ),
-- aber fuer den Vereinsadmin sichtbar (Aufsicht von oben).
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.image_style_presets where id = '48000000-9000-4000-8000-000000000001'), 0, 'a handball member cannot see the fussball-scoped preset');
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.image_style_presets where id = '48000000-9000-4000-8000-000000000001'), 1, 'the organization_admin can see every department''s preset');

-- 13: ein Vereinsmitglied ohne jede Abteilungs-/Mannschaftsrolle sieht das Fussball-Preset nicht.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.image_style_presets where id = '48000000-9000-4000-8000-000000000001'), 0, 'a plain organization member without any department role cannot see the fussball-scoped preset');

-- 14: der Fussball-Abteilungsadmin kann das eigene Preset aktualisieren.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$update public.image_style_presets set name = 'Fußball Rahmen (aktualisiert)', filter = 'warm' where id = '48000000-9000-4000-8000-000000000001'$$,
  'the fussball department_admin can update their own department''s preset'
);
select is((select name from public.image_style_presets where id = '48000000-9000-4000-8000-000000000001'), 'Fußball Rahmen (aktualisiert)', 'the update took effect');

-- 15: derselbe Abteilungsadmin darf das Preset NICHT auf den Handball-Rahmen umstellen -- selbst
-- mit gueltigem brand.manage auf der EIGENEN Abteilung darf die Waehlbarkeits-Pruefung
-- (authz.brand_asset_is_selectable) nicht durch fehlende Klammerung im OR/AND der WITH-CHECK-
-- Klausel umgangen werden (siehe die Klammerkorrektur in image_style_presets_update beim Bauen).
select throws_ok(
  $$update public.image_style_presets set frame_type = 'custom', frame_brand_asset_id = '48000000-8000-4000-8000-000000000004' where id = '48000000-9000-4000-8000-000000000001'$$,
  '42501', null, 'updating the frame reference to a sibling department''s asset is rejected even though the caller has brand.manage on their own department'
);

-- 16: created_by ist unveraenderlich -- selbst der berechtigte Abteilungsadmin kann es nicht auf
-- eine andere Person umbiegen (Migration 2026081917).
select throws_ok(
  $$update public.image_style_presets set created_by = '48000000-0000-4000-8000-000000000004' where id = '48000000-9000-4000-8000-000000000001'$$,
  'P0001', 'image style preset created_by is immutable', 'created_by cannot be changed by any update, even by someone with brand.manage'
);

-- 17: ein Abteilungsadmin darf kein vereinsweites Preset bearbeiten (fehlt organization.manage).
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.image_style_presets (organization_id, name, created_by) values ('48000000-1000-4000-8000-000000000001', 'Vereinsweit', '48000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a department_admin cannot create an organization-wide preset'
);

-- 18: Cross-Tenant -- derselbe Nutzer sieht als Fremdverein-Admin nichts von diesem Verein.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.image_style_presets where organization_id = '48000000-1000-4000-8000-000000000002'), 0, 'no image_style_presets row exists for the foreign organization');

-- 19: der Fussball-Abteilungsadmin kann das eigene Preset loeschen.
select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$delete from public.image_style_presets where id = '48000000-9000-4000-8000-000000000001'$$,
  'the fussball department_admin can delete their own department''s preset'
);
select is((select count(*)::integer from public.image_style_presets where id = '48000000-9000-4000-8000-000000000001'), 0, 'the deleted preset is gone');

-- 20-21: die Ebene der Loeschsperre (kaskadierend ueber die Abteilung) -- unter postgres, um die
-- Kaskade selbst zu pruefen, unabhaengig von RLS.
set local role postgres;
select is((select count(*)::integer from public.image_style_presets where id = '48000000-9000-4000-8000-000000000002'), 1, 'the team-scoped preset still exists before its department is deleted');
delete from public.departments where id = '48000000-1100-4000-8000-000000000001';
select is((select count(*)::integer from public.image_style_presets where id = '48000000-9000-4000-8000-000000000002'), 0, 'deleting the department cascades to its team-scoped image style preset');

select * from finish();
rollback;
