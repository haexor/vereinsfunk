begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'agent-owner@pgtap.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'agent-colleague@pgtap.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'agent-foreign@pgtap.local', '', '{}', '{}', now(), now());
insert into public.profiles (id, display_name) values
  ('68000000-0000-4000-8000-000000000001', 'Agent Owner'),
  ('68000000-0000-4000-8000-000000000002', 'Agent Colleague'),
  ('68000000-0000-4000-8000-000000000003', 'Agent Foreign')
on conflict (id) do update set display_name = excluded.display_name;
insert into public.organizations (id, name, slug) values
  ('68000000-1000-4000-8000-000000000001', 'Agent Verein', 'agent-verein'),
  ('68000000-1000-4000-8000-000000000002', 'Agent Fremdverein', 'agent-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('68000000-1100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', 'Agent Abteilung', 'agent-abteilung');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'organization_viewer'),
  ('68000000-1000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'organization_admin');
insert into public.agent_conversations (id, organization_id, department_id, created_by, retention_expires_at)
values
  ('68000000-9000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days'),
  ('68000000-9000-4000-8000-000000000002', '68000000-1000-4000-8000-000000000002', null, '68000000-0000-4000-8000-000000000003', now() + interval '90 days');
insert into public.agent_messages (organization_id, conversation_id, role, content, retention_expires_at)
values ('68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', 'user', 'Interne Frage', now() + interval '90 days');
insert into public.agent_action_proposals (
  id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot,
  input_hash, risk_class, expires_at
) values
  ('68000000-9100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'propose_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000001"}', '{"title":"Sommerfest"}', repeat('a', 64), 'write', now() + interval '15 minutes'),
  ('68000000-9100-4000-8000-000000000002', '68000000-1000-4000-8000-000000000002', '68000000-9000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'propose_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000002"}', '{"title":"Fremdes Sommerfest"}', repeat('b', 64), 'write', now() + interval '15 minutes');
insert into public.agent_tool_runs (
  organization_id, conversation_id, proposal_id, tool_name, correlation_id, status, finished_at
) values
  ('68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-9100-4000-8000-000000000001', 'propose_event', '68000000-9200-4000-8000-000000000001', 'completed', now()),
  ('68000000-1000-4000-8000-000000000002', '68000000-9000-4000-8000-000000000002', '68000000-9100-4000-8000-000000000002', 'propose_event', '68000000-9200-4000-8000-000000000002', 'completed', now());

select is((select relforcerowsecurity from pg_class where oid = 'public.agent_conversations'::regclass), true, 'agent conversations enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_messages'::regclass), true, 'agent messages enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_action_proposals'::regclass), true, 'agent proposals enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_tool_runs'::regclass), true, 'agent tool runs enforce RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.agent_conversations), 1, 'owner sees their own conversation');
select is((select count(*)::integer from public.agent_messages), 1, 'owner sees messages from their own conversation');
select is((select count(*)::integer from public.agent_action_proposals), 1, 'owner sees proposals from their own conversation');
select is((select count(*)::integer from public.agent_tool_runs), 1, 'owner sees tool runs from their own conversation');
select throws_ok(
  $$insert into public.agent_conversations (organization_id, created_by, retention_expires_at)
    values ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days')$$,
  '42501', null, 'browser roles cannot create agent conversations directly'
);

select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.agent_conversations), 0, 'another member of the same organization cannot read a private conversation');
select is((select count(*)::integer from public.agent_messages), 0, 'another member cannot read private conversation messages');
select is((select count(*)::integer from public.agent_action_proposals), 0, 'another member cannot read private conversation proposals');
select is((select count(*)::integer from public.agent_tool_runs), 0, 'another member cannot read private conversation tool runs');

select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.agent_conversations), 1, 'foreign owner sees only their own foreign-tenant conversation');
select is((select count(*)::integer from public.agent_messages), 0, 'foreign owner cannot read messages from another tenant');
select is((select count(*)::integer from public.agent_action_proposals), 1, 'foreign owner sees only their own foreign-tenant proposal');
select is((select count(*)::integer from public.agent_tool_runs), 1, 'foreign owner sees only their own foreign-tenant tool run');
select is((select count(*)::integer from public.agent_conversations where id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant conversation is invisible');
select is((select count(*)::integer from public.agent_action_proposals where conversation_id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant proposal is invisible');
select is((select count(*)::integer from public.agent_tool_runs where conversation_id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant tool run is invisible');

set local role postgres;
delete from public.agent_action_proposals where id = '68000000-9100-4000-8000-000000000001';
select is(
  (select proposal_id is null from public.agent_tool_runs where correlation_id = '68000000-9200-4000-8000-000000000001'),
  true,
  'deleting a proposal preserves the tool run scope and clears only proposal_id'
);
select lives_ok(
  $$select * from public.append_agent_conversation_messages(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    'Atomare Nutzerfrage',
    'Atomare Assistentenantwort'
  )$$,
  'atomic function stores both conversation messages'
);
select is((select count(*)::integer from public.agent_messages where conversation_id = '68000000-9000-4000-8000-000000000001'), 3, 'atomic function stored both messages');
select throws_ok(
  $$select * from public.append_agent_conversation_messages(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    'Darf nicht einzeln gespeichert werden',
    repeat('x', 8001)
  )$$,
  '23514', null, 'invalid assistant message rolls back the user message'
);
select is((select count(*)::integer from public.agent_messages where conversation_id = '68000000-9000-4000-8000-000000000001'), 3, 'failed atomic write leaves no partial user message');
select throws_ok(
  $$insert into public.agent_conversations (organization_id, team_id, created_by, retention_expires_at)
    values ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days')$$,
  '23514', null, 'team scope requires a department'
);

select * from finish();
rollback;
