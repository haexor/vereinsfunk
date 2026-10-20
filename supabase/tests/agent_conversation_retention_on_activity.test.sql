begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- 2026101914: eine Unterhaltung, deren urspruengliche 90-Tage-Frist schon abgelaufen ist, nimmt
-- weiter Nachrichten an -- die Frist laeuft ab der letzten Aktivitaet.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'agent@pgtap-retention.local', '', '{}', '{}', now(), now());
insert into public.profiles (id, display_name) values ('a5000000-0000-4000-8000-000000000001', 'Agent Retention')
on conflict (id) do update set display_name = excluded.display_name;
insert into public.organizations (id, name, slug) values
  ('a5000000-1000-4000-8000-000000000001', 'PGTAP Agent Aufbewahrung', 'pgtap-agent-aufbewahrung');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('a5000000-1000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'organization_admin');
-- Seit 100 Tagen aktiv: die beim Anlegen gesetzte Frist (created_at + 90 Tage) liegt in der Vergangenheit.
insert into public.agent_conversations (id, organization_id, created_by, created_at, retention_expires_at) values
  ('a5000000-9000-4000-8000-000000000001', 'a5000000-1000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', now() - interval '100 days', now() - interval '10 days');

select lives_ok(
  $$select * from public.append_agent_conversation_messages(
    'a5000000-1000-4000-8000-000000000001', 'a5000000-9000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
    'Frage am Tag 100', array[]::uuid[], 'Antwort am Tag 100'
  )$$,
  'a conversation past its original retention date still accepts new messages'
);
select is((select count(*)::integer from public.agent_messages where conversation_id = 'a5000000-9000-4000-8000-000000000001'), 2,
  'both messages were stored');
select ok((select bool_and(retention_expires_at > created_at + interval '89 days') from public.agent_messages where conversation_id = 'a5000000-9000-4000-8000-000000000001'),
  'each new message is kept for the full retention period from its own creation');
select ok((select retention_expires_at > now() + interval '89 days' from public.agent_conversations where id = 'a5000000-9000-4000-8000-000000000001'),
  'the conversation retention is extended from the latest activity');

select * from finish();
rollback;
