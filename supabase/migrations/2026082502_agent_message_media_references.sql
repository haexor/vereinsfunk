begin;

-- Gespräche referenzieren private Anhänge ausschließlich über IDs. Die Byte-Payload bleibt im
-- privaten Storage und wird nicht in Agent-Historie oder Provider-Kontext kopiert.
alter table public.agent_messages
  add column media_asset_ids uuid[] not null default '{}'::uuid[]
  check (cardinality(media_asset_ids) <= 10);

drop function if exists public.append_agent_conversation_messages(uuid, uuid, uuid, text, text);
create function public.append_agent_conversation_messages(
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
begin
  select * into conversation_row from public.agent_conversations
    where id = target_conversation_id and organization_id = target_organization_id
      and created_by = target_owner_id and archived_at is null for update;
  if not found then raise exception 'agent_conversation_not_found' using errcode = 'P0002'; end if;

  insert into public.agent_messages (organization_id, conversation_id, role, content, media_asset_ids, retention_expires_at, created_at)
  values (conversation_row.organization_id, conversation_row.id, 'user', user_message_content,
    coalesce(user_message_media_asset_ids, '{}'::uuid[]), conversation_row.retention_expires_at, user_message_at)
  returning * into user_message_row;
  insert into public.agent_messages (organization_id, conversation_id, role, content, media_asset_ids, retention_expires_at, created_at)
  values (conversation_row.organization_id, conversation_row.id, 'assistant', assistant_message_content,
    '{}'::uuid[], conversation_row.retention_expires_at, assistant_message_at)
  returning * into assistant_message_row;

  update public.agent_conversations set last_activity_at = assistant_message_at
    where id = conversation_row.id and organization_id = conversation_row.organization_id
    returning public.agent_conversations.last_activity_at into updated_activity_at;
  return query select to_jsonb(user_message_row), to_jsonb(assistant_message_row), updated_activity_at;
end;
$$;

revoke all on function public.append_agent_conversation_messages(uuid, uuid, uuid, text, uuid[], text) from public;
grant execute on function public.append_agent_conversation_messages(uuid, uuid, uuid, text, uuid[], text) to service_role;

commit;
