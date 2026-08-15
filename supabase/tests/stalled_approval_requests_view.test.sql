begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

set local role postgres;

-- Zwei Vereine (fuer die RLS-Probe), je ein Vereinsleitungs-Mitglied. Ein Verein traegt drei
-- Freigabeanfragen: eine offene, nicht ueberfaellige Stufe (darf NICHT erscheinen), eine offene
-- ueberfaellige Stufe, eine invalidierte Anfrage mit einer offenen, nicht ueberfaelligen Stufe.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'verein-a-admin@pgtap-stalled.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '67000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'verein-b-admin@pgtap-stalled.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('67000000-1000-4000-8000-000000000001', 'PGTAP Stalled Verein A', 'pgtap-stalled-verein-a'),
  ('67000000-1000-4000-8000-000000000002', 'PGTAP Stalled Verein B', 'pgtap-stalled-verein-b');
insert into public.departments (id, organization_id, name, slug) values
  ('67000000-1100-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');

insert into public.organization_memberships (organization_id, user_id, role) values
  ('67000000-1000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('67000000-1000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000002', 'organization_admin');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('67000000-2000-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', 'draft_ready', '67000000-0000-4000-8000-000000000001'),
  ('67000000-2000-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', 'draft_ready', '67000000-0000-4000-8000-000000000001'),
  ('67000000-2000-4000-8000-000000000003', '67000000-1000-4000-8000-000000000001', '67000000-1100-4000-8000-000000000001', 'draft_ready', '67000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('67000000-3000-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', '67000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '67000000-0000-4000-8000-000000000001'),
  ('67000000-3000-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', '67000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '67000000-0000-4000-8000-000000000001'),
  ('67000000-3000-4000-8000-000000000003', '67000000-1000-4000-8000-000000000001', '67000000-2000-4000-8000-000000000003', 1, '{}', '{}', 'user', '67000000-0000-4000-8000-000000000001');

-- OPEN: nicht ueberfaellig, nicht invalidiert -- darf in der View nicht auftauchen.
-- OVERDUE: offene Stufe mit vergangener Frist.
-- INVALIDATED: die Anfrage selbst ist invalidiert, ihre offene Stufe ist fuer sich genommen nicht ueberfaellig.
insert into public.approval_requests (id, organization_id, post_id, post_version_id, invalidated_at) values
  ('67000000-4000-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', '67000000-2000-4000-8000-000000000001', '67000000-3000-4000-8000-000000000001', null),
  ('67000000-4000-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', '67000000-2000-4000-8000-000000000002', '67000000-3000-4000-8000-000000000002', null),
  ('67000000-4000-4000-8000-000000000003', '67000000-1000-4000-8000-000000000001', '67000000-2000-4000-8000-000000000003', '67000000-3000-4000-8000-000000000003', now());
insert into public.approval_stages (id, organization_id, approval_request_id, position, scope, label, mode, minimum_approvals, reviewer_snapshot, status, deadline_at) values
  ('67000000-5000-4000-8000-000000000001', '67000000-1000-4000-8000-000000000001', '67000000-4000-4000-8000-000000000001', 1, 'department', 'Test', 'any_with_permission', 1, '[]'::jsonb, 'open', now() + interval '1 day'),
  ('67000000-5000-4000-8000-000000000002', '67000000-1000-4000-8000-000000000001', '67000000-4000-4000-8000-000000000002', 1, 'department', 'Test', 'any_with_permission', 1, '[]'::jsonb, 'open', now() - interval '1 hour'),
  ('67000000-5000-4000-8000-000000000003', '67000000-1000-4000-8000-000000000001', '67000000-4000-4000-8000-000000000003', 1, 'department', 'Test', 'any_with_permission', 1, '[]'::jsonb, 'open', null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000001', true);

-- 1: die offene, nicht ueberfaellige Anfrage erscheint nicht.
select is(
  (select count(*)::integer from public.stalled_approval_requests where id = '67000000-4000-4000-8000-000000000001'),
  0, 'an open, not-yet-overdue stage produces no row in the view'
);

-- 2-3: die ueberfaellige Anfrage erscheint, mit is_overdue = true und invalidated_at = null.
select is(
  (select is_overdue from public.stalled_approval_requests where id = '67000000-4000-4000-8000-000000000002'),
  true, 'an overdue open stage flags its request is_overdue'
);
select is(
  (select invalidated_at from public.stalled_approval_requests where id = '67000000-4000-4000-8000-000000000002'),
  null, 'the overdue request itself is not invalidated'
);

-- 4-5: die invalidierte Anfrage erscheint, mit is_overdue = false (ihre einzige Stufe ist fuer sich
-- nicht ueberfaellig) und einem gesetzten invalidated_at.
select is(
  (select is_overdue from public.stalled_approval_requests where id = '67000000-4000-4000-8000-000000000003'),
  false, 'an invalidated request whose own stage is not overdue is not flagged overdue'
);
select isnt(
  (select invalidated_at from public.stalled_approval_requests where id = '67000000-4000-4000-8000-000000000003'),
  null, 'the invalidated request carries its invalidated_at timestamp'
);

-- 6: RLS -- ein Vereinsleitungs-Mitglied eines FREMDEN Vereins (kein Mitglied, kein zugewiesener
-- Pruefer, kein Autor, keine department.manage-Berechtigung in Verein A) sieht keine Zeile.
select set_config('request.jwt.claim.sub', '67000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.stalled_approval_requests where organization_id = '67000000-1000-4000-8000-000000000001'),
  0, 'a member of a foreign organization sees no rows for this organization (RLS)'
);

select * from finish();
rollback;
