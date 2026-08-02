begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists authz;
revoke all on schema authz from public;
grant usage on schema authz to authenticated, service_role;

create type public.organization_role as enum (
  'organization_owner', 'organization_admin', 'social_manager',
  'billing_admin', 'organization_viewer'
);
create type public.department_role as enum (
  'department_admin', 'editor', 'approver', 'contributor', 'viewer'
);
create type public.team_role as enum ('team_manager', 'contributor', 'viewer');
create type public.post_status as enum (
  'draft', 'facts_required', 'generating', 'draft_ready', 'render_queued',
  'rendering', 'awaiting_approval', 'changes_requested', 'approved',
  'scheduled', 'publishing', 'published', 'partially_published', 'failed',
  'cancelled'
);
create type public.approval_decision_type as enum ('approved', 'changes_requested', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'Europe/Berlin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, department_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, role)
);

create table public.department_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.department_role not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, user_id, role),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.team_role not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, user_id, role),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid,
  email text not null check (email = lower(email)),
  role text not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id)
);

create table public.organization_brand_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  logo_path text,
  primary_color text not null default '#163a2c' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color text not null default '#caff4a' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  tone text not null default 'nahbar',
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid,
  content_type text not null check (content_type in ('match_result', 'match_announcement', 'member_recruitment', 'event')),
  status public.post_status not null default 'draft',
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  source_revision integer not null default 1 check (source_revision > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid,
  submission_id uuid,
  status public.post_status not null default 'draft',
  current_version_id uuid,
  created_by uuid not null references public.profiles(id),
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id),
  foreign key (organization_id, submission_id)
    references public.submissions(organization_id, id)
);

create table public.post_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  post_id uuid not null,
  version_number integer not null check (version_number > 0),
  source_facts_snapshot jsonb not null check (jsonb_typeof(source_facts_snapshot) = 'object'),
  effective_config_snapshot jsonb not null check (jsonb_typeof(effective_config_snapshot) = 'object'),
  title text not null default '',
  caption text not null default '',
  call_to_action text not null default '',
  hashtags text[] not null default '{}',
  alt_text text not null default '',
  safety_flags text[] not null default '{}',
  created_by_type text not null check (created_by_type in ('user', 'system', 'llm')),
  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (post_id, version_number),
  foreign key (organization_id, post_id)
    references public.posts(organization_id, id) on delete cascade
);

alter table public.posts
  add constraint posts_current_version_fk
  foreign key (organization_id, current_version_id)
  references public.post_versions(organization_id, id)
  deferrable initially deferred;

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  post_id uuid not null,
  post_version_id uuid not null,
  required_approvals integer not null default 1 check (required_approvals > 0),
  requires_minor_approval boolean not null default false,
  expires_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, post_id)
    references public.posts(organization_id, id) on delete cascade,
  foreign key (organization_id, post_version_id)
    references public.post_versions(organization_id, id) on delete restrict
);

create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_request_id uuid not null,
  post_version_id uuid not null,
  decided_by uuid not null references public.profiles(id),
  decision public.approval_decision_type not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (approval_request_id, decided_by),
  foreign key (organization_id, approval_request_id)
    references public.approval_requests(organization_id, id) on delete cascade,
  foreign key (organization_id, post_version_id)
    references public.post_versions(organization_id, id) on delete restrict
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  result_reference text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function authz.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
  );
$$;

create or replace function authz.is_department_member(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.department_memberships membership
    where membership.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
  ) or exists (
    select 1 from public.departments department
    where department.id = target_department_id
      and authz.is_organization_member(department.organization_id)
  );
$$;

create or replace function authz.has_organization_permission(target_organization_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'organization_owner' then true
        when 'organization_admin' then permission <> 'billing.manage'
        when 'social_manager' then permission = any(array['post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','analytics.view'])
        when 'billing_admin' then permission = any(array['billing.manage','analytics.view'])
        when 'organization_viewer' then permission = 'analytics.view'
      end
  );
$$;

