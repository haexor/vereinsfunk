begin;

-- `proposal_id` ist optional, aber Organisation und Conversation eines Tool-Runs bleiben auch
-- nach dem Loeschen des Vorschlags unveraenderlich. Die dreispaltige Referenz verhindert, dass
-- ein Run auf einen Vorschlag einer anderen Conversation desselben Mandanten zeigen kann.
alter table public.agent_action_proposals
  add constraint agent_action_proposals_organization_conversation_id_key
  unique (organization_id, conversation_id, id);

alter table public.agent_tool_runs
  drop constraint agent_tool_runs_organization_id_proposal_id_fkey,
  add constraint agent_tool_runs_proposal_scope_fkey
    foreign key (organization_id, conversation_id, proposal_id)
    references public.agent_action_proposals (organization_id, conversation_id, id)
    on delete set null (proposal_id);

-- Eine gesendete Nachricht besteht immer aus Nutzerfrage, Assistentenantwort und dem aktualisierten
-- Aktivitaetszeitpunkt. Die Funktion sperrt die private Conversation und speichert diese drei
-- Aenderungen atomar, damit ein Datenbankfehler keine halbe Unterhaltung zuruecklaesst.
create function public.append_agent_conversation_messages(
  target_organization_id uuid,
  target_conversation_id uuid,
  target_owner_id uuid,
  user_message_content text,
  assistant_message_content text
)
returns table (
  user_message jsonb,
  assistant_message jsonb,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conversation_row public.agent_conversations%rowtype;
  user_message_row public.agent_messages%rowtype;
  assistant_message_row public.agent_messages%rowtype;
  user_message_at timestamptz := clock_timestamp();
  assistant_message_at timestamptz := user_message_at + interval '1 microsecond';
  updated_activity_at timestamptz;
begin
  select * into conversation_row
  from public.agent_conversations
  where id = target_conversation_id
    and organization_id = target_organization_id
    and created_by = target_owner_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'agent_conversation_not_found' using errcode = 'P0002';
  end if;

  insert into public.agent_messages (
    organization_id, conversation_id, role, content, retention_expires_at, created_at
  ) values (
    conversation_row.organization_id, conversation_row.id, 'user', user_message_content,
    conversation_row.retention_expires_at, user_message_at
  ) returning * into user_message_row;

  insert into public.agent_messages (
    organization_id, conversation_id, role, content, retention_expires_at, created_at
  ) values (
    conversation_row.organization_id, conversation_row.id, 'assistant', assistant_message_content,
    conversation_row.retention_expires_at, assistant_message_at
  ) returning * into assistant_message_row;

  update public.agent_conversations
  set last_activity_at = assistant_message_at
  where id = conversation_row.id
    and organization_id = conversation_row.organization_id
  returning public.agent_conversations.last_activity_at into updated_activity_at;

  return query select to_jsonb(user_message_row), to_jsonb(assistant_message_row), updated_activity_at;
end;
$$;

revoke all on function public.append_agent_conversation_messages(uuid, uuid, uuid, text, text) from public;
grant execute on function public.append_agent_conversation_messages(uuid, uuid, uuid, text, text) to service_role;

commit;
