-- Ein Veo-Abgleich, dessen Worker-Versuch abbricht, ohne den Lauf zu beenden, blieb auf 'running'
-- stehen (gesehen am 2026-10-22: Hatchet gab den Lauf nach einer internen Neuzustellung und drei
-- Wiederholungen auf, alle Wiederholungen trafen noch auf den gueltigen Lease des ersten Versuchs).
-- acquire_integration_sync_run meldet dann 'already_running', "Jetzt abgleichen" tat nichts, und
-- erst der taegliche Abgleich gab den Lauf nach zwei Stunden frei.
--
-- enqueue_integration_sync gibt jetzt vorher Laeufe frei, die seit mindestens 15 Minuten laufen und
-- die kein Worker mehr haelt: kein Workflow-Lauf mit gueltigem Lease. Ein arbeitender Worker
-- verlaengert seinen Lease alle 40 s (bis 30 min, apps/worker/src/workflows.ts) und bleibt damit
-- unberuehrt. Ein spaet zugestellter Versuch ueberspringt einen freigegebenen Lauf, weil
-- VeoSyncExecutor nur Laeufe mit status 'running' ausfuehrt.

create or replace function authz.release_orphaned_integration_sync_runs(target_organization_id uuid, target_source_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  released integer;
  stale_run record;
  workflow record;
  finished record;
  active_lease boolean;
begin
  released := 0;
  for stale_run in
    select run.id, run.source_id
      from public.integration_sync_runs run
     where run.organization_id = target_organization_id
       and run.source_id = target_source_id
       and run.mode = 'apply'
       and run.status = 'running'
       and run.started_at < now() - interval '15 minutes'
  loop
    -- Sperre alle Workflow-Zeilen, bevor der Fachlauf gesperrt wird. Das ist dieselbe
    -- Reihenfolge wie beim Worker (Lease zuerst, Fachstatus später) und verhindert Deadlocks.
    -- Abgelaufene Leases werden bewusst mitgesperrt: Ein verspäteter Worker darf den bereits
    -- freigegebenen Fachlauf nicht wiederbeleben.
    active_lease := false;
    for workflow in
      select technical_status, worker_lease_until
        from public.workflow_runs
       where organization_id = target_organization_id
         and workflow_name = 'sync-integration-source'
         and entity_id = stale_run.id
       for update
    loop
      active_lease := active_lease or (
        workflow.technical_status = 'running' and workflow.worker_lease_until > now()
      );
    end loop;
    if active_lease then
      continue;
    end if;

    -- Der Kandidat kann seit der Auswahl bereits beendet worden sein. Die Prüfung direkt vor
    -- dem Abschluss hält die Altersgrenze und den Status auch bei konkurrierenden Enqueues ein.
    if not exists (
      select 1
        from public.integration_sync_runs run
       where run.id = stale_run.id
         and run.status = 'running'
         and run.started_at < now() - interval '15 minutes'
    ) then
      continue;
    end if;

    -- Veo muss über denselben Abschlussweg wie der reguläre Worker/Cron laufen, damit
    -- last_sync_status, consecutive_failures und failure_notified_at konsistent bleiben.
    if exists (select 1 from public.playerboard_veo_links where integration_source_id = stale_run.source_id) then
      for finished in
        select * from public.playerboard_veo_finish_sync(stale_run.id, 'failed', 'stale_run', 0, 0, 0, 0)
      loop
        released := released + 1;
        -- Dieser Pfad verschickt keine Mail. Die nächste echte Worker-Fehlermeldung soll
        -- deshalb weiterhin benachrichtigen dürfen.
        if finished.notify then
          update public.playerboard_veo_links
             set failure_notified_at = null
           where team_id = finished.team_id;
        end if;
      end loop;
    else
      update public.integration_sync_runs run
         set status = 'failed', error_class = 'stale_run', finished_at = now()
       where run.id = stale_run.id and run.status = 'running';
      if found then
        released := released + 1;
      end if;
    end if;
  end loop;
  return released;
end;
$$;
revoke all on function authz.release_orphaned_integration_sync_runs(uuid, uuid) from public, anon, authenticated;

create or replace function public.enqueue_integration_sync(
  target_organization_id uuid, target_source_id uuid, target_request_idempotency_key text,
  target_correlation_id uuid, target_triggered_by uuid
) returns table(result text, run_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_row public.integration_sources;
  acquired record;
begin
  select * into source_row from public.integration_sources
   where id = target_source_id and organization_id = target_organization_id;
  if not found then
    raise exception 'integration source does not belong to organization' using errcode = 'P0002';
  end if;
  if source_row.transport <> 'http' or source_row.department_id is null then
    raise exception 'source_not_queueable' using errcode = '22023';
  end if;
  if not source_row.enabled then
    raise exception 'source_disabled' using errcode = '22023';
  end if;

  perform authz.release_orphaned_integration_sync_runs(target_organization_id, target_source_id);

  select * into acquired from public.acquire_integration_sync_run(
    target_organization_id, target_source_id, 'fixtures', 'apply',
    target_request_idempotency_key, target_correlation_id, target_triggered_by
  );

  if acquired.result = 'acquired' then
    insert into public.workflow_outbox (
      organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
    ) values (
      target_organization_id, source_row.department_id, 'sync-integration-source', acquired.run_id, 1, 'default',
      target_correlation_id,
      jsonb_build_object(
        'entityId', acquired.run_id, 'organizationId', target_organization_id,
        'departmentId', source_row.department_id, 'departmentConcurrencyKey', source_row.department_id::text,
        'correlationId', target_correlation_id, 'sourceRevision', 1, 'purpose', 'default',
        'idempotencyKey', 'integration-sync:' || acquired.run_id::text
      )
    );
  end if;

  return query select acquired.result::text, acquired.run_id::uuid;
end;
$$;
revoke all on function public.enqueue_integration_sync(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_integration_sync(uuid, uuid, text, uuid, uuid) to service_role;
