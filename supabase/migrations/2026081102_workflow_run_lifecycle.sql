begin;

-- A workflow run has one purpose per source revision. Existing active runs must map to exactly
-- one durable outbox entry before they can be resumed; ambiguous runs are stopped for an operator
-- to resolve rather than silently receiving an unrelated default purpose.
alter table public.workflow_runs add column purpose text;
alter table public.workflow_runs add column worker_lease_until timestamptz;
alter table public.workflow_runs add column worker_lease_token uuid;

do $$
begin
  if exists (
    select 1
    from public.workflow_runs run
    where run.technical_status in ('queued', 'running', 'failed')
      and (
        select count(*)
        from public.workflow_outbox outbox
        where outbox.organization_id = run.organization_id
          and outbox.workflow_name = run.workflow_name
          and outbox.entity_id = run.entity_id
          and outbox.source_revision = run.source_revision
      ) <> 1
  ) then
    raise exception 'cannot derive a unique workflow purpose for an active run; stop and reschedule the affected runs';
  end if;

  update public.workflow_runs run
  set purpose = outbox.purpose
  from public.workflow_outbox outbox
  where run.technical_status in ('queued', 'running', 'failed')
    and outbox.organization_id = run.organization_id
    and outbox.workflow_name = run.workflow_name
    and outbox.entity_id = run.entity_id
    and outbox.source_revision = run.source_revision;

  -- Terminal historical rows are never resumed. A per-row legacy purpose preserves their audit
  -- trail without fabricating a relationship to a current outbox entry.
  update public.workflow_runs
  set purpose = 'legacy-terminal:' || id::text
  where purpose is null;
end;
$$;

alter table public.workflow_runs alter column purpose set default 'default';
alter table public.workflow_runs alter column purpose set not null;
commit;

-- The pre-existing four-column constraint remains in place while this index is built. Attaching
-- it before dropping the old constraint avoids a window without uniqueness enforcement.
create unique index concurrently workflow_runs_execution_unique_idx
  on public.workflow_runs (organization_id, workflow_name, entity_id, source_revision, purpose);
create index workflow_runs_recovery_idx on public.workflow_runs (technical_status, worker_lease_until)
  where technical_status in ('queued', 'running', 'failed');

begin;
-- PostgreSQL truncates the automatically generated name from the original migration.
alter table public.workflow_runs add constraint workflow_runs_execution_unique
  unique using index workflow_runs_execution_unique_idx;
alter table public.workflow_runs drop constraint if exists workflow_runs_organization_id_workflow_name_entity_id_sourc_key;

