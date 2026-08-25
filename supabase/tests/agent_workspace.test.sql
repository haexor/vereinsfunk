begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

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
  ('68000000-1100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', 'Agent Abteilung', 'agent-abteilung'),
  ('68000000-1100-4000-8000-000000000002', '68000000-1000-4000-8000-000000000002', 'Agent Fremdabteilung', 'agent-fremdabteilung');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'organization_viewer'),
  ('68000000-1000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'organization_admin');
insert into public.agent_conversations (id, organization_id, department_id, created_by, retention_expires_at)
values
  ('68000000-9000-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days'),
  ('68000000-9000-4000-8000-000000000002', '68000000-1000-4000-8000-000000000002', null, '68000000-0000-4000-8000-000000000003', now() + interval '90 days');
insert into public.agent_messages (id, organization_id, conversation_id, role, content, retention_expires_at)
values ('68000000-9300-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', 'user', 'Interne Frage', now() + interval '90 days');
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, created_by) values
  ('68000000-9400-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/agent/attachments/local.jpg', 'image/jpeg', 1, '68000000-0000-4000-8000-000000000001'),
  ('68000000-9400-4000-8000-000000000002', '68000000-1000-4000-8000-000000000002', '68000000-1100-4000-8000-000000000002', 'raw-media', 'organizations/agent/attachments/foreign.jpg', 'image/jpeg', 1, '68000000-0000-4000-8000-000000000003');
insert into public.agent_message_media_references (organization_id, agent_message_id, media_asset_id, position)
values ('68000000-1000-4000-8000-000000000001', '68000000-9300-4000-8000-000000000001', '68000000-9400-4000-8000-000000000001', 0);
insert into public.agent_action_proposals (
  id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot,
  input_hash, risk_class, expires_at
) values
  ('68000000-9100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'create_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000001"}', '{"title":"Sommerfest","description":null,"category":"other","startsAt":"2026-09-01T10:00:00.000Z","endsAt":null,"allDay":false,"locationName":null,"locationAddress":null,"registrationUrl":null}', repeat('a', 64), 'write', now() + interval '15 minutes'),
  ('68000000-9100-4000-8000-000000000002', '68000000-1000-4000-8000-000000000002', '68000000-9000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'create_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000002"}', '{"title":"Fremdes Sommerfest","description":null,"category":"other","startsAt":"2026-09-01T10:00:00.000Z","endsAt":null,"allDay":false,"locationName":null,"locationAddress":null,"registrationUrl":null}', repeat('b', 64), 'write', now() + interval '15 minutes');
insert into public.agent_tool_runs (
  organization_id, conversation_id, proposal_id, tool_name, correlation_id, status, finished_at
) values
  ('68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-9100-4000-8000-000000000001', 'create_event', '68000000-9200-4000-8000-000000000001', 'completed', now()),
  ('68000000-1000-4000-8000-000000000002', '68000000-9000-4000-8000-000000000002', '68000000-9100-4000-8000-000000000002', 'create_event', '68000000-9200-4000-8000-000000000002', 'completed', now());

select is((select relforcerowsecurity from pg_class where oid = 'public.agent_conversations'::regclass), true, 'agent conversations enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_messages'::regclass), true, 'agent messages enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_message_media_references'::regclass), true, 'agent message media references enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_action_proposals'::regclass), true, 'agent proposals enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_tool_runs'::regclass), true, 'agent tool runs enforce RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.agent_conversations), 1, 'owner sees their own conversation');
select is((select count(*)::integer from public.agent_messages), 1, 'owner sees messages from their own conversation');
select is((select count(*)::integer from public.agent_message_media_references), 1, 'owner sees references from their own conversation');
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
select is((select count(*)::integer from public.agent_message_media_references), 0, 'another member cannot read private conversation media references');
select is((select count(*)::integer from public.agent_action_proposals), 0, 'another member cannot read private conversation proposals');
select is((select count(*)::integer from public.agent_tool_runs), 0, 'another member cannot read private conversation tool runs');

