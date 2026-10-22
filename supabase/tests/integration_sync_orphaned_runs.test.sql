begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

set local role postgres;

-- Verwaiste Veo-Abgleiche freigeben (2026102203_integration_sync_orphaned_runs.sql).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00240000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'coach@pgtap-sync-orphans.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values ('00240000-1000-4000-8000-000000000001', 'PGTAP Sync Orphans', 'pgtap-sync-orphans');
insert into public.departments (id, organization_id, name, slug) values ('00240000-1100-4000-8000-000000000001', '00240000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('00240000-1200-4000-8000-000000000001', '00240000-1000-4000-8000-000000000001', '00240000-1100-4000-8000-000000000001', 'C1');
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role) values
  ('00240000-1000-4000-8000-000000000001', '00240000-1100-4000-8000-000000000001', '00240000-1200-4000-8000-000000000001', '00240000-0000-4000-8000-000000000001', 'team_manager');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  perform public.playerboard_veo_link_team('00240000-1200-4000-8000-000000000001', '00240000-2000-4000-8000-000000000001', '\x01'::bytea, 'v1',
    'club', 'Testverein', 'c1', 'Testverein C1', '00240000-0000-4000-8000-000000000001');
end;
$$;

create temporary table first_run on commit drop as
  select * from public.enqueue_integration_sync('00240000-1000-4000-8000-000000000001', '00240000-2000-4000-8000-000000000001', 'orphan-1', gen_random_uuid(), null);

-- 1: Ein frischer Lauf ohne Worker blockiert weiter (der Dispatcher hat ihn vielleicht noch nicht zugestellt).
select is(
  (select result from public.enqueue_integration_sync('00240000-1000-4000-8000-000000000001', '00240000-2000-4000-8000-000000000001', 'orphan-2', gen_random_uuid(), null)),
  'already_running', 'a fresh run without a worker still blocks a new sync'
);

-- 2: Laeuft er seit 20 Minuten mit gueltigem Lease, arbeitet ein Worker noch daran.
set local role postgres;
update public.integration_sync_runs set started_at = now() - interval '20 minutes' where id = (select run_id from first_run);
insert into public.workflow_runs (organization_id, department_id, workflow_name, entity_id, source_revision, purpose, technical_status, attempt, correlation_id, worker_lease_until, worker_lease_token)
values ('00240000-1000-4000-8000-000000000001', '00240000-1100-4000-8000-000000000001', 'sync-integration-source', (select run_id from first_run), 1, 'default',
        'running', 1, gen_random_uuid(), now() + interval '1 minute', gen_random_uuid());
set local role service_role;
select is(
  (select result from public.enqueue_integration_sync('00240000-1000-4000-8000-000000000001', '00240000-2000-4000-8000-000000000001', 'orphan-3', gen_random_uuid(), null)),
  'already_running', 'a run whose worker still holds the lease keeps running'
);

-- 3-5: Ist der Lease abgelaufen, wird der Lauf freigegeben und ein neuer eingereiht.
set local role postgres;
update public.workflow_runs set worker_lease_until = now() - interval '5 minutes' where entity_id = (select run_id from first_run);
update public.playerboard_veo_links set consecutive_failures = 2, failure_notified_at = null
 where integration_source_id = '00240000-2000-4000-8000-000000000001';
set local role service_role;
create temporary table second_run on commit drop as
  select * from public.enqueue_integration_sync('00240000-1000-4000-8000-000000000001', '00240000-2000-4000-8000-000000000001', 'orphan-4', gen_random_uuid(), null);
select is((select result from second_run), 'acquired', 'a run no worker holds any more no longer blocks a new sync');
select results_eq(
  $$select status::text, error_class, finished_at is not null from public.integration_sync_runs where id = (select run_id from first_run)$$,
  $$values ('failed'::text, 'stale_run'::text, true)$$,
  'the orphaned run ends as stale_run'
);
select results_eq(
  $$select consecutive_failures, last_error_code, failure_notified_at is null from public.playerboard_veo_links
    where integration_source_id = '00240000-2000-4000-8000-000000000001'$$,
  $$values (3, 'stale_run'::text, true)$$,
  'the orphaned Veo run updates failure tracking without suppressing the next notification'
);
select is(
  (select last_sync_status from public.integration_sources where id = '00240000-2000-4000-8000-000000000001'),
  'failed', 'the orphaned Veo run updates the source status'
);
select is(
  (select count(*)::int from public.workflow_outbox where entity_id = (select run_id from second_run) and workflow_name = 'sync-integration-source'),
  1, 'the new run is queued for the worker'
);

-- 6: Der freigegebene Lauf und der neue sind die einzigen; der neue laeuft.
select is(
  (select array_agg(status::text order by started_at) from public.integration_sync_runs where source_id = '00240000-2000-4000-8000-000000000001'),
  array['failed', 'running'], 'exactly one sync runs afterwards'
);

select * from finish();
rollback;
