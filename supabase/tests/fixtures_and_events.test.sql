begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

set local role postgres;

-- Ein Verein mit zwei Geschwister-Abteilungen (Fussball, Handball) und einer Mannschaft (Team A)
-- unter Fussball, plus ein Fremdverein fuer die Mandantentrennung -- dieselbe Grundkonstellation
-- wie in directory_and_integrations.test.sql, aber mit frischem UUID-Praefix (69000000...), damit
-- beide Testdateien in derselben Datenbank ohne Kollision auf Primaer- oder Unique-Schluesseln
-- laufen koennen.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-fixtures.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fussball-admin@pgtap-fixtures.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'handball-admin@pgtap-fixtures.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'team-a-manager@pgtap-fixtures.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'fussball-editor@pgtap-fixtures.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-fixtures.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '69000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'plain-viewer@pgtap-fixtures.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('69000000-1000-4000-8000-000000000001', 'PGTAP Fixtures Verein', 'pgtap-fixtures-verein'),
  ('69000000-1000-4000-8000-000000000002', 'PGTAP Fixtures Fremdverein', 'pgtap-fixtures-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('69000000-1100-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('69000000-1100-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', 'Handball', 'handball'),
  ('69000000-1100-4000-8000-000000000003', '69000000-1000-4000-8000-000000000002', 'Fremdabteilung', 'fremdabteilung');
insert into public.teams (id, organization_id, department_id, name) values
  ('69000000-1200-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Team A');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('69000000-1000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('69000000-1000-4000-8000-000000000001', '69000000-0000-4000-8000-000000000007', 'organization_viewer'),
  ('69000000-1000-4000-8000-000000000002', '69000000-0000-4000-8000-000000000006', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-0000-4000-8000-000000000002', 'department_admin'),
  ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000002', '69000000-0000-4000-8000-000000000003', 'department_admin'),
  ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-0000-4000-8000-000000000005', 'editor');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-1200-4000-8000-000000000001', '69000000-0000-4000-8000-000000000004', 'team_manager');

-- Integrationsquelle aus Paket 014/019: ical-Transport mit den Domaenen fixtures/events, auf
-- Fussball beschraenkt. Die zweite Quelle dient nur als "andere gueltige Quelle" fuer den
-- Spaltenrechte-Test in Abschnitt 35-37 unten.
insert into public.integration_sources (id, organization_id, transport, provider_key, display_name, enabled_domains, department_id, endpoint_url, created_by) values
  ('69000000-2000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', 'ical', 'ical', 'Spielplan-Feed', array['fixtures','events']::public.integration_domain[], '69000000-1100-4000-8000-000000000001', 'https://example.invalid/fixtures.ics', '69000000-0000-4000-8000-000000000001'),
  ('69000000-2000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', 'ical', 'ical', 'Spielplan-Zweitquelle', array['fixtures']::public.integration_domain[], '69000000-1100-4000-8000-000000000001', 'https://example.invalid/fixtures-2.ics', '69000000-0000-4000-8000-000000000001');

-- 1-6: CHECK-Constraints -- ein Ergebnis ohne beide Torzahlen waere eine stille Datenluecke; ein
-- team_id ohne department_id wuerde die zusammengesetzte Fremdschluessel-Pruefung unter MATCH
-- SIMPLE trivial umgehen (die neue CHECK-Klausel schliesst genau diese Luecke); ein team_id,
-- dessen Team zu einer ANDEREN Abteilung gehoert als das angegebene department_id, verletzt
-- stattdessen die zusammengesetzte Fremdschluessel-Pruefung selbst -- zwei verschiedene Fehlerarten.
select throws_ok(
  $$insert into public.fixtures (organization_id, department_id, status)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'played')$$,
  '23514', null, 'a played fixture without both scores violates the CHECK constraint'
);
insert into public.fixtures (id, organization_id, department_id, team_id, is_home, opponent_name, status, home_score, away_score, result_recorded_at) values
  ('69000000-3000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-1200-4000-8000-000000000001', true, 'SV Nachbarort', 'played', 3, 1, now());
select ok(true, 'a played fixture with both scores can be created');

select throws_ok(
  $$insert into public.club_events (organization_id, department_id, title, starts_at, ends_at)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Ungueltiger Zeitraum', now(), now() - interval '1 hour')$$,
  '23514', null, 'an event whose ends_at precedes starts_at violates the CHECK constraint'
);
select throws_ok(
  $$insert into public.club_events (organization_id, department_id, team_id, title, starts_at)
    values ('69000000-1000-4000-8000-000000000001', null, '69000000-1200-4000-8000-000000000001', 'Ohne Abteilung', now())$$,
  '23514', null, 'a team_id without any department_id violates the new CHECK constraint'
);
select throws_ok(
  $$insert into public.club_events (organization_id, department_id, team_id, title, starts_at)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000002', '69000000-1200-4000-8000-000000000001', 'Falsche Abteilung', now())$$,
  '23503', null, 'a team_id belonging to a different department than department_id violates the composite foreign key'
);
insert into public.club_events (id, organization_id, department_id, team_id, title, category, starts_at) values
  ('69000000-3100-4000-8000-000000000003', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-1200-4000-8000-000000000001', 'Team A Trainingslager', 'training_camp', now() + interval '60 days');
select ok(true, 'a team-scoped event whose department_id matches the team''s own department can be created');

-- Weitere Grunddaten fuer die folgenden Abschnitte: je ein vollstaendiges Heimspiel, ein
-- Handball-Spiel und ein Fremdverein-Spiel; je eine Abteilungs-, eine vereinsweite, eine
-- Handball- und eine Fremdverein-Veranstaltung.
insert into public.fixtures (id, organization_id, department_id, team_id, is_home, opponent_name, kickoff_at, status, source_id, external_id, source_updated_at) values
  ('69000000-3000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-1200-4000-8000-000000000001', true, 'FC Auswaerts', now() + interval '7 days', 'scheduled', '69000000-2000-4000-8000-000000000001', 'fx-1', now());
insert into public.fixtures (id, organization_id, department_id, status) values
  ('69000000-3000-4000-8000-000000000003', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000002', 'scheduled');
insert into public.fixtures (id, organization_id, department_id, status) values
  ('69000000-3000-4000-8000-000000000004', '69000000-1000-4000-8000-000000000002', '69000000-1100-4000-8000-000000000003', 'scheduled');

insert into public.club_events (id, organization_id, department_id, title, category, starts_at, source_id, external_id) values
  ('69000000-3100-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Vereinsfest', 'festival', now() + interval '14 days', '69000000-2000-4000-8000-000000000001', 'ev-1');
insert into public.club_events (id, organization_id, department_id, title, category, starts_at) values
  ('69000000-3100-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', null, 'Jahreshauptversammlung', 'general_meeting', now() + interval '30 days');
insert into public.club_events (id, organization_id, department_id, title, category, starts_at) values
  ('69000000-3100-4000-8000-000000000004', '69000000-1000-4000-8000-000000000002', '69000000-1100-4000-8000-000000000003', 'Fremdverein Vereinsabend', 'social', now() + interval '10 days');
insert into public.club_events (id, organization_id, department_id, title, category, starts_at) values
  ('69000000-3100-4000-8000-000000000005', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000002', 'Handball Vereinsabend', 'social', now() + interval '20 days');
insert into public.club_events (id, organization_id, department_id, title, category, starts_at, source_id, external_id, recurrence_key) values
  ('69000000-3100-4000-8000-000000000006', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Wiederkehrender Termin 1', 'course', now() + interval '5 days', '69000000-2000-4000-8000-000000000001', 'ev-series-1', '2026-09-01'),
  ('69000000-3100-4000-8000-000000000007', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Wiederkehrender Termin 2', 'course', now() + interval '12 days', '69000000-2000-4000-8000-000000000001', 'ev-series-1', '2026-09-08');

-- 7-10: eindeutiger Wiedererkennungsschluessel je Quelle -- ein zweiter Datensatz mit derselben
-- (organization_id, source_id, external_id) ist ein Konflikt, keine stille Dublette.
-- recurrence_key ist Teil desselben Index, damit dieselbe Kalender-UID mehrere wiederkehrende
-- Instanzen haben darf -- genau das ist der Zweck der Spalte.
select throws_ok(
  $$insert into public.fixtures (organization_id, department_id, source_id, external_id)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-2000-4000-8000-000000000001', 'fx-1')$$,
  '23505', null, 'the same (organization_id, source_id, external_id) cannot be inserted twice into fixtures'
);
select throws_ok(
  $$insert into public.club_events (organization_id, department_id, title, starts_at, source_id, external_id)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Zweiter Eintrag', now(), '69000000-2000-4000-8000-000000000001', 'ev-1')$$,
  '23505', null, 'the same (organization_id, source_id, external_id) cannot be inserted twice into club_events without a differing recurrence_key'
);
select is(
  (select count(*)::integer from public.club_events where source_id = '69000000-2000-4000-8000-000000000001' and external_id = 'ev-series-1'),
  2, 'two recurring instances of the same calendar UID coexist thanks to differing recurrence_key values'
);
select throws_ok(
  $$insert into public.club_events (organization_id, department_id, title, starts_at, source_id, external_id, recurrence_key)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Dritte Instanz', now(), '69000000-2000-4000-8000-000000000001', 'ev-series-1', '2026-09-01')$$,
  '23505', null, 'the same (source_id, external_id, recurrence_key) triple cannot be inserted twice'
);

-- 11-12: RLS ist auf beiden neuen Tabellen erzwungen, auch fuer den Tabelleneigentuemer.
select is((select relforcerowsecurity from pg_class where oid = 'public.fixtures'::regclass), true, 'fixtures has FORCE ROW LEVEL SECURITY enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.club_events'::regclass), true, 'club_events has FORCE ROW LEVEL SECURITY enabled');

-- 13-18: kein Schreibpfad fuer authenticated -- nur die API mit Service Role, analog
-- directory_people/integration_sources. Es gibt ueberhaupt kein Grant, also scheitert selbst der
-- organization_admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.fixtures (organization_id, department_id, status)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'scheduled')$$,
  '42501', null, 'authenticated cannot insert into fixtures even as the organization admin'
);
select throws_ok(
  $$update public.fixtures set note = 'x' where id = '69000000-3000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update fixtures even as the organization admin'
);
select throws_ok(
  $$delete from public.fixtures where id = '69000000-3000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot delete from fixtures even as the organization admin'
);
select throws_ok(
  $$insert into public.club_events (organization_id, department_id, title, starts_at)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'x', now())$$,
  '42501', null, 'authenticated cannot insert into club_events even as the organization admin'
);
select throws_ok(
  $$update public.club_events set title = 'x' where id = '69000000-3100-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update club_events even as the organization admin'
);
select throws_ok(
  $$delete from public.club_events where id = '69000000-3100-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot delete from club_events even as the organization admin'
);

-- 19-26: Sichtbarkeit ist vereinsweit (authz.is_any_member_of_organization), nicht auf die eigene
-- Abteilung beschraenkt -- anders als directory_people_select. Ein reiner organization_viewer
-- ohne jede Abteilungs-/Teamrolle sieht trotzdem alle Spiele/Veranstaltungen des eigenen Vereins;
-- ein Fremdverein-Admin sieht keine davon; und ein Fussball-Abteilungsadmin sieht auch das
-- Handball-Spiel -- genau der Verhaltensunterschied, den ein spaeteres Copy-Paste von
-- directory_people_select faelschlich wegregeln koennte.
select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000007', true);
select is((select count(*)::integer from public.fixtures where id = '69000000-3000-4000-8000-000000000001'), 1,
  'a plain organization_viewer sees the Fussball fixture of their own club');
select is((select count(*)::integer from public.fixtures where id = '69000000-3000-4000-8000-000000000003'), 1,
  'a plain organization_viewer sees the Handball fixture too -- club-wide, not department-scoped visibility');
select is((select count(*)::integer from public.club_events where id = '69000000-3100-4000-8000-000000000002'), 1,
  'a plain organization_viewer sees the org-wide event of their own club');
select is((select count(*)::integer from public.fixtures where id = '69000000-3000-4000-8000-000000000004'), 0,
  'a plain organization_viewer does not see the foreign club''s fixture');
select is((select count(*)::integer from public.club_events where id = '69000000-3100-4000-8000-000000000004'), 0,
  'a plain organization_viewer does not see the foreign club''s event');

select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.fixtures where organization_id = '69000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s fixtures');
select is((select count(*)::integer from public.club_events where organization_id = '69000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s events');

select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.fixtures where id = '69000000-3000-4000-8000-000000000003'), 1,
  'the Fussball department admin also sees the Handball-department fixture -- unlike directory_people_select, fixtures/club_events are not department-scoped');