select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.agent_conversations), 1, 'foreign owner sees only their own foreign-tenant conversation');
select is((select count(*)::integer from public.agent_messages), 0, 'foreign owner cannot read messages from another tenant');
select is((select count(*)::integer from public.agent_message_media_references), 0, 'foreign owner cannot read media references from another tenant');
select is((select count(*)::integer from public.agent_action_proposals), 1, 'foreign owner sees only their own foreign-tenant proposal');
select is((select count(*)::integer from public.agent_tool_runs), 1, 'foreign owner sees only their own foreign-tenant tool run');
select is((select count(*)::integer from public.agent_conversations where id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant conversation is invisible');
select is((select count(*)::integer from public.agent_action_proposals where conversation_id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant proposal is invisible');
select is((select count(*)::integer from public.agent_tool_runs where conversation_id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant tool run is invisible');

set local role postgres;
-- Muss (organization_id, agent_message_id) zum tatsaechlichen Verein der Nachricht passen, sonst
-- feuert enforce_agent_message_media_reference_role() zuerst (P0001) -- dessen EXISTS-Check
-- verlangt exakt dieselbe (id, organization_id)-Uebereinstimmung wie die erste zusammengesetzte FK,
-- die also nie isoliert erreichbar ist. Der media_asset_id-Grenzfall bleibt der einzige Weg, die
-- zusammengesetzte FK selbst zu treffen.
select throws_ok(
  $$insert into public.agent_message_media_references (organization_id, agent_message_id, media_asset_id, position)
    values ('68000000-1000-4000-8000-000000000001', '68000000-9300-4000-8000-000000000001', '68000000-9400-4000-8000-000000000002', 1)$$,
  '23503', null, 'composite foreign key rejects a media reference across organizations'
);
insert into public.agent_messages (id, organization_id, conversation_id, role, content, retention_expires_at)
values ('68000000-9300-4000-8000-000000000002', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', 'assistant', 'Interne Antwort', now() + interval '90 days');
select throws_ok(
  $$insert into public.agent_message_media_references (organization_id, agent_message_id, media_asset_id, position)
    values ('68000000-1000-4000-8000-000000000001', '68000000-9300-4000-8000-000000000002', '68000000-9400-4000-8000-000000000001', 0)$$,
  'P0001', 'agent_message_media_reference_requires_user_message', 'assistant messages cannot carry media references'
);
select throws_ok(
  $$update public.agent_messages set role = 'assistant' where id = '68000000-9300-4000-8000-000000000001'$$,
  'P0001', 'agent_message_media_reference_requires_user_message', 'changing a referenced message to assistant is rejected'
);

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
    array[]::uuid[],
    'Atomare Assistentenantwort'
  )$$,
  'atomic function stores both conversation messages'
);
-- 4, nicht 2 + die beiden neuen: 'Interne Frage' (Fixture) und 'Interne Antwort' (oben, fuer den
-- Rollen-Test) stehen zu diesem Zeitpunkt schon in derselben Unterhaltung.
select is((select count(*)::integer from public.agent_messages where conversation_id = '68000000-9000-4000-8000-000000000001'), 4, 'atomic function stored both messages');
select throws_ok(
  $$select * from public.append_agent_conversation_messages(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    'Darf nicht einzeln gespeichert werden',
    array[]::uuid[],
    repeat('x', 8001)
  )$$,
  '23514', null, 'invalid assistant message rolls back the user message'
);
select is((select count(*)::integer from public.agent_messages where conversation_id = '68000000-9000-4000-8000-000000000001'), 4, 'failed atomic write leaves no partial user message');
select lives_ok(
  $$select * from public.append_agent_conversation_messages(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    'Mit Anhang',
    array['68000000-9400-4000-8000-000000000001']::uuid[],
    'Antwort mit Anhang'
  )$$,
  'atomic function stores a media reference for the new user message'
);
select is(
  (select count(*)::integer from public.agent_message_media_references
    where media_asset_id = '68000000-9400-4000-8000-000000000001'
      and agent_message_id in (select id from public.agent_messages where content = 'Mit Anhang')),
  1,
  'atomic function persisted the media reference row'
);
select throws_ok(
  $$select * from public.append_agent_conversation_messages(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    'Zu viele Anhaenge',
    (select array_agg(gen_random_uuid()) from generate_series(1, 11)),
    'Sollte nie gespeichert werden'
  )$$,
  'P0001', 'agent_message_media_reference_limit_exceeded', 'atomic function rejects more than ten media references'
);
select throws_ok(
  $$insert into public.agent_conversations (organization_id, team_id, created_by, retention_expires_at)
    values ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days')$$,
  '23514', null, 'team scope requires a department'
);

insert into public.agent_action_proposals (
  id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot,
  input_hash, risk_class, expires_at, created_at
) values
  ('68000000-9100-4000-8000-000000000003', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'create_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000001"}', '{"title":"Atomarer Termin"}', repeat('c', 64), 'write', now() + interval '15 minutes', now()),
  ('68000000-9100-4000-8000-000000000004', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'create_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000001"}', '{"title":"Abgelaufener Termin"}', repeat('d', 64), 'write', now() - interval '1 minute', now() - interval '2 minutes');
select lives_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9100-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000001'
  )$$,
  'claim atomically reserves a pending proposal'
);
select is(
  (select status from public.agent_action_proposals where id = '68000000-9100-4000-8000-000000000003'),
  'executing',
  'claimed proposal is executing'
);
select throws_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9100-4000-8000-000000000003',
    '68000000-0000-4000-8000-000000000001'
  )$$,
  'P0002', 'agent_proposal_not_pending',
  'a second claim cannot execute the proposal again'
);
select lives_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9100-4000-8000-000000000004',
    '68000000-0000-4000-8000-000000000001'
  )$$,
  'claiming an expired proposal is safe'
);
select is(
  (select status from public.agent_action_proposals where id = '68000000-9100-4000-8000-000000000004'),
  'expired',
  'expired proposal cannot enter execution'
);
insert into public.agent_action_proposals (
  id, organization_id, conversation_id, created_by, tool_name, scope_snapshot, input_snapshot,
  input_hash, risk_class, expires_at, created_at
) values
  ('68000000-9100-4000-8000-000000000005', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'create_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000001"}', '{"title":"Fremdzugriff"}', repeat('e', 64), 'write', now() + interval '15 minutes', now()),
  ('68000000-9100-4000-8000-000000000006', '68000000-1000-4000-8000-000000000001', '68000000-9000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'create_event',
   '{"organizationId":"68000000-1000-4000-8000-000000000001"}', '{"title":"Recovery"}', repeat('f', 64), 'write', now() + interval '15 minutes', now());
