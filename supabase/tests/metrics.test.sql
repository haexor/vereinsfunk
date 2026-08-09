begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

set local role postgres;

-- Ein Verein mit einer Abteilung, ein Fremdverein fuer die Mandantentrennung, ein Nichtmitglied.
-- Frischer UUID-Praefix (72000000...), analog zu den anderen Testdateien.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-metrics.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'dept-viewer@pgtap-metrics.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'outsider@pgtap-metrics.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-metrics.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('72000000-1000-4000-8000-000000000001', 'PGTAP Metrics Verein', 'pgtap-metrics-verein'),
  ('72000000-1000-4000-8000-000000000002', 'PGTAP Metrics Fremdverein', 'pgtap-metrics-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('72000000-1100-4000-8000-000000000001', '72000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('72000000-1000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('72000000-1000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000004', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('72000000-1000-4000-8000-000000000001', '72000000-1100-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'viewer');
-- 72...0003 (outsider) hat bewusst keine Mitgliedschaft irgendwo.

-- 1-2: posts-Insert loest den Trigger genau einmal aus, from_status ist null.
insert into public.posts (id, organization_id, department_id, created_by, status) values
  ('72000000-2000-4000-8000-000000000001', '72000000-1000-4000-8000-000000000001', '72000000-1100-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'draft_ready');
select is(
  (select row(from_status, to_status) from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'),
  row(null::public.post_status, 'draft_ready'::public.post_status),
  'inserting a post records exactly one status event with from_status null'
);
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 1,
  'exactly one row is recorded on insert');

-- 3-4: ein Statuswechsel erzeugt eine zweite Zeile mit dem korrekten from/to-Paar.
update public.posts set status = 'awaiting_approval' where id = '72000000-2000-4000-8000-000000000001';
select is(
  (select row(from_status, to_status) from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001' order by occurred_at desc, id desc limit 1),
  row('draft_ready'::public.post_status, 'awaiting_approval'::public.post_status),
  'updating status records a new event with the previous status as from_status'
);
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 2,
  'exactly two rows exist after one status change');

-- 5: ein Update, das den Status unveraendert laesst, erzeugt keine Zeile.
update public.posts set scheduled_for = now() + interval '1 day' where id = '72000000-2000-4000-8000-000000000001';
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 2,
  'an update that does not change status records no new event');

-- 6: ein redundantes "Update auf denselben Status" erzeugt ebenfalls keine Zeile (WHEN-Klausel).
update public.posts set status = 'awaiting_approval' where id = '72000000-2000-4000-8000-000000000001';
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 2,
  'setting the same status again records no new event');

-- 7-10: RLS -- analytics.view im eigenen Verein/eigener Abteilung sichtbar, fremder Verein nicht,
-- ein Nichtmitglied ohne jede Rolle nicht.
set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 2,
  'an organization_admin (analytics.view via has_department_permission fallback) sees the events of their own club');
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 2,
  'a department viewer (analytics.view) sees the events of their own department');
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s status events');
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.post_status_events where post_id = '72000000-2000-4000-8000-000000000001'), 0,
  'a user without any membership sees no status events');

-- 11: authenticated hat keinen Insert-Grant -- nur der Trigger (der ueber den Service-Client
-- ausgeloeste posts-Schreibzugriff) darf schreiben.
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.post_status_events (organization_id, department_id, post_id, to_status)
    values ('72000000-1000-4000-8000-000000000001', '72000000-1100-4000-8000-000000000001', '72000000-2000-4000-8000-000000000001', 'published')$$,
  '42501', null, 'authenticated cannot insert post_status_events directly -- no insert grant'
);

-- 12-13: retention_settings.status_event_days -- Default und Obergrenze.
set local role postgres;
insert into public.retention_settings (organization_id, updated_by) values
  ('72000000-1000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001');
select is((select status_event_days from public.retention_settings where organization_id = '72000000-1000-4000-8000-000000000001'), 730,
  'status_event_days defaults to 730 days (24 months)');
select throws_ok(
  $$update public.retention_settings set status_event_days = 30 where organization_id = '72000000-1000-4000-8000-000000000001'$$,
  '23514', null, 'status_event_days below 90 violates the CHECK constraint'
);

select * from finish();
commit;
