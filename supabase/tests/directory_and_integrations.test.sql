begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

set local role postgres;

-- Ein Verein mit zwei Geschwister-Abteilungen (Fussball, Handball) und einer Mannschaft (Team A)
-- innerhalb von Fussball -- dieselbe Abschottungskonstellation wie in
-- brand_assets_and_fonts.test.sql. Ein zweiter Verein fuer die Mandantentrennung.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'handball-admin@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fussball-editor@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'team-a-manager@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'fussball-contributor@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-directory.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'plain-viewer@pgtap-directory.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('68000000-1000-4000-8000-000000000001', 'PGTAP Directory Verein', 'pgtap-directory-verein'),
  ('68000000-1000-4000-8000-000000000002', 'PGTAP Directory Fremdverein', 'pgtap-directory-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('68000000-1100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('68000000-1100-4000-8000-000000000002', '68000000-1000-4000-8000-000000000001', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('68000000-1200-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Team A');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000008', 'organization_viewer'),
  ('68000000-1000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000007', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'department_admin'),
  ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'department_admin'),
  ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000004', 'editor'),
  ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000006', 'contributor');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-1200-4000-8000-000000000001', '68000000-0000-4000-8000-000000000005', 'team_manager');

-- 1: enabled_domains darf nicht leer sein -- array_length('{}',1) ist NULL und wuerde einen
-- CHECK mit array_length lautlos umgehen, cardinality() nicht.
select throws_ok(
  $$insert into public.integration_sources (organization_id, transport, provider_key, display_name, enabled_domains, created_by)
    values ('68000000-1000-4000-8000-000000000001', 'file', 'csv', 'Leer', '{}', '68000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'integration_sources rejects an empty enabled_domains array'
);

insert into public.integration_sources (id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, credentials_secret_id, created_by) values
  ('68000000-2000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', 'file', 'csv', 'CSV Import Fussball', array['people']::public.integration_domain[], '68000000-1100-4000-8000-000000000001', gen_random_uuid(), '68000000-0000-4000-8000-000000000001');
insert into public.integration_sources (id, organization_id, transport, provider_key, display_name, enabled_domains, endpoint_url, created_by) values
  ('68000000-2000-4000-8000-000000000002', '68000000-1000-4000-8000-000000000001', 'ical', 'ical', 'Spielplan-Feed', array['fixtures']::public.integration_domain[], 'https://example.invalid/feed.ics', '68000000-0000-4000-8000-000000000001');
insert into public.integration_sources (id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, created_by) values
  ('68000000-2000-4000-8000-000000000003', '68000000-1000-4000-8000-000000000001', 'file', 'csv', 'CSV Import Handball', array['people']::public.integration_domain[], '68000000-1100-4000-8000-000000000002', '68000000-0000-4000-8000-000000000001');
insert into public.integration_sources (id, organization_id, transport, provider_key, display_name, enabled_domains, created_by) values
  ('68000000-2000-4000-8000-000000000009', '68000000-1000-4000-8000-000000000002', 'file', 'csv', 'Fremdverein-Import', array['people']::public.integration_domain[], '68000000-0000-4000-8000-000000000007');

-- 2: eine aktive minderjaehrige Person braucht einen Elternkontakt.
select throws_ok(
  $$insert into public.directory_people (organization_id, department_id, first_name, last_name, is_minor, status)
    values ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Ohne', 'Kontakt', true, 'active')$$,
  '23514', null, 'an active minor without a guardian_email violates the CHECK constraint'
);

insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status, guardian_name, guardian_email) values
  ('68000000-3000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Mia', 'Muster', true, 'active', 'Erika Muster', 'eltern@example.com');
select ok(true, 'an active minor with a guardian_email can be created');