create or replace function authz.has_department_permission(target_department_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.department_memberships membership
    where membership.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'department_admin' then permission = any(array['department.manage','member.invite','post.create','post.edit','post.submit','post.approve','post.publish','analytics.view'])
        when 'editor' then permission = any(array['post.create','post.edit','post.submit','analytics.view'])
        when 'approver' then permission = any(array['post.approve','analytics.view'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.departments department
    where department.id = target_department_id
      and authz.has_organization_permission(department.organization_id, permission)
  );
$$;

create or replace function authz.can_approve_post_version(target_post_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.post_versions version
    join public.posts post on post.id = version.post_id and post.organization_id = version.organization_id
    where version.id = target_post_version_id
      and authz.has_department_permission(post.department_id, 'post.approve')
  );
$$;

revoke all on all functions in schema authz from public;
grant execute on function authz.is_organization_member(uuid) to authenticated, service_role;
grant execute on function authz.is_department_member(uuid) to authenticated, service_role;
grant execute on function authz.has_organization_permission(uuid, text) to authenticated, service_role;
grant execute on function authz.has_department_permission(uuid, text) to authenticated, service_role;
grant execute on function authz.can_approve_post_version(uuid) to authenticated, service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','organizations','departments','teams','organization_memberships',
    'department_memberships','team_memberships','invitations','organization_brand_profiles',
    'submissions','posts','post_versions','approval_requests','approval_decisions',
    'idempotency_keys','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy organizations_select_member on public.organizations for select to authenticated using (authz.is_organization_member(id));
create policy departments_select_member on public.departments for select to authenticated using (authz.is_department_member(id));
create policy teams_select_member on public.teams for select to authenticated using (authz.is_department_member(department_id));

create policy organization_memberships_select on public.organization_memberships for select to authenticated
  using (user_id = auth.uid() or authz.has_organization_permission(organization_id, 'organization.manage'));
create policy department_memberships_select on public.department_memberships for select to authenticated
  using (user_id = auth.uid() or authz.has_department_permission(department_id, 'department.manage'));
create policy team_memberships_select on public.team_memberships for select to authenticated
  using (user_id = auth.uid() or authz.has_department_permission(department_id, 'department.manage'));

create policy invitations_select_admin on public.invitations for select to authenticated
  using (authz.has_organization_permission(organization_id, 'member.invite') or (department_id is not null and authz.has_department_permission(department_id, 'member.invite')));

create policy brand_profiles_select on public.organization_brand_profiles for select to authenticated using (authz.is_organization_member(organization_id));
create policy brand_profiles_update on public.organization_brand_profiles for update to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'))
  with check (authz.has_organization_permission(organization_id, 'organization.manage'));

create policy submissions_select on public.submissions for select to authenticated using (authz.is_department_member(department_id));
create policy submissions_insert on public.submissions for insert to authenticated
  with check (created_by = auth.uid() and authz.has_department_permission(department_id, 'post.create'));
create policy submissions_update on public.submissions for update to authenticated
  using (authz.has_department_permission(department_id, 'post.edit'))
  with check (authz.has_department_permission(department_id, 'post.edit'));

create policy posts_select on public.posts for select to authenticated using (authz.is_department_member(department_id));
create policy post_versions_select on public.post_versions for select to authenticated
  using (authz.is_organization_member(organization_id));
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (authz.is_organization_member(organization_id));
create policy approval_decisions_select on public.approval_decisions for select to authenticated
  using (authz.is_organization_member(organization_id));
create policy approval_decisions_insert on public.approval_decisions for insert to authenticated
  with check (decided_by = auth.uid() and authz.can_approve_post_version(post_version_id));

create policy audit_events_select on public.audit_events for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','organizations','departments','teams','organization_memberships',
    'department_memberships','team_memberships','invitations','organization_brand_profiles',
    'submissions','posts','approval_requests','idempotency_keys'
  ] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

create index departments_organization_idx on public.departments(organization_id);
create index teams_department_idx on public.teams(organization_id, department_id);
create index organization_memberships_user_idx on public.organization_memberships(user_id, organization_id);
create index department_memberships_user_idx on public.department_memberships(user_id, department_id);
create index submissions_scope_idx on public.submissions(organization_id, department_id, created_at desc);
create index posts_scope_status_idx on public.posts(organization_id, department_id, status, created_at desc);
create index audit_events_scope_idx on public.audit_events(organization_id, created_at desc);

comment on table public.post_versions is 'Immutable content snapshots. Updates are intentionally not exposed by RLS.';
comment on table public.audit_events is 'Append-only audit trail. Inserts happen through privileged API procedures.';

commit;
