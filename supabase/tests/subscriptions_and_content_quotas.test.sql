begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '41000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-subscriptions.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '41000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'viewer@pgtap-subscriptions.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '41000000-0000-4000-8000-000000000098', 'authenticated', 'authenticated', 'fremdverein@pgtap-subscriptions.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('41000000-1000-4000-8000-000000000001', 'PGTAP Subscriptions Verein', 'pgtap-subscriptions-verein'),
  ('41000000-1000-4000-8000-000000000002', 'PGTAP Subscriptions Fremdverein', 'pgtap-subscriptions-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('41000000-1100-4000-8000-000000000001', '41000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('41000000-1100-4000-8000-000000000009', '41000000-1000-4000-8000-000000000002', 'Handball', 'handball');
insert into public.teams (id, organization_id, department_id, name) values
  ('41000000-1200-4000-8000-000000000001', '41000000-1000-4000-8000-000000000001', '41000000-1100-4000-8000-000000000001', 'Erste Mannschaft');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('41000000-1000-4000-8000-000000000001', '41000000-1100-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'department_admin'),
  ('41000000-1000-4000-8000-000000000001', '41000000-1100-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', 'viewer'),
  ('41000000-1000-4000-8000-000000000002', '41000000-1100-4000-8000-000000000009', '41000000-0000-4000-8000-000000000098', 'department_admin');

-- Ein eigener Testtarif statt der Seed-Tarife, damit die Grenzen unten frei waehlbar sind. Beide
-- Testvereine sind per direktem insert entstanden, nicht ueber create_organization() -- deshalb hier
-- explizit eine organization_subscriptions-Zeile je Verein, statt sich auf die Backfill-Zeile der
-- Migration (die nur beim Einspielen bestehende Vereine erfasst) oder ein blindes update zu verlassen.
insert into public.subscription_plans (key, display_name, storage_bytes, max_teams, max_departments) values
  ('pgtap_test_plan', 'PGTAP Testtarif', 1000000, 1, 1);
insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month, max_duration_seconds) values
  ('pgtap_test_plan', 'own_upload', 1, null),
  ('pgtap_test_plan', 'ai_image', 2, null),
  ('pgtap_test_plan', 'ai_video', 5, 10);
insert into public.organization_subscriptions (organization_id, plan_key) values
  ('41000000-1000-4000-8000-000000000001', 'pgtap_test_plan'),
  ('41000000-1000-4000-8000-000000000002', 'pgtap_test_plan');

-- create_organization() legt seit dieser Migration selbst eine organization_subscriptions-Zeile an --
-- ohne diese Ergaenzung waere effective_limits() fuer jeden ab jetzt neu gegruendeten Verein leer
-- geblieben (siehe Kommentar in der Migration), und der Struktur-Trigger haette nichts durchgesetzt.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
select ok(public.create_organization('PGTAP Neuverein', 'Erste Abteilung') is not null, 'create_organization succeeds and implicitly seeds a free subscription row');
set local role postgres;
select is(
  (select plan_key from public.organization_subscriptions where organization_id = (select id from public.organizations where slug = 'pgtap-neuverein')),
  'free', 'a newly created organization already has an effective_limits() row via the free plan'
);

-- effective_limits/effective_content_limits: Tarifwert ohne Uebersteuerung, dann mit.
select is(
  (select storage_bytes from public.effective_limits('41000000-1000-4000-8000-000000000001')),
  1000000::bigint, 'effective_limits reports the plan value when no override is set'
);
update public.organization_subscriptions
  set storage_bytes_override = 5000000, override_reason = 'Pilotverein', override_by = '41000000-0000-4000-8000-000000000001', override_at = now()
  where organization_id = '41000000-1000-4000-8000-000000000001';
select is(
  (select storage_bytes from public.effective_limits('41000000-1000-4000-8000-000000000001')),
  5000000::bigint, 'effective_limits prefers the operative override over the plan value'
);
select is(
  (select max_per_month from public.effective_content_limits('41000000-1000-4000-8000-000000000001') where media_origin = 'own_upload'),
  1, 'effective_content_limits reports the plan value for own_upload when no override exists'
);
insert into public.organization_content_limit_overrides (organization_id, media_origin, max_per_month, override_reason, override_by) values
  ('41000000-1000-4000-8000-000000000001', 'own_upload', 9, 'Testkontingent erhoeht', '41000000-0000-4000-8000-000000000001');
select is(
  (select max_per_month from public.effective_content_limits('41000000-1000-4000-8000-000000000001') where media_origin = 'own_upload'),
  9, 'effective_content_limits prefers the operative content-limit override'
);
delete from public.organization_content_limit_overrides where organization_id = '41000000-1000-4000-8000-000000000001';

-- Eine Herkunftsart, die im Tarif ganz fehlt, taucht in effective_content_limits gar nicht auf
-- (bedeutet 0, nicht unbegrenzt).
insert into public.subscription_plans (key, display_name, storage_bytes) values ('pgtap_incomplete_plan', 'PGTAP Unvollstaendig', 1000000);
insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month) values ('pgtap_incomplete_plan', 'own_upload', 5);
update public.organization_subscriptions set plan_key = 'pgtap_incomplete_plan' where organization_id = '41000000-1000-4000-8000-000000000002';
select is(
  (select count(*)::integer from public.effective_content_limits('41000000-1000-4000-8000-000000000002') where media_origin = 'ai_image'),
  0, 'a media_origin missing from the plan does not appear in effective_content_limits at all'
);
update public.organization_subscriptions set plan_key = 'pgtap_test_plan' where organization_id = '41000000-1000-4000-8000-000000000002';