insert into public.directory_people (id, organization_id, department_id, team_id, first_name, last_name, is_minor, status) values
  ('68000000-3000-4000-8000-000000000002', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-1200-4000-8000-000000000001', 'Team', 'A-Spieler', false, 'active');
insert into public.directory_people (id, organization_id, first_name, last_name, is_minor, status) values
  ('68000000-3000-4000-8000-000000000003', '68000000-1000-4000-8000-000000000001', 'Vereins', 'Ebene', false, 'active');
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status) values
  ('68000000-3000-4000-8000-000000000004', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000002', 'Handball', 'Spielerin', false, 'active');
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status, source_id, external_id, source_updated_at) values
  ('68000000-3000-4000-8000-000000000006', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Sync', 'Import', false, 'active', '68000000-2000-4000-8000-000000000001', 'ext-1', now());
-- 3: fast volljaehrig -- Geburtsjahr so gewaehlt, dass die Person laut der 2026-08-07 getroffenen
-- Entscheidung (ganzes Jahr des 18. Geburtstags gilt noch als minderjaehrig) inzwischen erwachsen
-- sein muesste.
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, birth_year, is_minor, status, guardian_name, guardian_email) values
  ('68000000-3000-4000-8000-000000000005', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Fast', 'Volljaehrig', extract(year from now())::int - 19, true, 'active', 'Elternteil', 'fast-volljaehrig@example.com');
insert into public.directory_people (id, organization_id, first_name, last_name, is_minor, status) values
  ('68000000-3000-4000-8000-000000000009', '68000000-1000-4000-8000-000000000002', 'Fremd', 'Verein', false, 'active');

-- 4: eindeutiger Wiedererkennungsschluessel je Quelle -- ein zweiter Datensatz mit derselben
-- (organization_id, source_id, external_id) ist ein Konflikt, keine stille Dublette.
select throws_ok(
  $$insert into public.directory_people (organization_id, department_id, first_name, last_name, is_minor, status, source_id, external_id)
    values ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Zweite', 'Zeile', false, 'active', '68000000-2000-4000-8000-000000000001', 'ext-1')$$,
  '23505', null, 'the same (organization_id, source_id, external_id) cannot be inserted twice'
);

-- 5-8: RLS ist auf allen vier neuen Tabellen erzwungen, auch fuer den Tabelleneigentuemer.
select is((select relforcerowsecurity from pg_class where oid = 'public.integration_sources'::regclass), true, 'integration_sources has FORCE ROW LEVEL SECURITY enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.integration_sync_runs'::regclass), true, 'integration_sync_runs has FORCE ROW LEVEL SECURITY enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.integration_sync_conflicts'::regclass), true, 'integration_sync_conflicts has FORCE ROW LEVEL SECURITY enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.directory_people'::regclass), true, 'directory_people has FORCE ROW LEVEL SECURITY enabled');

-- 9-10: kein Schreibpfad fuer authenticated -- nur die API mit Service Role, analog invitations/
-- consent_records/brand_assets.
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.integration_sources (organization_id, transport, provider_key, display_name, enabled_domains, created_by)
    values ('68000000-1000-4000-8000-000000000001', 'file', 'csv', 'x', array['people']::public.integration_domain[], '68000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot insert into integration_sources even with integration.manage'
);
select throws_ok(
  $$insert into public.directory_people (organization_id, first_name, last_name)
    values ('68000000-1000-4000-8000-000000000001', 'x', 'y')$$,
  '42501', null, 'authenticated cannot insert into directory_people even with directory.read'
);

-- 11-12: Spaltenrechte -- credentials_secret_id und guardian_email sind nicht Teil des
-- Standard-Grants, unabhaengig von der Berechtigung auf der Zeile selbst.
select throws_ok(
  $$select credentials_secret_id from public.integration_sources where id = '68000000-2000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot select credentials_secret_id even as the organization admin'
);
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select guardian_email from public.directory_people where id = '68000000-3000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot select guardian_email even as the department admin with department.manage'
);

-- 13-16: Sichtbarkeit von integration_sources -- Abteilungsscope, Aufsicht von oben,
-- Mandantentrennung.
select is((select count(*)::integer from public.integration_sources where id = '68000000-2000-4000-8000-000000000001'), 1,
  'the Fussball department admin sees their own department-scoped source');
