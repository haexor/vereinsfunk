begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- 2026101915: ein haengender Veo-Lauf wird ueber playerboard_veo_finish_sync abgeschlossen und zaehlt
-- damit in der Fehlerserie mit. Die Benachrichtigung bleibt dem Worker vorbehalten.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-veo-stale.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('a6000000-1000-4000-8000-000000000001', 'PGTAP Veo Haenger', 'pgtap-veo-haenger');
insert into public.departments (id, organization_id, name, slug) values
  ('a6000000-1100-4000-8000-000000000001', 'a6000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('a6000000-1200-4000-8000-000000000001', 'a6000000-1000-4000-8000-000000000001', 'a6000000-1100-4000-8000-000000000001', 'U13');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('a6000000-1000-4000-8000-000000000001', 'a6000000-1100-4000-8000-000000000001', 'a6000000-1200-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.playerboard_veo_link_team('a6000000-1200-4000-8000-000000000001', 'a6000000-2000-4000-8000-000000000001', '\x0102'::bytea, 'v1',
  'club', 'Testverein', 'u13', 'Testverein U13', 'a6000000-0000-4000-8000-000000000001');
create temporary table stale_run on commit drop as
  select * from public.enqueue_integration_sync('a6000000-1000-4000-8000-000000000001', 'a6000000-2000-4000-8000-000000000001', 'manual-stale', gen_random_uuid(), null);

-- Zwei Fehllaeufe liegen schon hinter der Verbindung; der Worker ist mitten im dritten abgestuerzt.
set local role postgres;
update public.playerboard_veo_links set consecutive_failures = 2 where team_id = 'a6000000-1200-4000-8000-000000000001';
update public.integration_sync_runs set status = 'running', started_at = now() - interval '3 hours' where id = (select run_id from stale_run);
set local role service_role;

select is(public.playerboard_veo_enqueue_scheduled_syncs(), 1, 'the daily sync frees the stale run slot and queues a new run');

set local role postgres;
select results_eq(
  $$select status, error_class from public.integration_sync_runs where id = (select run_id from stale_run)$$,
  $$values ('failed'::text, 'stale_run'::text)$$,
  'the stale run is finished as failed'
);
select results_eq(
  $$select consecutive_failures, last_error_code, failure_notified_at is null from public.playerboard_veo_links
     where team_id = 'a6000000-1200-4000-8000-000000000001'$$,
  $$values (3, 'stale_run'::text, true)$$,
  'the stale run counts as a failure, but the series stays unreported until the worker can send the mail'
);
select is((select last_sync_status from public.integration_sources where id = 'a6000000-2000-4000-8000-000000000001'), 'failed',
  'the source records the failed sync');

select * from finish();
rollback;
