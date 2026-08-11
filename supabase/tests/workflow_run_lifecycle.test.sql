begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
set local role postgres;

insert into public.workflow_outbox (
  id, organization_id, department_id, workflow_name, entity_id, source_revision,
  purpose, correlation_id, payload
) values (
  '62000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'process-submission', '62000000-0000-4000-8000-000000000002', 1,
  'lifecycle-test', '62000000-0000-4000-8000-000000000003',
  '{"entityId":"62000000-0000-4000-8000-000000000002","organizationId":"11111111-1111-4111-8111-111111111111","departmentId":"22222222-2222-4222-8222-222222222222","correlationId":"62000000-0000-4000-8000-000000000003","sourceRevision":1,"purpose":"lifecycle-test","idempotencyKey":"lifecycle:1"}'::jsonb
);

select is((select count(*)::integer from public.claim_workflow_outbox(1)), 1, 'lifecycle event is claimed once');
select ok(public.acknowledge_workflow_outbox(
  '62000000-0000-4000-8000-000000000001',
  (select claim_token from public.workflow_outbox where id = '62000000-0000-4000-8000-000000000001'),
  'hatchet-run-lifecycle-1'
), 'acknowledgement atomically creates the technical run');
select is((select purpose from public.workflow_runs where hatchet_run_id = 'hatchet-run-lifecycle-1'), 'lifecycle-test', 'run retains its outbox purpose');

select is(public.begin_workflow_run(
  '11111111-1111-4111-8111-111111111111', 'process-submission',
  '62000000-0000-4000-8000-000000000002', 1, 'lifecycle-test', 'lifecycle:1'
), 'acquired', 'first delivery acquires the run');
select is((select technical_status from public.workflow_runs where hatchet_run_id = 'hatchet-run-lifecycle-1'), 'running', 'acquired run is marked running');
select is(public.begin_workflow_run(
  '11111111-1111-4111-8111-111111111111', 'process-submission',
  '62000000-0000-4000-8000-000000000002', 1, 'lifecycle-test', 'lifecycle:1'
), 'already_handled', 'second delivery cannot acquire the active lease');
select ok(public.finish_workflow_run(
  '11111111-1111-4111-8111-111111111111', 'process-submission',
  '62000000-0000-4000-8000-000000000002', 1, 'lifecycle-test', 'succeeded'
), 'worker can complete its acquired run');
select is((select technical_status from public.workflow_runs where hatchet_run_id = 'hatchet-run-lifecycle-1'), 'succeeded', 'completed run has a terminal status');
select is(public.begin_workflow_run(
  '11111111-1111-4111-8111-111111111111', 'process-submission',
  '62000000-0000-4000-8000-000000000002', 1, 'lifecycle-test', 'lifecycle:1'
), 'already_handled', 'a completed run remains idempotent after a worker restart');

set local role authenticated;
select throws_ok(
  $$select public.begin_workflow_run('11111111-1111-4111-8111-111111111111', 'process-submission', '62000000-0000-4000-8000-000000000002', 1, 'lifecycle-test', 'lifecycle:1')$$,
  '42501', null, 'members cannot acquire technical workflow runs'
);
select throws_ok(
  $$select public.finish_workflow_run('11111111-1111-4111-8111-111111111111', 'process-submission', '62000000-0000-4000-8000-000000000002', 1, 'lifecycle-test', 'cancelled')$$,
  '42501', null, 'members cannot cancel technical workflow runs'
);
set local role postgres;
select throws_ok(
  $$insert into public.workflow_outbox (organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload)
    values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'process-submission', '62000000-0000-4000-8000-000000000004', 1, 'unsafe-payload', '62000000-0000-4000-8000-000000000005', '{"caption":"never send content to Hatchet"}'::jsonb)$$,
  '23514', null, 'database rejects content-bearing workflow payloads'
);

select * from finish();
rollback;
