begin;

-- `candidateId` remains an ID-only technical reference.  It binds one Hatchet delivery to one
-- durable candidate, instead of allowing a session-level update to claim multiple revisions.
create or replace function public.is_id_only_workflow_payload(value jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(value) = 'object'
    and value ?& array['entityId', 'organizationId', 'departmentId', 'correlationId', 'sourceRevision', 'purpose', 'idempotencyKey']
    and not exists (
      select 1 from jsonb_object_keys(value) as key
      where key not in ('submissionId', 'candidateId', 'entityId', 'organizationId', 'departmentId', 'teamId', 'correlationId', 'sourceRevision', 'purpose', 'idempotencyKey')
    )
    and coalesce((value->>'entityId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and (not value ? 'candidateId' or (jsonb_typeof(value->'candidateId') = 'string' and coalesce((value->>'candidateId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and coalesce((value->>'organizationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and coalesce((value->>'departmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and coalesce((value->>'correlationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and (not value ? 'submissionId' or (jsonb_typeof(value->'submissionId') = 'string' and coalesce((value->>'submissionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and (not value ? 'teamId' or (jsonb_typeof(value->'teamId') = 'string' and coalesce((value->>'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and jsonb_typeof(value->'sourceRevision') = 'number' and (value->>'sourceRevision') ~ '^[1-9][0-9]*$'
    and jsonb_typeof(value->'purpose') = 'string' and value->>'purpose' = btrim(value->>'purpose') and char_length(value->>'purpose') between 1 and 80
    and jsonb_typeof(value->'idempotencyKey') = 'string' and char_length(value->>'idempotencyKey') between 1 and 240;
$$;

-- Old running rows have no lease token or expiry and must be immediately recoverable.
update public.workflow_runs set worker_lease_until = now() where technical_status = 'running' and worker_lease_until is null;

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
    and (technical_status in ('queued', 'failed') or (technical_status = 'running' and (worker_lease_until is null or worker_lease_until < now())))
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

revoke all on function public.begin_workflow_run(uuid, text, uuid, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_workflow_run(uuid, text, uuid, integer, text, text, integer) to service_role;

commit;
