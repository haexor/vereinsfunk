begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
set local role postgres;

insert into public.workflow_outbox (id, organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload)
values ('61000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'process-submission', '61000000-0000-4000-8000-000000000002', 1, 'dispatch-test', '61000000-0000-4000-8000-000000000003', '{"entityId":"61000000-0000-4000-8000-000000000002","organizationId":"11111111-1111-4111-8111-111111111111","departmentId":"22222222-2222-4222-8222-222222222222","departmentConcurrencyKey":"22222222-2222-4222-8222-222222222222","correlationId":"61000000-0000-4000-8000-000000000003","sourceRevision":1,"purpose":"dispatch-test","idempotencyKey":"dispatch:1"}');
select is((select count(*)::integer from public.claim_workflow_outbox(1)), 1, 'pending event is atomically claimed');
select is((select status from public.workflow_outbox where id = '61000000-0000-4000-8000-000000000001'), 'dispatching', 'claim precedes network dispatch');
select ok((select claim_token is not null from public.workflow_outbox where id = '61000000-0000-4000-8000-000000000001'), 'claim receives an ownership token');
select is(public.acknowledge_workflow_outbox('61000000-0000-4000-8000-000000000001', (select claim_token from public.workflow_outbox where id = '61000000-0000-4000-8000-000000000001'), 'hatchet-run-test-1'), true, 'accepted run is acknowledged by its claim owner');
select is((select hatchet_run_id from public.workflow_runs where entity_id = '61000000-0000-4000-8000-000000000002'), 'hatchet-run-test-1', 'run mapping is persisted');

insert into public.workflow_outbox (id, organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload)
values ('61000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'process-submission', '61000000-0000-4000-8000-000000000005', 1, 'retry-test', '61000000-0000-4000-8000-000000000006', '{"entityId":"61000000-0000-4000-8000-000000000005","organizationId":"11111111-1111-4111-8111-111111111111","departmentId":"22222222-2222-4222-8222-222222222222","departmentConcurrencyKey":"22222222-2222-4222-8222-222222222222","correlationId":"61000000-0000-4000-8000-000000000006","sourceRevision":1,"purpose":"retry-test","idempotencyKey":"retry:1"}');
select lives_ok($$select public.claim_workflow_outbox(1)$$, 'second event can be claimed');
select is(public.release_workflow_outbox('61000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000000', 'network_error'), false, 'stale dispatcher cannot release a newer claim');
select is(public.release_workflow_outbox('61000000-0000-4000-8000-000000000004', (select claim_token from public.workflow_outbox where id = '61000000-0000-4000-8000-000000000004'), 'network_error'), true, 'claim owner returns failed dispatch to pending retry state');
rollback;