-- 27-34: fixture.manage/event.manage in authz.has_department_permission -- direkt geprueft, nicht
-- nur ueber eine Policy. Der team_manager bekommt beides nie (dieselbe Begruendung wie bei
-- team.manage/integration.manage); der organization_admin bekommt beides ueber den
-- has_organization_permission-Fallback, auch in einer Abteilung ohne eigene
-- department_memberships-Zeile.
select is(authz.has_department_permission('69000000-1100-4000-8000-000000000001', 'fixture.manage'), true,
  'the Fussball department admin has fixture.manage in their own department') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000002', true)) _;
select is(authz.has_department_permission('69000000-1100-4000-8000-000000000001', 'event.manage'), true,
  'the Fussball department admin has event.manage in their own department') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000002', true)) _;
select is(authz.has_department_permission('69000000-1100-4000-8000-000000000001', 'fixture.manage'), false,
  'a plain editor does not have fixture.manage') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000005', true)) _;
select is(authz.has_department_permission('69000000-1100-4000-8000-000000000001', 'event.manage'), false,
  'a plain editor does not have event.manage') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000005', true)) _;
select is(authz.has_team_permission('69000000-1200-4000-8000-000000000001', 'fixture.manage'), false,
  'a team_manager does not have fixture.manage -- the department manages fixtures, not the team') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000004', true)) _;