select is((select count(*)::integer from public.integration_sources where id = '68000000-2000-4000-8000-000000000003'), 0,
  'the Fussball department admin does not see the Handball-scoped source');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.integration_sources where organization_id = '68000000-1000-4000-8000-000000000001'), 3,
  'the organization admin sees all three sources of their own club, department-scoped or not');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.integration_sources where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s sources');

-- 17-18: authz.can_manage_integration_source als security-definer-Huelle -- direkt geprueft, nicht
-- nur ueber die Policy, die sie benutzt.
select is(authz.can_manage_integration_source('68000000-2000-4000-8000-000000000001'), true,
  'can_manage_integration_source is true for the Fussball admin on the Fussball-scoped source') from (select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true)) _;
select is(authz.can_manage_integration_source('68000000-2000-4000-8000-000000000003'), false,
  'can_manage_integration_source is false for the Fussball admin on the Handball-scoped source') from (select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true)) _;

-- 19-24: Sichtbarkeit von directory_people -- nicht jedes Mitglied, sondern gezielt
-- department_admin/team_manager der zugeordneten Einheit plus organization_admin/-owner.
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.directory_people where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'an editor without directory.read sees no directory row at all');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.directory_people where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'a contributor without directory.read sees no directory row at all');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.directory_people where department_id = '68000000-1100-4000-8000-000000000001'), 4,
  'the Fussball department admin sees every Fussball-scoped person, including the one also assigned to Team A');
select is((select count(*)::integer from public.directory_people where id = '68000000-3000-4000-8000-000000000004'), 0,
  'the Fussball department admin does not see the Handball-scoped person');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.directory_people where id = '68000000-3000-4000-8000-000000000002'), 1,
  'the Team A manager sees the person assigned to their own team');
select is((select count(*)::integer from public.directory_people where id = '68000000-3000-4000-8000-000000000001'), 0,
  'the Team A manager does not see a Fussball-scoped person who is not on their team (no department-level role)');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.directory_people where organization_id = '68000000-1000-4000-8000-000000000001'), 6,
  'the organization admin sees every person of their club, department-scoped, team-scoped, or organization-only');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000008', true);
select is((select count(*)::integer from public.directory_people where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'a plain organization_viewer without directory.read sees no directory row');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.directory_people where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s directory rows');

-- 25-27: directory.read/integration.manage in has_department_permission/has_team_permission --
-- direkt geprueft, nicht nur ueber die Policies, die sie benutzen.
select is(authz.has_department_permission('68000000-1100-4000-8000-000000000001', 'directory.read'), true,
  'the department admin has directory.read in their own department') from (select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true)) _;