-- Hatchet is not a storage location for briefs, media or provider data. This mirrors the Zod
-- contract at the persistence boundary so a bypassing writer cannot smuggle content into it.
create or replace function public.is_id_only_workflow_payload(value jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(value) = 'object'
    and value ?& array['entityId', 'organizationId', 'departmentId', 'correlationId', 'sourceRevision', 'purpose', 'idempotencyKey']
    and not exists (
      select 1 from jsonb_object_keys(value) as key
      where key not in ('submissionId', 'entityId', 'organizationId', 'departmentId', 'teamId', 'correlationId', 'sourceRevision', 'purpose', 'idempotencyKey')
    )
    and coalesce((value->>'entityId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and coalesce((value->>'organizationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and coalesce((value->>'departmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and coalesce((value->>'correlationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and (not value ? 'submissionId' or (jsonb_typeof(value->'submissionId') = 'string' and coalesce((value->>'submissionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and (not value ? 'teamId' or (jsonb_typeof(value->'teamId') = 'string' and coalesce((value->>'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and jsonb_typeof(value->'sourceRevision') = 'number' and (value->>'sourceRevision') ~ '^[1-9][0-9]*$'
    and jsonb_typeof(value->'purpose') = 'string' and value->>'purpose' = btrim(value->>'purpose') and char_length(value->>'purpose') between 1 and 80
    and jsonb_typeof(value->'idempotencyKey') = 'string' and char_length(value->>'idempotencyKey') between 1 and 240;
$$;
alter table public.workflow_outbox add constraint workflow_outbox_id_only_payload_check
  check (public.is_id_only_workflow_payload(payload)) not valid;
alter table public.workflow_outbox validate constraint workflow_outbox_id_only_payload_check;

-- Dispatch acknowledgement and technical run creation are one transaction. A very fast Hatchet
-- worker can briefly arrive before this acknowledgement; its handler treats the missing mapping
-- as retryable instead of performing an untracked action.
create or replace function public.acknowledge_workflow_outbox(p_outbox_id uuid, p_claim_token uuid, p_hatchet_run_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed public.workflow_outbox%rowtype;
begin
  update public.workflow_outbox
  set status = 'dispatched', dispatched_at = now(), claim_token = null, updated_at = now(), last_error_class = null
  where id = p_outbox_id and status = 'dispatching' and claim_token = p_claim_token
  returning * into claimed;
  if not found then return false; end if;

  insert into public.workflow_runs (
    organization_id, department_id, workflow_name, entity_id, source_revision, purpose,
    hatchet_run_id, technical_status, correlation_id
  ) values (
    claimed.organization_id, claimed.department_id, claimed.workflow_name, claimed.entity_id,
    claimed.source_revision, claimed.purpose, p_hatchet_run_id, 'queued', claimed.correlation_id
  ) on conflict (organization_id, workflow_name, entity_id, source_revision, purpose) do update
    set hatchet_run_id = excluded.hatchet_run_id,
        technical_status = case when public.workflow_runs.technical_status in ('succeeded', 'cancelled', 'action_required')
          then public.workflow_runs.technical_status else 'queued' end,
        updated_at = now();
  return true;
end;
$$;

-- The lease token is the restart-safe CAS: exactly one delivery owns the technical action at a
-- time; a killed process becomes recoverable when its bounded lease expires.
create or replace function public.begin_workflow_run(
  p_organization_id uuid, p_workflow_name text, p_entity_id uuid, p_source_revision integer,
  p_purpose text, p_idempotency_key text, p_lease_seconds integer default 120
)
returns table(status text, lease_token uuid) language plpgsql security definer set search_path = public, pg_temp as $$
declare acquired_lease_token uuid;
begin
  if p_purpose is null or p_purpose <> btrim(p_purpose) or char_length(p_purpose) not between 1 and 80 then
    raise exception 'invalid workflow purpose';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) = 0 or char_length(p_idempotency_key) > 240 then
    raise exception 'invalid workflow idempotency key';
  end if;

  update public.workflow_runs
  set technical_status = 'running', attempt = attempt + 1,
      worker_lease_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 3600))),
      worker_lease_token = gen_random_uuid(), error_class = null, updated_at = now()
  where organization_id = p_organization_id and workflow_name = p_workflow_name
    and entity_id = p_entity_id and source_revision = p_source_revision and purpose = p_purpose
    and (technical_status in ('queued', 'failed') or (technical_status = 'running' and worker_lease_until < now()))
  returning worker_lease_token into acquired_lease_token;
  if found then
    return query select 'acquired'::text, acquired_lease_token;
    return;
  end if;
  if exists (select 1 from public.workflow_runs where organization_id = p_organization_id and workflow_name = p_workflow_name and entity_id = p_entity_id and source_revision = p_source_revision and purpose = p_purpose) then
    return query select 'already_handled'::text, null::uuid;
    return;
  end if;
  return query select 'not_found'::text, null::uuid;
end;
$$;

create or replace function public.finish_workflow_run(
  p_organization_id uuid, p_workflow_name text, p_entity_id uuid, p_source_revision integer,
  p_purpose text, p_lease_token uuid, p_status text, p_error_class text default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('succeeded', 'failed', 'cancelled', 'action_required') then
    raise exception 'invalid workflow terminal status';
  end if;
  if p_lease_token is null then
    raise exception 'workflow lease token is required';
  end if;
  update public.workflow_runs
  set technical_status = p_status, error_class = left(nullif(p_error_class, ''), 120),
      worker_lease_until = null, worker_lease_token = null, updated_at = now()
  where organization_id = p_organization_id and workflow_name = p_workflow_name
    and entity_id = p_entity_id and source_revision = p_source_revision and purpose = p_purpose
    and technical_status = 'running' and worker_lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acknowledge_workflow_outbox(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.begin_workflow_run(uuid, text, uuid, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_workflow_run(uuid, text, uuid, integer, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.acknowledge_workflow_outbox(uuid, uuid, text), public.begin_workflow_run(uuid, text, uuid, integer, text, text, integer), public.finish_workflow_run(uuid, text, uuid, integer, text, uuid, text, text) to service_role;

commit;