select throws_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000002',
    '68000000-9100-4000-8000-000000000005',
    '68000000-0000-4000-8000-000000000001'
  )$$,
  'P0002', 'agent_proposal_not_pending',
  'a foreign organization cannot claim the proposal'
);
select throws_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9100-4000-8000-000000000005',
    '68000000-0000-4000-8000-000000000003'
  )$$,
  'P0002', 'agent_proposal_not_pending',
  'a foreign owner cannot claim the proposal'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9100-4000-8000-000000000005',
    '68000000-0000-4000-8000-000000000001'
  )$$,
  '42501', null, 'browser roles cannot claim proposals'
);
set local role postgres;
update public.agent_action_proposals set execution_started_at = now() - interval '16 minutes' where id = '68000000-9100-4000-8000-000000000003';
select lives_ok(
  $$select * from public.claim_agent_action_proposal(
    '68000000-1000-4000-8000-000000000001',
    '68000000-9100-4000-8000-000000000006',
    '68000000-0000-4000-8000-000000000001'
  )$$,
  'claim recovers stale execution before reserving a new proposal'
);
select is(
  (select status from public.agent_action_proposals where id = '68000000-9100-4000-8000-000000000003'),
  'failed',
  'stale execution is marked failed for recovery'
);

select * from finish();
rollback;