select is(authz.has_department_permission('68000000-1100-4000-8000-000000000001', 'directory.read'), false,
  'an editor does not have directory.read') from (select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000004', true)) _;
select is(authz.has_team_permission('68000000-1200-4000-8000-000000000001', 'integration.manage'), false,
  'a team_manager does not have integration.manage -- integration_sources has no team scope') from (select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000005', true)) _;

-- 28-30: Loeschverhalten -- die SET-NULL-Spaltenlisten sind gezielt, nicht pauschal.
set local role postgres;
delete from public.teams where id = '68000000-1200-4000-8000-000000000001';
select is(
  (select row(department_id, team_id, organization_id) from public.directory_people where id = '68000000-3000-4000-8000-000000000002'),
  row('68000000-1100-4000-8000-000000000001'::uuid, null::uuid, '68000000-1000-4000-8000-000000000001'::uuid),
  'deleting the team sets only team_id to null, department_id and organization_id survive'
);
delete from public.departments where id = '68000000-1100-4000-8000-000000000002';
select is(
  (select row(department_id, team_id, organization_id) from public.directory_people where id = '68000000-3000-4000-8000-000000000004'),
  row(null::uuid, null::uuid, '68000000-1000-4000-8000-000000000001'::uuid),
  'deleting the department sets department_id (and the already-null team_id) to null, organization_id survives'
);
delete from public.integration_sources where id = '68000000-2000-4000-8000-000000000001';
select is(
  (select row(source_id, external_id) from public.directory_people where id = '68000000-3000-4000-8000-000000000006'),
  row(null::uuid, 'ext-1'::text),
  'deleting the source sets only source_id to null -- external_id survives as history'
);

-- 31: consent_records mit Verweis auf eine Person ueberlebt deren Loeschung als Nachweis -- Paket
-- 020 (Betroffenenrecht auf Loeschung) braucht genau das: die Verzeichnisperson verschwindet, der
-- Einwilligungsnachweis bleibt bestehen, nur die identifizierende Verknuepfung wird null (vormals
-- "on delete restrict", was jede Loeschanfrage einer Person mit Einwilligungshistorie blockiert
-- haette -- gerade der Hauptfall, Minderjaehrige mit Medien).
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status) values
  ('68000000-3000-4000-8000-000000000007', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'Zu', 'Loeschen', false, 'active');
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, evidence_path, created_by) values
  ('68000000-5000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-3000-4000-8000-000000000007', 'directory-linked-consent', 'Team-Foto', 'organizations/x/consent/erasure.pdf', '68000000-0000-4000-8000-000000000001');
delete from public.directory_people where id = '68000000-3000-4000-8000-000000000007';
select ok(true, 'a directory person referenced by a consent record can now be deleted (erasure right)');
select is((select directory_person_id from public.consent_records where id = '68000000-5000-4000-8000-000000000001'), null,
  'deleting the directory person nulls the identifying link on the surviving consent evidence row');

-- 32-33: Konfliktschluessel -- derselbe fingerprint fuer dieselbe Quelle mit
-- ignore_permanently kann nicht zweimal angelegt werden.
insert into public.integration_sync_runs (id, organization_id, source_id, domain, mode, correlation_id) values
  ('68000000-4000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'apply', gen_random_uuid());
insert into public.integration_sync_conflicts (organization_id, sync_run_id, source_id, domain, label, field, kind, fingerprint, resolution) values
  ('68000000-1000-4000-8000-000000000001', '68000000-4000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'Doppelter Vorname', 'lastName', 'ambiguous_match', 'fp-1', 'ignore_permanently');
select ok(true, 'a conflict can be marked ignore_permanently');
select throws_ok(
  $$insert into public.integration_sync_conflicts (organization_id, sync_run_id, source_id, domain, label, field, kind, fingerprint, resolution)
    values ('68000000-1000-4000-8000-000000000001', '68000000-4000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'Erneut', 'lastName', 'ambiguous_match', 'fp-1', 'ignore_permanently')$$,
  '23505', null, 'the same fingerprint cannot be ignored twice for the same source'
);

-- 34-36: taeglicher Minderjaehrigkeits-Abgleich -- nur die Richtung minderjaehrig -> volljaehrig,
-- nur mit gesetztem Geburtsjahr.
select public.recompute_directory_minor_status();
select is((select is_minor from public.directory_people where id = '68000000-3000-4000-8000-000000000005'), false,
  'recompute_directory_minor_status flips is_minor to false once the year of the 18th birthday has passed');
select isnt((select became_adult_at from public.directory_people where id = '68000000-3000-4000-8000-000000000005'), null,
  'recompute_directory_minor_status records when the transition happened');
select is((select is_minor from public.directory_people where id = '68000000-3000-4000-8000-000000000001'), true,
  'recompute_directory_minor_status leaves a manually-set minor without a birth_year untouched');

-- 37: der Uebergang wird auditiert.
select is((select count(*)::integer from public.audit_events where action = 'directory_person.became_adult' and entity_id = '68000000-3000-4000-8000-000000000005'), 1,
  'the transition to adulthood is recorded as an audit event');

-- 38-41: Mandantentrennung fuer Laeufe und Konflikte. Bisher pruefte die Datei fuer diese beiden
-- Tabellen nur relforcerowsecurity -- dass die Policy tatsaechlich trennt, war ungetestet. Beide
-- haengen ueber authz.can_manage_integration_source an der Quelle: wer die Quelle verwalten darf,
-- sieht ihre Laeufe und Konflikte, sonst niemand. Die Zeilen oben gehoeren zur Quelle
-- 68000000-2000-4000-8000-000000000002 (vereinsweit, ohne Abteilungsbindung).
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.integration_sync_runs where id = '68000000-4000-4000-8000-000000000001'), 1,
  'the own organization_admin sees a sync run of a source they may manage');
select is((select count(*)::integer from public.integration_sync_conflicts where sync_run_id = '68000000-4000-4000-8000-000000000001'), 1,
  'the own organization_admin sees the conflicts of that run');

select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.integration_sync_runs where id = '68000000-4000-4000-8000-000000000001'), 0,
  'an admin of a different organization sees no sync run of this one');