-- Konstruktions-CHECKs auf subscription_plans/subscription_plan_content_limits.
select throws_ok(
  $$insert into public.subscription_plans (key, display_name, storage_bytes) values ('pgtap_zero_storage', 'Invalid', 0)$$,
  '23514', null, 'a plan with storage_bytes = 0 violates the check constraint'
);
select throws_ok(
  $$insert into public.subscription_plan_content_limits (plan_key, media_origin, max_duration_seconds) values ('pgtap_test_plan', 'own_upload', 30)$$,
  '23514', null, 'max_duration_seconds set for a media_origin other than ai_video violates the check constraint'
);

-- Uebersteuerung ohne Begruendung -- Speicher/Struktur ist eine CHECK-Verletzung, das
-- Kontingent-Override ist wegen not null gar nicht erst einfuegbar.
select throws_ok(
  $$update public.organization_subscriptions set max_teams_override = 3, override_reason = null, override_by = null, override_at = null where organization_id = '41000000-1000-4000-8000-000000000001'$$,
  '23514', null, 'setting a structure override without a justification violates the check constraint'
);
select throws_ok(
  $$insert into public.organization_content_limit_overrides (organization_id, media_origin, max_per_month, override_by) values ('41000000-1000-4000-8000-000000000001', 'ai_image', 4, '41000000-0000-4000-8000-000000000001')$$,
  '23502', null, 'a content-limit override without override_reason is rejected by not null'
);

-- Deny-all RLS -- kein Grant an authenticated, jeder direkte Zugriff scheitert auf Privilegienebene,
-- unabhaengig vom eigenen Verein.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.subscription_plans$$, '42501', null, 'authenticated cannot read subscription_plans directly');
select throws_ok($$select * from public.organization_subscriptions where organization_id = '41000000-1000-4000-8000-000000000001'$$, '42501', null, 'authenticated cannot read organization_subscriptions directly, not even their own club''s row');
select throws_ok($$update public.organization_subscriptions set plan_key = 'free' where organization_id = '41000000-1000-4000-8000-000000000001'$$, '42501', null, 'authenticated cannot write organization_subscriptions directly');
select throws_ok($$insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month) values ('pgtap_test_plan', 'own_upload', 99)$$, '42501', null, 'authenticated cannot write subscription_plan_content_limits directly');
set local role postgres;