select is(authz.has_team_permission('69000000-1200-4000-8000-000000000001', 'event.manage'), false,
  'a team_manager does not have event.manage -- same reasoning as team.manage/integration.manage') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000004', true)) _;
select is(authz.has_department_permission('69000000-1100-4000-8000-000000000002', 'fixture.manage'), true,
  'the organization admin has fixture.manage in Handball via the organization-permission fallback, without a direct department_membership row there') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000001', true)) _;
select is(authz.has_department_permission('69000000-1100-4000-8000-000000000002', 'event.manage'), true,
  'the organization admin has event.manage in Handball via the same fallback') from (select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000001', true)) _;

-- 35-37: Spaltenrechte auf teams -- die Sync-Provenienzspalten duerfen nicht ueber den bestehenden,
-- spaltenlos weiten teams_insert/teams_update-Zugriff frei gesetzt werden, selbst mit team.manage.
-- name/archived_at bleiben unveraendert editierbar -- die bestehende Faehigkeit darf nicht
-- regressieren.
select set_config('request.jwt.claim.sub', '69000000-0000-4000-8000-000000000002', true);
update public.teams set name = 'Team A (Fussball)' where id = '69000000-1200-4000-8000-000000000001';
select ok(true, 'the Fussball department admin can still update the team name -- the pre-existing capability must not regress');
select throws_ok(
  $$update public.teams set source_id = '69000000-2000-4000-8000-000000000002' where id = '69000000-1200-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot update teams.source_id even with team.manage -- column privilege, not row policy'
);
select throws_ok(
  $$insert into public.teams (organization_id, department_id, name, source_id)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Ungueltiges Team', '69000000-2000-4000-8000-000000000002')$$,
  '42501', null, 'authenticated cannot insert a team with source_id set even with team.manage -- column privilege'
);

set local role postgres;

-- 38-39: die neuen Mannschaftsspalten -- ueber den Service-Role-Sync-Codepfad gesetzt, hier direkt
-- als Tabelleneigentuemer nachgestellt -- rundlaufen unveraendert.
insert into public.teams (id, organization_id, department_id, name, age_group, competition, source_id, external_id, source_updated_at) values
  ('69000000-1200-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Team B (Sync)', 'U15', 'Kreisliga', '69000000-2000-4000-8000-000000000001', 'team-ext-1', now());
select is(
  (select row(age_group, competition, source_id, external_id) from public.teams where id = '69000000-1200-4000-8000-000000000002'),
  row('U15'::text, 'Kreisliga'::text, '69000000-2000-4000-8000-000000000001'::uuid, 'team-ext-1'::text),
  'a synced team round-trips age_group/competition/source_id/external_id'
);
select isnt(
  (select source_updated_at from public.teams where id = '69000000-1200-4000-8000-000000000002'),
  null, 'a synced team records source_updated_at'
);

-- 40: derselbe Wiedererkennungsschluessel je Quelle gilt auch fuer teams.
select throws_ok(
  $$insert into public.teams (organization_id, department_id, name, source_id, external_id)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Dubletten-Team', '69000000-2000-4000-8000-000000000001', 'team-ext-1')$$,
  '23505', null, 'the same (organization_id, source_id, external_id) cannot be inserted twice into teams'
);

-- 41-46: Loeschverhalten -- die SET-NULL-Spaltenlisten sind gezielt (nur source_id bzw. team_id,
-- external_id bleibt als Historie erhalten), waehrend die eigene Fremdschluessel-Beziehung zu
-- departments bei fixtures/club_events bewusst CASCADE ist, keine Ausnahme wie bei directory_people.
delete from public.integration_sources where id = '69000000-2000-4000-8000-000000000001';
select is(
  (select row(source_id, external_id) from public.fixtures where id = '69000000-3000-4000-8000-000000000001'),
  row(null::uuid, 'fx-1'::text),
  'deleting the source sets fixtures.source_id to null -- external_id survives as history'
);
select is(
  (select row(source_id, external_id) from public.club_events where id = '69000000-3100-4000-8000-000000000001'),
  row(null::uuid, 'ev-1'::text),
  'deleting the source sets club_events.source_id to null -- external_id survives as history'
);

delete from public.teams where id = '69000000-1200-4000-8000-000000000001';
select is(
  (select row(department_id, team_id, organization_id) from public.fixtures where id = '69000000-3000-4000-8000-000000000001'),
  row('69000000-1100-4000-8000-000000000001'::uuid, null::uuid, '69000000-1000-4000-8000-000000000001'::uuid),
  'deleting the team sets fixtures.team_id to null -- department_id and organization_id survive'
);
select is(
  (select row(department_id, team_id, organization_id) from public.club_events where id = '69000000-3100-4000-8000-000000000003'),
  row('69000000-1100-4000-8000-000000000001'::uuid, null::uuid, '69000000-1000-4000-8000-000000000001'::uuid),
  'deleting the team sets club_events.team_id to null -- department_id and organization_id survive'
);

delete from public.departments where id = '69000000-1100-4000-8000-000000000002';
select is((select count(*)::integer from public.fixtures where id = '69000000-3000-4000-8000-000000000003'), 0,
  'deleting the department CASCADEs the Handball fixture -- unlike source_id/team_id this is not a SET NULL');
select is((select count(*)::integer from public.club_events where id = '69000000-3100-4000-8000-000000000005'), 0,
  'deleting the department CASCADEs the Handball event -- unlike source_id/team_id this is not a SET NULL');

-- 47-50: Verknuepfung zum Inhalt -- eine Einreichung kann aus einem Spiel entstehen, mit
-- Herkunftsnachweis fuer die Vorbelegung; loescht man das Spiel danach, bleibt die Einreichung
-- erhalten, nur der Verweis wird entfernt.
select throws_ok(
  $$insert into public.submissions (organization_id, department_id, content_type, created_by, preset_slug, communication_goal, requested_formats, source_material, source_provenance)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'match_result', '69000000-0000-4000-8000-000000000001', 'match_result', 'inform', '["feed_image"]'::jsonb, '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}'::jsonb, '[]'::jsonb)$$,
  '23514', null, 'source_provenance rejects a non-object JSON value'
);
select throws_ok(
  $$insert into public.submissions (organization_id, department_id, content_type, created_by, preset_slug, communication_goal, requested_formats, source_material, source_prefill_snapshot)
    values ('69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'match_result', '69000000-0000-4000-8000-000000000001', 'match_result', 'inform', '["feed_image"]'::jsonb, '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}'::jsonb, '[]'::jsonb)$$,
  '23514', null, 'source_prefill_snapshot rejects a non-object JSON value'
);

