begin;

-- agent_messages uebernahmen die feste retention_expires_at ihrer Unterhaltung (created_at + 90
-- Tage) und muessen check (retention_expires_at > created_at) erfuellen. Ab Tag 91 einer aktiven
-- Unterhaltung scheiterte deshalb JEDE neue Nachricht am CHECK -- erst nach dem bereits bezahlten
-- LLM-Aufruf, als 500. Die Aufbewahrung laeuft jetzt ab der letzten Aktivitaet: jede neue Nachricht
-- bekommt ihr eigenes Ende (Zeitpunkt + 90 Tage), und die Unterhaltung wird mindestens bis dorthin
-- verlaengert. Aeltere Nachrichten behalten ihr frueheres Ende.
create or replace function public.append_agent_conversation_messages(
  target_organization_id uuid,
  target_conversation_id uuid,
  target_owner_id uuid,
  user_message_content text,
  user_message_media_asset_ids uuid[],
  assistant_message_content text
)
returns table (user_message jsonb, assistant_message jsonb, last_activity_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  conversation_row public.agent_conversations%rowtype;
  user_message_row public.agent_messages%rowtype;
  assistant_message_row public.agent_messages%rowtype;
  user_message_at timestamptz := clock_timestamp();
  assistant_message_at timestamptz := user_message_at + interval '1 microsecond';
  updated_activity_at timestamptz;
  -- Dieselbe Frist wie der Spaltenstandard von agent_conversations (2026082404), ab jetzt gerechnet.
  retention_until timestamptz := assistant_message_at + interval '90 days';
begin
  select * into conversation_row from public.agent_conversations
    where id = target_conversation_id and organization_id = target_organization_id
      and created_by = target_owner_id and archived_at is null for update;
  if not found then raise exception 'agent_conversation_not_found' using errcode = 'P0002'; end if;

  if cardinality(coalesce(user_message_media_asset_ids, '{}'::uuid[])) > 10 then
    raise exception 'agent_message_media_reference_limit_exceeded';
  end if;
  retention_until := greatest(conversation_row.retention_expires_at, retention_until);

  insert into public.agent_messages (organization_id, conversation_id, role, content, retention_expires_at, created_at)
  values (conversation_row.organization_id, conversation_row.id, 'user', user_message_content,
    retention_until, user_message_at)
  returning * into user_message_row;
  insert into public.agent_message_media_references (organization_id, agent_message_id, media_asset_id, position)
  select conversation_row.organization_id, user_message_row.id, media_asset_id, position - 1
  from unnest(coalesce(user_message_media_asset_ids, '{}'::uuid[])) with ordinality as reference(media_asset_id, position);
  insert into public.agent_messages (organization_id, conversation_id, role, content, retention_expires_at, created_at)
  values (conversation_row.organization_id, conversation_row.id, 'assistant', assistant_message_content,
    retention_until, assistant_message_at)
  returning * into assistant_message_row;

  update public.agent_conversations set last_activity_at = assistant_message_at, retention_expires_at = retention_until
    where id = conversation_row.id and organization_id = conversation_row.organization_id
    returning public.agent_conversations.last_activity_at into updated_activity_at;
  return query select to_jsonb(user_message_row), to_jsonb(assistant_message_row), updated_activity_at;
end;
$$;

commit;
