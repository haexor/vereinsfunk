begin;

alter table public.workflow_outbox
  drop constraint workflow_outbox_status_check,
  add column priority smallint not null default 2 check (priority between 1 and 3),
  add column attempt integer not null default 0 check (attempt >= 0),
  add column available_at timestamptz not null default now(),
  add column claimed_at timestamptz,
  add column claim_token uuid,
  add column last_error_class text,
  add constraint workflow_outbox_status_check check (status in ('pending', 'dispatching', 'dispatched', 'failed', 'cancelled')) not valid;
commit;

alter table public.workflow_outbox validate constraint workflow_outbox_status_check;
-- Supabase applies migration files through PostgreSQL pipeline mode, where CREATE INDEX
-- CONCURRENTLY is rejected even outside BEGIN/COMMIT. Keep this compatible index creation
-- separate from the short constraint transaction above; production rollout needs a maintenance
-- window if the table grows beyond the MVP workload.
create index workflow_outbox_dispatchable_idx on public.workflow_outbox (available_at, created_at) where status in ('pending', 'dispatching');

begin;
create or replace function public.claim_workflow_outbox(p_limit integer default 20)
returns table (id uuid, workflow_name text, payload jsonb, priority smallint, claim_token uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'p_limit must be between 1 and 100' using errcode = '22023'; end if;
  return query with claimable as (
    select o.id from public.workflow_outbox o
    where (o.status = 'pending' and o.available_at <= now()) or (o.status = 'dispatching' and o.claimed_at < now() - interval '5 minutes')
    order by o.available_at, o.created_at for update skip locked limit p_limit
  ), claimed as (
    update public.workflow_outbox o set status = 'dispatching', claimed_at = now(), claim_token = gen_random_uuid(), attempt = o.attempt + 1, updated_at = now()
    from claimable c where o.id = c.id returning o.id, o.workflow_name, o.payload, o.priority, o.claim_token
  ) select claimed.id, claimed.workflow_name, claimed.payload, claimed.priority, claimed.claim_token from claimed;
end;
$$;

create or replace function public.acknowledge_workflow_outbox(p_outbox_id uuid, p_claim_token uuid, p_hatchet_run_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed public.workflow_outbox%rowtype;
begin
  update public.workflow_outbox set status = 'dispatched', dispatched_at = now(), claim_token = null, updated_at = now(), last_error_class = null
  where id = p_outbox_id and status = 'dispatching' and claim_token = p_claim_token returning * into claimed;
  if not found then return false; end if;
  insert into public.workflow_runs (organization_id, department_id, workflow_name, entity_id, source_revision, hatchet_run_id, technical_status, attempt, correlation_id)
  values (claimed.organization_id, claimed.department_id, claimed.workflow_name, claimed.entity_id, claimed.source_revision, p_hatchet_run_id, 'queued', claimed.attempt, claimed.correlation_id)
  on conflict (organization_id, workflow_name, entity_id, source_revision) do update set hatchet_run_id = excluded.hatchet_run_id, technical_status = 'queued', attempt = excluded.attempt, correlation_id = excluded.correlation_id, updated_at = now();
  return true;
end;
$$;

create or replace function public.release_workflow_outbox(p_outbox_id uuid, p_claim_token uuid, p_error_class text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.workflow_outbox set status = 'pending', available_at = now() + interval '5 seconds', claimed_at = null, claim_token = null, last_error_class = left(coalesce(p_error_class, 'unknown'), 120), updated_at = now()
  where id = p_outbox_id and status = 'dispatching' and claim_token = p_claim_token;
  return found;
end;
$$;

revoke all on function public.claim_workflow_outbox(integer) from public, anon, authenticated;
revoke all on function public.acknowledge_workflow_outbox(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_workflow_outbox(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_workflow_outbox(integer), public.acknowledge_workflow_outbox(uuid, uuid, text), public.release_workflow_outbox(uuid, uuid, text) to service_role;
commit;
