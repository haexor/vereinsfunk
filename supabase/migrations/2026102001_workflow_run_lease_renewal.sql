begin;

-- Ein Worker haelt seinen Lease waehrend des Laufs per renew_workflow_run_lease am Leben. Vorher lief
-- der Lease nach 120 s ab, obwohl Website-Analyse, Textgenerierung oder Veo-Abgleich laenger
-- brauchen koennen: eine erneute Zustellung (Hatchet-Retry nach executionTimeout) uebernahm den
-- Lauf dann, waehrend der erste Versuch noch arbeitete -- doppelte LLM-Kosten, zwei Browser und
-- ein spaeter Fehler des alten Versuchs konnte einen neueren Erfolg ueberschreiben.
create or replace function public.renew_workflow_run_lease(
  p_organization_id uuid, p_workflow_name text, p_entity_id uuid, p_source_revision integer,
  p_purpose text, p_lease_token uuid, p_lease_seconds integer default 120
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_lease_token is null then
    raise exception 'workflow lease token is required';
  end if;
  update public.workflow_runs
  set worker_lease_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 3600))), updated_at = now()
  where organization_id = p_organization_id and workflow_name = p_workflow_name
    and entity_id = p_entity_id and source_revision = p_source_revision and purpose = p_purpose
    and technical_status = 'running' and worker_lease_token = p_lease_token;
  return found;
end;
$$;

-- Ein laufender Lauf mit gueltigem Lease meldet jetzt 'in_progress' statt 'already_handled'. Mit
-- 'already_handled' beendete Hatchet die erneute Zustellung als erfolgreich; scheiterte danach der
-- noch laufende Versuch, blieb der Lauf ohne weiteren Retry auf 'failed' stehen. 'in_progress'
-- laesst den Worker die Zustellung spaeter wiederholen.
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
  if exists (
    select 1 from public.workflow_runs
    where organization_id = p_organization_id and workflow_name = p_workflow_name and entity_id = p_entity_id
      and source_revision = p_source_revision and purpose = p_purpose and technical_status = 'running'
  ) then
    return query select 'in_progress'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.workflow_runs where organization_id = p_organization_id and workflow_name = p_workflow_name and entity_id = p_entity_id and source_revision = p_source_revision and purpose = p_purpose) then
    return query select 'already_handled'::text, null::uuid;
    return;
  end if;
  return query select 'not_found'::text, null::uuid;
end;
$$;

revoke all on function public.renew_workflow_run_lease(uuid, text, uuid, integer, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.renew_workflow_run_lease(uuid, text, uuid, integer, text, uuid, integer) to service_role;
revoke all on function public.begin_workflow_run(uuid, text, uuid, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_workflow_run(uuid, text, uuid, integer, text, text, integer) to service_role;

commit;
