begin;

-- Der Agent speichert seine eigene, kurze Unterhaltung. Sie ist keine Erweiterung von posts oder
-- submissions: eine Unterhaltung darf niemals eine fachliche Freigabe, einen Workflow-Status oder
-- eine Post-Version ersetzen. Alle Tabellen sind daher strikt tenant-gebunden und enthalten nur
-- Referenzen auf Fachobjekte, nie Medien oder Provider-Geheimnisse.
create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid,
  team_id uuid,
  created_by uuid not null references public.profiles(id),
  title text check (title is null or char_length(title) between 1 and 160),
  last_activity_at timestamptz not null default now(),
  archived_at timestamptz,
  retention_expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id) references public.organizations(id) on delete cascade,
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  check (team_id is null or department_id is not null),
  check (retention_expires_at > created_at)
);
create index agent_conversations_owner_activity_idx
  on public.agent_conversations (organization_id, created_by, last_activity_at desc);
create trigger set_agent_conversations_updated_at before update on public.agent_conversations
  for each row execute function public.set_updated_at();

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, conversation_id)
    references public.agent_conversations(organization_id, id) on delete cascade,
  check (retention_expires_at > created_at)
);
create index agent_messages_conversation_created_idx
  on public.agent_messages (organization_id, conversation_id, created_at);

-- Die zwei Tabellen werden in Paket B beschrieben. Sie entstehen schon jetzt mit derselben
-- Isolation, damit ein Vorschlag spaeter nicht heimlich als ungebundener JSON-Blob neben der
-- Unterhaltung landet. Keine Browserrolle kann sie direkt schreiben.
create table public.agent_action_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  created_by uuid not null references public.profiles(id),
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{1,79}$'),
  scope_snapshot jsonb not null check (jsonb_typeof(scope_snapshot) = 'object'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  target_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(target_refs) = 'array'),
  risk_class text not null check (risk_class in ('write', 'external')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
  expires_at timestamptz not null,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, conversation_id)
    references public.agent_conversations(organization_id, id) on delete cascade,
  check (expires_at > created_at),
  check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);
create unique index agent_action_proposals_idempotency_unique
  on public.agent_action_proposals (organization_id, idempotency_key)
  where idempotency_key is not null;
create trigger set_agent_action_proposals_updated_at before update on public.agent_action_proposals
  for each row execute function public.set_updated_at();

create table public.agent_tool_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  proposal_id uuid,
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{1,79}$'),
  correlation_id uuid not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  result_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(result_refs) = 'array'),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,79}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, conversation_id)
    references public.agent_conversations(organization_id, id) on delete cascade,
  foreign key (organization_id, proposal_id)
    references public.agent_action_proposals(organization_id, id) on delete set null,
  check ((status = 'started') = (finished_at is null))
);
create index agent_tool_runs_conversation_idx
  on public.agent_tool_runs (organization_id, conversation_id, started_at desc);

-- Unterhaltungen sind privat. Auch eine Vereinsadministration sieht sie nicht automatisch: eine
-- spaetere Freigabe bzw. Support-Einsicht braucht einen expliziten, auditierten Mechanismus.
alter table public.agent_conversations enable row level security;
alter table public.agent_conversations force row level security;
create policy agent_conversations_select on public.agent_conversations for select to authenticated
  using (created_by = auth.uid() and authz.is_any_member_of_organization(organization_id));

alter table public.agent_messages enable row level security;
alter table public.agent_messages force row level security;
create policy agent_messages_select on public.agent_messages for select to authenticated
  using (exists (
    select 1 from public.agent_conversations conversation
    where conversation.id = agent_messages.conversation_id
      and conversation.organization_id = agent_messages.organization_id
      and conversation.created_by = auth.uid()
      and authz.is_any_member_of_organization(conversation.organization_id)
  ));

alter table public.agent_action_proposals enable row level security;
alter table public.agent_action_proposals force row level security;
create policy agent_action_proposals_select on public.agent_action_proposals for select to authenticated
  using (created_by = auth.uid() and exists (
    select 1 from public.agent_conversations conversation
    where conversation.id = agent_action_proposals.conversation_id
      and conversation.organization_id = agent_action_proposals.organization_id
      and conversation.created_by = auth.uid()
      and authz.is_any_member_of_organization(conversation.organization_id)
  ));

alter table public.agent_tool_runs enable row level security;
alter table public.agent_tool_runs force row level security;
create policy agent_tool_runs_select on public.agent_tool_runs for select to authenticated
  using (exists (
    select 1 from public.agent_conversations conversation
    where conversation.id = agent_tool_runs.conversation_id
      and conversation.organization_id = agent_tool_runs.organization_id
      and conversation.created_by = auth.uid()
      and authz.is_any_member_of_organization(conversation.organization_id)
  ));

grant select on public.agent_conversations, public.agent_messages, public.agent_action_proposals, public.agent_tool_runs to authenticated;
grant all privileges on public.agent_conversations, public.agent_messages, public.agent_action_proposals, public.agent_tool_runs to service_role;

commit;
