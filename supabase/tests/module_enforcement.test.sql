begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

set local role postgres;

-- Paket 051, PR 2: set_scope_enabled_modules() und claim_publication_for_execution().
-- Ein Verein ohne Abo, Abteilung A mit Mannschaft T, Abteilung B. In T liegen zwei aktive
-- (queued) Veroeffentlichungen, in B nur eine abgeschlossene (published).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '51010000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-module-enforcement.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51010000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'outsider@pgtap-module-enforcement.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('51010000-1000-4000-8000-000000000001', 'PGTAP Moduldurchsetzung', 'pgtap-moduldurchsetzung');
insert into public.departments (id, organization_id, name, slug) values
  ('51010000-1100-4000-8000-000000000001', '51010000-1000-4000-8000-000000000001', 'Abteilung A', 'abteilung-a'),
  ('51010000-1100-4000-8000-000000000002', '51010000-1000-4000-8000-000000000001', 'Abteilung B', 'abteilung-b');
insert into public.teams (id, organization_id, department_id, name) values
  ('51010000-1200-4000-8000-000000000001', '51010000-1000-4000-8000-000000000001', '51010000-1100-4000-8000-000000000001', 'Team T');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('51010000-1000-4000-8000-000000000001', '51010000-0000-4000-8000-000000000001', 'organization_owner');

insert into public.posts (id, organization_id, department_id, team_id, status, created_by) values
  ('51010000-2000-4000-8000-000000000001', '51010000-1000-4000-8000-000000000001', '51010000-1100-4000-8000-000000000001', '51010000-1200-4000-8000-000000000001', 'draft_ready', '51010000-0000-4000-8000-000000000001'),
  ('51010000-2000-4000-8000-000000000002', '51010000-1000-4000-8000-000000000001', '51010000-1100-4000-8000-000000000002', null, 'draft_ready', '51010000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('51010000-3000-4000-8000-000000000001', '51010000-1000-4000-8000-000000000001', '51010000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '51010000-0000-4000-8000-000000000001'),
  ('51010000-3000-4000-8000-000000000002', '51010000-1000-4000-8000-000000000001', '51010000-2000-4000-8000-000000000001', 2, '{}', '{}', 'user', '51010000-0000-4000-8000-000000000001'),
  ('51010000-3000-4000-8000-000000000003', '51010000-1000-4000-8000-000000000001', '51010000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '51010000-0000-4000-8000-000000000001');
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name) values
  ('51010000-8000-4000-8000-000000000001', '51010000-1000-4000-8000-000000000001', 'instagram', 'ext-module', 'SV Modul');
insert into public.publications (id, organization_id, post_version_id, social_connection_id, platform, status, idempotency_key) values
  ('51010000-9000-4000-8000-000000000001', '51010000-1000-4000-8000-000000000001', '51010000-3000-4000-8000-000000000001', '51010000-8000-4000-8000-000000000001', 'instagram', 'queued', 'pub:module:1'),
  ('51010000-9000-4000-8000-000000000002', '51010000-1000-4000-8000-000000000001', '51010000-3000-4000-8000-000000000002', '51010000-8000-4000-8000-000000000001', 'instagram', 'queued', 'pub:module:2'),
  ('51010000-9000-4000-8000-000000000003', '51010000-1000-4000-8000-000000000001', '51010000-3000-4000-8000-000000000003', '51010000-8000-4000-8000-000000000001', 'instagram', 'published', 'pub:module:3');

set local role authenticated;

-- 1: ein Nichtmitglied darf die Modulauswahl nicht setzen.
select set_config('request.jwt.claim.sub', '51010000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'organization', null, null, '{}')$$,
  'P0001', 'insufficient_permission', 'a non-member cannot set the module selection'
);

select set_config('request.jwt.claim.sub', '51010000-0000-4000-8000-000000000001', true);

-- 2: Scope-IDs, die nicht zum Verein passen, werden abgelehnt (statt still eine fremde Zeile anzulegen).
select throws_ok(
  $$select public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'team', '51010000-1100-4000-8000-000000000002', '51010000-1200-4000-8000-000000000001', '{}')$$,
  'P0001', 'invalid_scope', 'a team under the wrong department is rejected'
);

-- 3-4: Abteilung B hat nur eine abgeschlossene Veroeffentlichung -- abschalten geht.
select is(
  (select enabled_modules from public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'department', '51010000-1100-4000-8000-000000000002', null, '{playerboard}')),
  '{playerboard}'::public.app_module[], 'a department without active publications can deselect social_media'
);
set local role postgres;
select ok(
  (select updated_by = '51010000-0000-4000-8000-000000000001' from public.policy_settings
    where organization_id = '51010000-1000-4000-8000-000000000001' and scope = 'department' and department_id = '51010000-1100-4000-8000-000000000002'),
  'the policy_settings row records who changed the selection'
);
set local role authenticated;