select is((select count(*)::integer from public.integration_sync_conflicts where sync_run_id = '68000000-4000-4000-8000-000000000001'), 0,
  'an admin of a different organization sees none of its conflicts');

-- 42-50: Paket 026 -- der Guard ist eine Service-Role-RPC. Wiederholung desselben Schluessels
-- liefert exakt dieselbe Run-Zeile; ein anderer Apply-Lauf derselben Quelle/Domaene bekommt keinen
-- zweiten Slot. Dry-Runs duerfen parallel bleiben, da sie keine Fachdaten schreiben.
set local role postgres;
-- Der fruehere Konflikt-Test hat auf dieser Quelle bewusst einen laufenden Beispiel-Run angelegt.
-- Fuer die unabhaengigen Guard-Faelle wird er sauber abgeschlossen.
update public.integration_sync_runs set status = 'succeeded', finished_at = now()
  where id = '68000000-4000-4000-8000-000000000001';
select is(
  (select result from public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'apply',
    'p026-apply-a', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )),
  'acquired', 'the first apply request atomically acquires its source/domain slot'
);
select is(
  (select result from public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'apply',
    'p026-apply-a', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )),
  'replay', 'the same idempotency key returns the existing run'
);
select is(
  (select count(*)::integer from public.integration_sync_runs
    where source_id = '68000000-2000-4000-8000-000000000002' and domain = 'people' and request_idempotency_key = 'p026-apply-a'),
  1, 'a replay never creates a second sync-run row'
);
select is(
  (select result from public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'apply',
    'p026-apply-b', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )),
  'already_running', 'a different apply key cannot run alongside the active apply'
);
select is(
  (select result from public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'teams', 'apply',
    'p026-other-domain', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )),
  'acquired', 'a different domain of the same source remains independently runnable'
);
select is(
  (select result from public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'events', 'dry_run',
    'p026-dry-a', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )),
  'acquired', 'the first dry-run is acquired'
);
select is(
  (select result from public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'events', 'dry_run',
    'p026-dry-b', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )),
  'acquired', 'a second dry-run may proceed in parallel because it writes no domain rows'
);
select throws_ok(
  $$select public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000002', '68000000-2000-4000-8000-000000000002', 'people', 'apply',
    'p026-cross-tenant', gen_random_uuid(), '68000000-0000-4000-8000-000000000007'
  )$$,
  'P0002', null, 'the guard rejects a source paired with a foreign organization id'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.acquire_integration_sync_run(
    '68000000-1000-4000-8000-000000000001', '68000000-2000-4000-8000-000000000002', 'people', 'apply',
    'p026-no-direct-rpc', gen_random_uuid(), '68000000-0000-4000-8000-000000000001'
  )$$,
  '42501', null, 'authenticated cannot invoke the privileged sync-run guard directly'
);

select * from finish();
rollback;
