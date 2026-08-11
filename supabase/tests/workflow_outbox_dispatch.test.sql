begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
set local role postgres;
insert into public.workflow_outbox (id, organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload)
values ('61000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'process-submission', '61000000-0000-4000-8000-000000000002', 1, 'dispatch-test', '61000000-0000-4000-8000-000000000003', '{}');
select is((select count(*)::integer from public.claim_workflow_outbox(1)), 1, 'pending event is atomically claimed');
select is((select status from public.workflow_outbox where id = '61000000-0000-4000-8000-000000000001'), 'dispatching', 'claim precedes network dispatch');
select is(public.acknowledge_workflow_outbox('61000000-0000-4000-8000-000000000001', 'hatchet-run-test-1'), true, 'accepted run is acknowledged');
select is((select hatchet_run_id from public.workflow_runs where entity_id = '61000000-0000-4000-8000-000000000002'), 'hatchet-run-test-1', 'run mapping is persisted');
insert into public.workflow_outbox (id, organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload)
values ('61000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'process-submission', '61000000-0000-4000-8000-000000000005', 1, 'retry-test', '61000000-0000-4000-8000-000000000006', '{}');
select lives_ok($$select public.claim_workflow_outbox(1)$$, 'second event can be claimed');
select is(public.release_workflow_outbox('61000000-0000-4000-8000-000000000004', 'network_error'), true, 'failed dispatch returns to pending retry state');
rollback;
