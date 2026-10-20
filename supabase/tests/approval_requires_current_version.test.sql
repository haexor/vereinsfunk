begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- 2026101910: request_approval und schedule_publication akzeptieren nur die aktuelle Version des
-- Posts, schedule_publication ausserdem keine invalidierte Freigabe. Der stufenlose Weg (keine Ebene
-- verlangt eine Pruefung, request_approval setzt 'approved' direkt) bleibt einplanbar.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'abteilungsadmin@pgtap-current-version.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('a1000000-1000-4000-8000-000000000001', 'PGTAP Aktuelle Version', 'pgtap-aktuelle-version');
insert into public.departments (id, organization_id, name, slug) values
  ('a1000000-1100-4000-8000-000000000001', 'a1000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('a1000000-1000-4000-8000-000000000001', 'a1000000-1100-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'department_admin');

insert into public.social_connections (id, organization_id, platform, external_account_id, display_name, owner_scope) values
  ('a1000000-8000-4000-8000-000000000001', 'a1000000-1000-4000-8000-000000000001', 'instagram', 'ext-current-version', 'Verein Instagram', 'organization');
insert into public.channel_scopes (organization_id, social_connection_id, scope, created_by) values
  ('a1000000-1000-4000-8000-000000000001', 'a1000000-8000-4000-8000-000000000001', 'organization', 'a1000000-0000-4000-8000-000000000001');

-- P1: v2 ist aktuell und freigegeben, v1 ist die abgelehnte Vorversion.
-- P2: v2 ist aktuell (Entwurf), v1 ist eine alte Version.
-- P3: v1 ist aktuell und freigegeben, ihre Freigabe wurde danach invalidiert (z. B. Spielverlegung).
-- P4: v1 ist aktuell, keine Ebene verlangt eine Pruefung.
insert into public.posts (id, organization_id, department_id, status, created_by, current_version_id) values
  ('a1000000-2000-4000-8000-000000000001', 'a1000000-1000-4000-8000-000000000001', 'a1000000-1100-4000-8000-000000000001', 'approved', 'a1000000-0000-4000-8000-000000000001', 'a1000000-3000-4000-8000-000000000012'),
  ('a1000000-2000-4000-8000-000000000002', 'a1000000-1000-4000-8000-000000000001', 'a1000000-1100-4000-8000-000000000001', 'draft_ready', 'a1000000-0000-4000-8000-000000000001', 'a1000000-3000-4000-8000-000000000022'),
  ('a1000000-2000-4000-8000-000000000003', 'a1000000-1000-4000-8000-000000000001', 'a1000000-1100-4000-8000-000000000001', 'approved', 'a1000000-0000-4000-8000-000000000001', 'a1000000-3000-4000-8000-000000000031'),
  ('a1000000-2000-4000-8000-000000000004', 'a1000000-1000-4000-8000-000000000001', 'a1000000-1100-4000-8000-000000000001', 'draft_ready', 'a1000000-0000-4000-8000-000000000001', 'a1000000-3000-4000-8000-000000000041');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('a1000000-3000-4000-8000-000000000011', 'a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', 'a1000000-0000-4000-8000-000000000001'),
  ('a1000000-3000-4000-8000-000000000012', 'a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000001', 2, '{}', '{}', 'user', 'a1000000-0000-4000-8000-000000000001'),
  ('a1000000-3000-4000-8000-000000000021', 'a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', 'a1000000-0000-4000-8000-000000000001'),
  ('a1000000-3000-4000-8000-000000000022', 'a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000002', 2, '{}', '{}', 'user', 'a1000000-0000-4000-8000-000000000001'),
  ('a1000000-3000-4000-8000-000000000031', 'a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000003', 1, '{}', '{}', 'user', 'a1000000-0000-4000-8000-000000000001'),
  ('a1000000-3000-4000-8000-000000000041', 'a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000004', 1, '{}', '{}', 'user', 'a1000000-0000-4000-8000-000000000001');
insert into public.approval_requests (organization_id, post_id, post_version_id, created_at) values
  ('a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000001', 'a1000000-3000-4000-8000-000000000011', now() - interval '2 days'),
  ('a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000001', 'a1000000-3000-4000-8000-000000000012', now() - interval '1 day');
insert into public.approval_requests (organization_id, post_id, post_version_id, invalidated_at) values
  ('a1000000-1000-4000-8000-000000000001', 'a1000000-2000-4000-8000-000000000003', 'a1000000-3000-4000-8000-000000000031', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

-- 1-3: die abgelehnte Vorversion eines freigegebenen Posts ist nicht einplanbar, die aktuelle schon.
select throws_ok(
  $$select public.schedule_publication('a1000000-3000-4000-8000-000000000011', 'a1000000-8000-4000-8000-000000000001', null)$$,
  'P0001', 'version_not_current', 'schedule_publication rejects an older version of an approved post'
);
set local role postgres;
select is(
  (select count(*)::integer from public.publications where post_version_id = 'a1000000-3000-4000-8000-000000000011'),
  0, 'no publication exists for the rejected older version'
);
set local role authenticated;
select is(
  (select status from public.schedule_publication('a1000000-3000-4000-8000-000000000012', 'a1000000-8000-4000-8000-000000000001', null)),
  'queued', 'schedule_publication still schedules the current, approved version'
);

-- 4-5: eine alte Version kann keine Freigabe fuer den Post anstossen.
select throws_ok(
  $$select public.request_approval('a1000000-3000-4000-8000-000000000021')$$,
  'P0001', 'version_not_current', 'request_approval rejects a version that is not the post''s current version'
);
select is(
  (select status::text from public.posts where id = 'a1000000-2000-4000-8000-000000000002'),
  'draft_ready', 'the post stays a draft after the rejected request for an old version'
);

-- 6: eine nach der Freigabe invalidierte Freigabe sperrt das Einplanen.
select throws_ok(
  $$select public.schedule_publication('a1000000-3000-4000-8000-000000000031', 'a1000000-8000-4000-8000-000000000001', null)$$,
  'P0001', 'approval_invalidated', 'schedule_publication rejects a version whose latest approval request was invalidated'
);

-- 7-9: der stufenlose Weg ohne Freigabeanfrage bleibt vollstaendig nutzbar.
select is(
  (select public.request_approval('a1000000-3000-4000-8000-000000000041')->>'status'),
  'approved', 'request_approval approves the current version directly when no level requires a review'
);
select is(
  (select count(*)::integer from public.approval_requests where post_version_id = 'a1000000-3000-4000-8000-000000000041'),
  0, 'the review-free path creates no approval request'
);
select is(
  (select status from public.schedule_publication('a1000000-3000-4000-8000-000000000041', 'a1000000-8000-4000-8000-000000000001', null)),
  'queued', 'schedule_publication schedules a review-free approved version without an approval request'
);

select * from finish();
rollback;
