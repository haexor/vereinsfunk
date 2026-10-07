begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

set local role postgres;

-- Paket 051, PR 3: Tarifwechsel eines Vereins, der social_media verliert, wird bei aktiven
-- Veroeffentlichungen verweigert (Trigger organization_subscriptions_module_guard).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '51020000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-subscription-guard.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('51020000-1000-4000-8000-000000000001', 'PGTAP Tarifwechsel', 'pgtap-tarifwechsel'),
  ('51020000-1000-4000-8000-000000000002', 'PGTAP Erstzuweisung', 'pgtap-erstzuweisung');
insert into public.departments (id, organization_id, name, slug) values
  ('51020000-1100-4000-8000-000000000001', '51020000-1000-4000-8000-000000000001', 'Abteilung', 'abteilung'),
  ('51020000-1100-4000-8000-000000000002', '51020000-1000-4000-8000-000000000002', 'Abteilung', 'abteilung');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('51020000-1000-4000-8000-000000000001', '51020000-0000-4000-8000-000000000001', 'organization_owner'),
  ('51020000-1000-4000-8000-000000000002', '51020000-0000-4000-8000-000000000001', 'organization_owner');

insert into public.posts (id, organization_id, department_id, status, created_by) values
  ('51020000-2000-4000-8000-000000000001', '51020000-1000-4000-8000-000000000001', '51020000-1100-4000-8000-000000000001', 'draft_ready', '51020000-0000-4000-8000-000000000001'),
  ('51020000-2000-4000-8000-000000000002', '51020000-1000-4000-8000-000000000002', '51020000-1100-4000-8000-000000000002', 'draft_ready', '51020000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type, created_by_user_id) values
  ('51020000-3000-4000-8000-000000000001', '51020000-1000-4000-8000-000000000001', '51020000-2000-4000-8000-000000000001', 1, '{}', '{}', 'user', '51020000-0000-4000-8000-000000000001'),
  ('51020000-3000-4000-8000-000000000002', '51020000-1000-4000-8000-000000000002', '51020000-2000-4000-8000-000000000002', 1, '{}', '{}', 'user', '51020000-0000-4000-8000-000000000001');
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name) values
  ('51020000-8000-4000-8000-000000000001', '51020000-1000-4000-8000-000000000001', 'instagram', 'ext-guard-1', 'SV Tarif'),
  ('51020000-8000-4000-8000-000000000002', '51020000-1000-4000-8000-000000000002', 'instagram', 'ext-guard-2', 'SV Erst');
insert into public.publications (id, organization_id, post_version_id, social_connection_id, platform, status, idempotency_key) values
  ('51020000-9000-4000-8000-000000000001', '51020000-1000-4000-8000-000000000001', '51020000-3000-4000-8000-000000000001', '51020000-8000-4000-8000-000000000001', 'instagram', 'queued', 'pub:guard:1'),
  ('51020000-9000-4000-8000-000000000002', '51020000-1000-4000-8000-000000000002', '51020000-3000-4000-8000-000000000002', '51020000-8000-4000-8000-000000000002', 'instagram', 'processing', 'pub:guard:2');

insert into public.subscription_plans (key, display_name, monthly_price_cents, storage_bytes, max_teams, max_departments, sort_order, included_modules) values
  ('pgtap_guard_social', 'Mit Social Media', 0, 1000000, null, null, 998, '{social_media,playerboard}'),
  ('pgtap_guard_board', 'Nur PlayerBoard', 0, 1000000, null, null, 999, '{playerboard}');
insert into public.organization_subscriptions (organization_id, plan_key) values
  ('51020000-1000-4000-8000-000000000001', 'pgtap_guard_social');

-- Die API schreibt organization_subscriptions ueber den Service-Client.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- 1-2: der Wechsel auf einen Tarif ohne social_media wird verweigert und aendert nichts.
select throws_ok(
  $$update public.organization_subscriptions set plan_key = 'pgtap_guard_board' where organization_id = '51020000-1000-4000-8000-000000000001'$$,
  'P0001', 'module_has_active_publications', 'losing social_media with an active publication is refused'
);
select is(
  (select plan_key from public.organization_subscriptions where organization_id = '51020000-1000-4000-8000-000000000001'),
  'pgtap_guard_social', 'the refused change keeps the previous plan'
);

-- 3: eine andere Spalte zu aendern prueft nichts.
select lives_ok(
  $$update public.organization_subscriptions set cancel_at_period_end = true where organization_id = '51020000-1000-4000-8000-000000000001'$$,
  'updating another column is not checked'
);

-- 4: auch die erste Zuweisung (INSERT, vorher schraenkte kein Tarif ein) ist geschuetzt.
select throws_ok(
  $$insert into public.organization_subscriptions (organization_id, plan_key) values ('51020000-1000-4000-8000-000000000002', 'pgtap_guard_board')$$,
  'P0001', 'module_has_active_publications', 'a first assignment without social_media is refused while publications are active'
);

-- 5-6: ohne aktive Veroeffentlichung geht der Wechsel, zurueck ohnehin.
set local role postgres;
update public.publications set status = 'published' where id = '51020000-9000-4000-8000-000000000001';
set local role service_role;
select lives_ok(
  $$update public.organization_subscriptions set plan_key = 'pgtap_guard_board' where organization_id = '51020000-1000-4000-8000-000000000001'$$,
  'losing social_media without active publications is allowed'
);
select lives_ok(
  $$update public.organization_subscriptions set plan_key = 'pgtap_guard_social' where organization_id = '51020000-1000-4000-8000-000000000001'$$,
  'gaining social_media is always allowed'
);

-- 7: ein Tarif, der social_media behaelt, ist trotz aktiver Veroeffentlichung erlaubt.
select lives_ok(
  $$insert into public.organization_subscriptions (organization_id, plan_key) values ('51020000-1000-4000-8000-000000000002', 'pgtap_guard_social')$$,
  'a first assignment that keeps social_media is allowed'
);

select * from finish();
rollback;