-- storage_limits: echtes Scope-CHECK, Unique-Index, RLS.
select throws_ok(
  $$insert into public.storage_limits (organization_id, scope, storage_bytes, set_by) values ('41000000-1000-4000-8000-000000000001', 'organization', 500000, '41000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a storage_limits row with scope = organization violates the check constraint'
);
insert into public.storage_limits (organization_id, scope, department_id, storage_bytes, set_by) values
  ('41000000-1000-4000-8000-000000000001', 'department', '41000000-1100-4000-8000-000000000001', 400000, '41000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.storage_limits (organization_id, scope, department_id, storage_bytes, set_by) values ('41000000-1000-4000-8000-000000000001', 'department', '41000000-1100-4000-8000-000000000001', 100000, '41000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a second department limit for the same department violates the unique index'
);
insert into public.storage_limits (organization_id, scope, department_id, team_id, storage_bytes, set_by) values
  ('41000000-1000-4000-8000-000000000001', 'team', '41000000-1100-4000-8000-000000000001', '41000000-1200-4000-8000-000000000001', 200000, '41000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.storage_limits (organization_id, scope, department_id, team_id, storage_bytes, set_by) values ('41000000-1000-4000-8000-000000000001', 'team', '41000000-1100-4000-8000-000000000001', '41000000-1200-4000-8000-000000000001', 50000, '41000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a second team limit for the same team violates the unique index'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.storage_limits where organization_id = '41000000-1000-4000-8000-000000000001'), 2, 'the department admin reads both storage_limits rows of their own club');
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000098', true);
select is((select count(*)::integer from public.storage_limits where organization_id = '41000000-1000-4000-8000-000000000001'), 0, 'a member of another club reads no storage_limits row of this club');
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.storage_limits (organization_id, scope, department_id, storage_bytes, set_by) values ('41000000-1000-4000-8000-000000000001', 'department', '41000000-1100-4000-8000-000000000001', 300000, '41000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a viewer without department.manage cannot write a storage_limits row of their own club'
);
set local role postgres;

-- Struktur-Grenztrigger. Der Testtarif erlaubt max_departments = 1 und max_teams = 1, beide bereits
-- durch die Fixtures oben ausgeschoepft.
select throws_ok(
  $$insert into public.departments (organization_id, name, slug) values ('41000000-1000-4000-8000-000000000001', 'Zweite Abteilung', 'zweite-abteilung')$$,
  'P0001', 'structure limit reached for this organization', 'a second department beyond max_departments = 1 is rejected by the trigger, even via a direct insert bypassing any RPC'
);
select throws_ok(
  $$insert into public.teams (organization_id, department_id, name) values ('41000000-1000-4000-8000-000000000001', '41000000-1100-4000-8000-000000000001', 'Zweite Mannschaft')$$,
  'P0001', 'structure limit reached for this organization', 'a second team beyond max_teams = 1 is rejected by the trigger'
);
select is((select count(*)::integer from public.departments where organization_id = '41000000-1000-4000-8000-000000000001'), 1, 'the rejected insert did not leave a partial department row behind');
-- Downgrade unter die aktuelle Anzahl: max_departments_override erlaubt per CHECK nur Werte > 0
-- (0 bedeutet hier nicht "gesperrt", sondern ist gar kein gueltiger Wert) -- deshalb zuerst
-- kurzzeitig auf 2 angehoben, eine zweite Abteilung angelegt, und danach wieder auf 1 gesenkt.
update public.organization_subscriptions set max_departments_override = 2, override_reason = 'Testerhoehung', override_by = '41000000-0000-4000-8000-000000000001', override_at = now()
  where organization_id = '41000000-1000-4000-8000-000000000001';
insert into public.departments (organization_id, name, slug) values ('41000000-1000-4000-8000-000000000001', 'Zweite Abteilung', 'zweite-abteilung');
update public.organization_subscriptions set max_departments_override = 1, override_reason = 'Downgrade-Test', override_by = '41000000-0000-4000-8000-000000000001', override_at = now()
  where organization_id = '41000000-1000-4000-8000-000000000001';
select is((select count(*)::integer from public.departments where organization_id = '41000000-1000-4000-8000-000000000001'), 2, 'a downgrade below the current count does not delete any existing department');
select throws_ok(
  $$insert into public.departments (organization_id, name, slug) values ('41000000-1000-4000-8000-000000000001', 'Dritte Abteilung', 'dritte-abteilung')$$,
  'P0001', 'structure limit reached for this organization', 'after a downgrade below the current count, the next new department is still rejected'
);
-- Nur max_departments_override zuruecksetzen: storage_bytes_override steht seit dem
-- effective_limits-Test oben noch, und der Rechtfertigungs-CHECK verlangt reason/by/at, solange
-- IRGENDEIN Override gesetzt ist -- die drei Felder blind mitzuloeschen wuerde genau diesen CHECK
-- verletzen (beim eigenen Testlauf gefunden).
update public.organization_subscriptions set max_departments_override = null
  where organization_id = '41000000-1000-4000-8000-000000000001';

-- schedule_publication: Tarifkontingent nach Medienherkunft. Testtarif: own_upload maximal 1/Monat,
-- ai_video maximal 5/Monat mit 10 Sekunden Hoechstlaenge. Ein einziger Beitrag (mehrere Versionen),
-- weil schedule_publication ihn nach Erfolg auf 'scheduled' setzt -- zwischen den Aufrufen wird der
-- Status gezielt zurueck auf 'approved' gesetzt, um jeweils nur die Kontingentpruefung zu isolieren.
insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('41000000-2000-4000-8000-000000000001', '41000000-1000-4000-8000-000000000001', '41000000-1100-4000-8000-000000000001', 'approved', '41000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('41000000-3000-4000-8000-000000000001', '41000000-1000-4000-8000-000000000001', '41000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '41000000-0000-4000-8000-000000000001'),
  ('41000000-3000-4000-8000-000000000002', '41000000-1000-4000-8000-000000000001', '41000000-2000-4000-8000-000000000001', 2, '{}', '{}', 'user', '41000000-0000-4000-8000-000000000001'),
  ('41000000-3000-4000-8000-000000000003', '41000000-1000-4000-8000-000000000001', '41000000-2000-4000-8000-000000000001', 3, '{}', '{}', 'user', '41000000-0000-4000-8000-000000000001'),
  ('41000000-3000-4000-8000-000000000005', '41000000-1000-4000-8000-000000000001', '41000000-2000-4000-8000-000000000001', 5, '{}', '{}', 'user', '41000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id, media_origin, ai_generated_video_duration_seconds) values
  ('41000000-3000-4000-8000-000000000004', '41000000-1000-4000-8000-000000000001', '41000000-2000-4000-8000-000000000001', 4, '{}', '{}', 'user', '41000000-0000-4000-8000-000000000001', 'ai_video', 25);
update public.post_versions set media_origin = 'ai_image' where id = '41000000-3000-4000-8000-000000000003';
select is((select media_origin from public.post_versions where id = '41000000-3000-4000-8000-000000000001'), 'own_upload', 'media_origin defaults to own_upload for a post_version created via the existing path');

insert into public.social_connections (id, organization_id, platform, external_account_id, display_name) values
  ('41000000-8000-4000-8000-000000000001', '41000000-1000-4000-8000-000000000001', 'instagram', 'ext-1', 'PGTAP Verein');
insert into public.channel_scopes (organization_id, social_connection_id, scope, created_by) values
  ('41000000-1000-4000-8000-000000000001', '41000000-8000-4000-8000-000000000001', 'organization', '41000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);

select ok(
  (select status from public.schedule_publication('41000000-3000-4000-8000-000000000001', '41000000-8000-4000-8000-000000000001', now() + interval '1 hour')) = 'queued',
  'scheduling the first own_upload post_version succeeds and consumes the monthly content quota'
);
set local role postgres;
update public.posts set status = 'approved' where id = '41000000-2000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$select public.schedule_publication('41000000-3000-4000-8000-000000000002', '41000000-8000-4000-8000-000000000001', now() + interval '1 hour')$$,
  'P0001', 'content_quota_exceeded: own_upload/1', 'a second own_upload scheduling within the same month is rejected, naming the origin and the limit'
);

-- Eine ANDERE Herkunftsart (hier: ai_image) bleibt vom ausgeschoepften own_upload-Kontingent unberuehrt.
select ok(
  (select status from public.schedule_publication('41000000-3000-4000-8000-000000000003', '41000000-8000-4000-8000-000000000001', now() + interval '1 hour')) = 'queued',
  'scheduling a different media_origin (ai_image) is unaffected by the exhausted own_upload quota'
);
set local role postgres;
update public.posts set status = 'approved' where id = '41000000-2000-4000-8000-000000000001';
set local role authenticated;

-- Ein KI-Video ueber der Hoechstlaenge wird abgelehnt, auch wenn das Monatskontingent (5) noch
-- nicht ausgeschoepft ist.
select throws_ok(
  $$select public.schedule_publication('41000000-3000-4000-8000-000000000004', '41000000-8000-4000-8000-000000000001', now() + interval '1 hour')$$,
  'P0001', 'content_duration_exceeded: ai_video/10', 'an ai_video longer than the plan''s max_duration_seconds is rejected even with quota remaining'
);

-- Ein storniertes Publications-Element gibt den own_upload-Platz wieder frei, exakt wie bei
-- channel_quotas -- eine neue own_upload-Version darf danach eingeplant werden.
set local role postgres;
update public.publications set status = 'failed'
  where post_version_id = '41000000-3000-4000-8000-000000000001' and social_connection_id = '41000000-8000-4000-8000-000000000001';
set local role authenticated;
select ok(
  (select status from public.schedule_publication('41000000-3000-4000-8000-000000000005', '41000000-8000-4000-8000-000000000001', now() + interval '1 hour')) = 'queued',
  'once the earlier publication is marked failed, a new own_upload version can be scheduled again within the same month'
);

select * from finish();
rollback;