insert into public.submissions (id, organization_id, department_id, content_type, created_by, preset_slug, communication_goal, requested_formats, source_material, fixture_id) values
  ('69000000-4000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'match_result', '69000000-0000-4000-8000-000000000001', 'match_result', 'inform', '["feed_image"]'::jsonb, '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}'::jsonb, '69000000-3000-4000-8000-000000000002');
delete from public.fixtures where id = '69000000-3000-4000-8000-000000000002';
select is((select count(*)::integer from public.submissions where id = '69000000-4000-4000-8000-000000000001'), 1,
  'deleting the fixture does not delete the submission that referenced it');
select is((select fixture_id from public.submissions where id = '69000000-4000-4000-8000-000000000001'), null,
  'deleting the fixture sets submissions.fixture_id to null');

-- 51-53: Invalidierung offener Freigaben -- eine Aenderung an einem bereits vorbelegten Fakt
-- invalidiert die Freigabe der davon abhaengigen post_version; eine Aenderung an einer Spalte
-- ausserhalb des trigger-when-Filters (z. B. note) tut das ausdruecklich nicht.
insert into public.fixtures (id, organization_id, department_id, opponent_name, status) values
  ('69000000-3000-4000-8000-000000000005', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Alter Gegner', 'scheduled'),
  ('69000000-3000-4000-8000-000000000006', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Unveraenderter Gegner', 'scheduled');
insert into public.club_events (id, organization_id, department_id, title, category, starts_at) values
  ('69000000-3100-4000-8000-000000000008', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'Trigger Test Termin', 'other', now() + interval '90 days');

insert into public.submissions (id, organization_id, department_id, content_type, created_by, preset_slug, communication_goal, requested_formats, source_material, fixture_id) values
  ('69000000-4000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'match_announcement', '69000000-0000-4000-8000-000000000001', 'match_announcement', 'inform', '["feed_image"]'::jsonb, '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}'::jsonb, '69000000-3000-4000-8000-000000000005'),
  ('69000000-4000-4000-8000-000000000003', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'match_announcement', '69000000-0000-4000-8000-000000000001', 'match_announcement', 'inform', '["feed_image"]'::jsonb, '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}'::jsonb, '69000000-3000-4000-8000-000000000006');
insert into public.submissions (id, organization_id, department_id, content_type, created_by, preset_slug, communication_goal, requested_formats, source_material, club_event_id) values
  ('69000000-4000-4000-8000-000000000004', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', 'event', '69000000-0000-4000-8000-000000000001', 'event', 'inform', '["feed_image"]'::jsonb, '{"facts":[],"observations":[],"quotes":[],"doNotMention":[]}'::jsonb, '69000000-3100-4000-8000-000000000008');

insert into public.posts (id, organization_id, department_id, submission_id, status, created_by) values
  ('69000000-5000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-4000-4000-8000-000000000002', 'draft', '69000000-0000-4000-8000-000000000001'),
  ('69000000-5000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-4000-4000-8000-000000000003', 'draft', '69000000-0000-4000-8000-000000000001'),
  ('69000000-5000-4000-8000-000000000003', '69000000-1000-4000-8000-000000000001', '69000000-1100-4000-8000-000000000001', '69000000-4000-4000-8000-000000000004', 'draft', '69000000-0000-4000-8000-000000000001');

insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('69000000-6000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-5000-4000-8000-000000000001', 1, '{}', '{}', 'user', '69000000-0000-4000-8000-000000000001'),
  ('69000000-6000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-5000-4000-8000-000000000002', 1, '{}', '{}', 'user', '69000000-0000-4000-8000-000000000001'),
  ('69000000-6000-4000-8000-000000000003', '69000000-1000-4000-8000-000000000001', '69000000-5000-4000-8000-000000000003', 1, '{}', '{}', 'user', '69000000-0000-4000-8000-000000000001');

insert into public.approval_requests (id, organization_id, post_id, post_version_id) values
  ('69000000-7000-4000-8000-000000000001', '69000000-1000-4000-8000-000000000001', '69000000-5000-4000-8000-000000000001', '69000000-6000-4000-8000-000000000001'),
  ('69000000-7000-4000-8000-000000000002', '69000000-1000-4000-8000-000000000001', '69000000-5000-4000-8000-000000000002', '69000000-6000-4000-8000-000000000002'),
  ('69000000-7000-4000-8000-000000000003', '69000000-1000-4000-8000-000000000001', '69000000-5000-4000-8000-000000000003', '69000000-6000-4000-8000-000000000003');

update public.fixtures set opponent_name = 'Neuer Gegner' where id = '69000000-3000-4000-8000-000000000005';
select isnt((select invalidated_at from public.approval_requests where id = '69000000-7000-4000-8000-000000000001'), null,
  'changing a fixture''s opponent_name invalidates its open approval request');

update public.fixtures set note = 'geaenderte Notiz' where id = '69000000-3000-4000-8000-000000000006';
select is((select invalidated_at from public.approval_requests where id = '69000000-7000-4000-8000-000000000002'), null,
  'changing an unrelated fixtures column (note) does not invalidate the approval request');

update public.club_events set starts_at = starts_at + interval '1 day' where id = '69000000-3100-4000-8000-000000000008';
select isnt((select invalidated_at from public.approval_requests where id = '69000000-7000-4000-8000-000000000003'), null,
  'changing a club_event''s starts_at invalidates its open approval request');

select * from finish();
rollback;
