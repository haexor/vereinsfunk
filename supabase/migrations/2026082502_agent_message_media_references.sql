begin;

-- Gespräche referenzieren private Anhänge ausschließlich über IDs. Die Byte-Payload bleibt im
-- privaten Storage und wird nicht in Agent-Historie oder Provider-Kontext kopiert. Eine eigene
-- Relation mit zusammengesetzten Foreign Keys verhindert auch bei Service-Role-Aufrufen
-- mandantenübergreifende Referenzen; ein UUID-Array könnte diese Invariante nicht ausdrücken.
create table public.agent_message_media_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_message_id uuid not null,
  media_asset_id uuid not null,
  position integer not null check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, agent_message_id, position),
  unique (organization_id, agent_message_id, media_asset_id),
  foreign key (organization_id, agent_message_id)
    references public.agent_messages(organization_id, id) on delete cascade,
  foreign key (organization_id, media_asset_id)
    references public.media_assets(organization_id, id) on delete restrict
);

-- Assistentenantworten dürfen nie Anhänge tragen. Die API schreibt ausschließlich über die
-- atomare Funktion unten; der Trigger hält die Regel auch für privilegierte Direktzugriffe ein.
create function public.enforce_agent_message_media_reference_role() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.agent_messages message
    where message.id = new.agent_message_id
      and message.organization_id = new.organization_id
      and message.role = 'user'
  ) then
    raise exception 'agent_message_media_reference_requires_user_message';
  end if;
  return new;
end;
$$;
create trigger agent_message_media_references_require_user_message
  before insert or update on public.agent_message_media_references
  for each row execute function public.enforce_agent_message_media_reference_role();

-- Schliesst die verbleibende Luecke des Triggers oben: der feuert nur bei Aenderungen an
-- agent_message_media_references selbst. Ohne diesen zweiten Trigger koennte ein
-- service_role-Aufruf agent_messages.role nachtraeglich von 'user' auf 'assistant' aendern und
-- die Referenz so einer Assistentenantwort zuschieben.
create function public.enforce_agent_message_role_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.role <> 'user' and exists (
    select 1 from public.agent_message_media_references reference
    where reference.agent_message_id = new.id and reference.organization_id = new.organization_id
  ) then
    raise exception 'agent_message_media_reference_requires_user_message';
  end if;
  return new;
end;
$$;
create trigger agent_messages_media_reference_role_guard
  before update of role on public.agent_messages
  for each row execute function public.enforce_agent_message_role_change();

alter table public.agent_message_media_references enable row level security;
alter table public.agent_message_media_references force row level security;
create policy agent_message_media_references_select on public.agent_message_media_references for select to authenticated
  using (exists (
    select 1 from public.agent_messages message
    join public.agent_conversations conversation
      on conversation.id = message.conversation_id
      and conversation.organization_id = message.organization_id
    where message.id = agent_message_media_references.agent_message_id
      and message.organization_id = agent_message_media_references.organization_id
      and conversation.created_by = auth.uid()
      and authz.is_any_member_of_organization(conversation.organization_id)
  ));
grant select on public.agent_message_media_references to authenticated;
grant all privileges on public.agent_message_media_references to service_role;

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

  if cardinality(coalesce(user_message_media_asset_ids, '{}'::uuid[])) > 10 then
    raise exception 'agent_message_media_reference_limit_exceeded';
  end if;

  insert into public.agent_messages (organization_id, conversation_id, role, content, retention_expires_at, created_at)
  values (conversation_row.organization_id, conversation_row.id, 'user', user_message_content,
    conversation_row.retention_expires_at, user_message_at)
  returning * into user_message_row;
  insert into public.agent_message_media_references (organization_id, agent_message_id, media_asset_id, position)
  select conversation_row.organization_id, user_message_row.id, media_asset_id, position - 1
  from unnest(coalesce(user_message_media_asset_ids, '{}'::uuid[])) with ordinality as reference(media_asset_id, position);
  insert into public.agent_messages (organization_id, conversation_id, role, content, retention_expires_at, created_at)
  values (conversation_row.organization_id, conversation_row.id, 'assistant', assistant_message_content,
    conversation_row.retention_expires_at, assistant_message_at)
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