-- 5-6: Abteilung A hat aktive Veroeffentlichungen in Mannschaft T -- abschalten wird verweigert,
-- und es bleibt keine Zeile zurueck.
select throws_ok(
  $$select public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'department', '51010000-1100-4000-8000-000000000001', null, '{playerboard}')$$,
  'P0001', 'module_has_active_publications', 'deselecting social_media above active publications is refused'
);
set local role postgres;
select is(
  (select count(*)::integer from public.policy_settings
    where organization_id = '51010000-1000-4000-8000-000000000001' and scope = 'department' and department_id = '51010000-1100-4000-8000-000000000001'),
  0, 'the refused change leaves no policy_settings row behind'
);
set local role authenticated;

-- 7: dasselbe auf Vereinsebene und mit '{}'.
select throws_ok(
  $$select public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'organization', null, null, '{}')$$,
  'P0001', 'module_has_active_publications', 'deselecting every module at organization level is refused as well'
);

-- 8: social_media behalten, playerboard abwaehlen, geht trotz aktiver Veroeffentlichungen.
select is(
  (select enabled_modules from public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'organization', null, null, '{social_media}')),
  '{social_media}'::public.app_module[], 'keeping social_media while deselecting playerboard is allowed'
);

-- 9: was oben abgewaehlt ist, kann eine untere Ebene nicht waehlen.
select throws_ok(
  $$select public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'team', '51010000-1100-4000-8000-000000000001', '51010000-1200-4000-8000-000000000001', '{social_media,playerboard}')$$,
  'P0001', 'module_not_available', 'a team cannot select a module its organization deselected'
);

-- 10: Duplikate werden zusammengefasst, null heisst wieder erben.
select is(
  (select enabled_modules from public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'team', '51010000-1100-4000-8000-000000000001', '51010000-1200-4000-8000-000000000001', '{social_media,social_media}')),
  '{social_media}'::public.app_module[], 'duplicate modules are collapsed'
);
select is(
  (select enabled_modules from public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'department', '51010000-1100-4000-8000-000000000002', null, null)),
  null::public.app_module[], 'null resets a level to inherit'
);

-- 12: authenticated darf den Claim nicht direkt aufrufen.
select throws_ok(
  $$select public.claim_publication_for_execution('51010000-9000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot execute claim_publication_for_execution'
);

-- 13-14: die API (service_role) startet eine Veroeffentlichung, solange social_media aktiv ist.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(public.claim_publication_for_execution('51010000-9000-4000-8000-000000000001'), 'claimed',
  'a queued publication with social_media enabled is claimed');
select is((select status from public.publications where id = '51010000-9000-4000-8000-000000000001'), 'uploading',
  'the claimed publication moves to uploading');

-- 15: ein zweiter Claim derselben Veroeffentlichung verliert.
select is(public.claim_publication_for_execution('51010000-9000-4000-8000-000000000001'), 'invalid_status',
  'a publication that is no longer queued cannot be claimed again');

-- 16: unbekannte Veroeffentlichung.
select is(public.claim_publication_for_execution('51010000-9000-4000-8000-0000000000ff'), 'not_found',
  'an unknown publication is reported as not_found');

-- 17-19: ist social_media fuer den Beitrag inzwischen aus (hier direkt gesetzt, wie es eine vor
-- dem Lock eingeplante Veroeffentlichung erleben kann), bricht der Claim ab statt zu starten.
set local role postgres;
update public.policy_settings set enabled_modules = '{}'
 where organization_id = '51010000-1000-4000-8000-000000000001' and scope = 'team' and team_id = '51010000-1200-4000-8000-000000000001';
set local role service_role;
select is(public.claim_publication_for_execution('51010000-9000-4000-8000-000000000002'), 'module_disabled',
  'a publication whose module was disabled is not started');
select is((select status from public.publications where id = '51010000-9000-4000-8000-000000000002'), 'cancelled',
  'the publication is cancelled');
select is(
  (select error_class from public.publication_attempts where publication_id = '51010000-9000-4000-8000-000000000002'),
  'module_disabled', 'the cancellation is recorded as an attempt with error_class module_disabled'
);

-- 20: anon darf die Modulauswahl nicht aufrufen.
set local role anon;
select throws_ok(
  $$select public.set_scope_enabled_modules('51010000-1000-4000-8000-000000000001', 'organization', null, null, null)$$,
  '42501', null, 'anon cannot execute set_scope_enabled_modules'
);

select * from finish();
rollback;
