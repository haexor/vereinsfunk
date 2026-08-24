begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

select is((select relforcerowsecurity from pg_class where oid = 'public.agent_conversations'::regclass), true, 'agent conversations enforce RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.agent_messages'::regclass), true, 'agent messages enforce RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.agent_conversations), 1, 'owner sees their own conversation');
select is((select count(*)::integer from public.agent_messages), 1, 'owner sees messages from their own conversation');
select throws_ok(
  $$insert into public.agent_conversations (organization_id, created_by, retention_expires_at)
    values ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days')$$,
  '42501', null, 'browser roles cannot create agent conversations directly'
);

select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.agent_conversations), 0, 'another member of the same organization cannot read a private conversation');
select is((select count(*)::integer from public.agent_messages), 0, 'another member cannot read private conversation messages');

select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.agent_conversations), 1, 'foreign owner sees only their own foreign-tenant conversation');
select is((select count(*)::integer from public.agent_messages), 0, 'foreign owner cannot read messages from another tenant');
select is((select count(*)::integer from public.agent_conversations where id = '68000000-9000-4000-8000-000000000001'), 0, 'foreign tenant conversation is invisible');

set local role postgres;
select throws_ok(
  $$insert into public.agent_conversations (organization_id, team_id, created_by, retention_expires_at)
    values ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', now() + interval '90 days')$$,
  '23514', null, 'team scope requires a department'
);

select * from finish();
rollback;
