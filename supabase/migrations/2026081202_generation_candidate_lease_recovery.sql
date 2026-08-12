begin;

-- Stirbt der Worker mitten in generator.generateText(...) (OOM, harter Kill, Netzwerkpartition),
-- blieb ein Kandidat bislang fuer immer auf 'generating' stehen: die UPDATE-Bedingung nahm
-- ausschliesslich status = 'pending' zurueck. Hatchets automatischer Retry
-- (retries: 3, executionTimeout: '10m', apps/worker/src/workflows.ts) findet dann keinen
-- Kandidaten mehr (TextGenerationExecutor.execute gibt bei !candidate kommentarlos zurueck) und
-- runs.succeed(...) meldet den Workflow-Run trotzdem als erfolgreich. Der 15-Minuten-Schwellenwert
-- liegt bewusst deutlich ueber executionTimeout (10 Minuten) plus dem Standard-Provider-Timeout
-- (60s, packages/content-engine/src/index.ts requestTimeoutMs), damit ein noch legitim laufender
-- Versuch nicht vorzeitig ueberschrieben wird -- derselbe Rueckfall wie
-- workflow_runs_recovery_idx/begin_workflow_run in 2026081102_workflow_run_lifecycle.sql.
--
-- Dieser Rueckfall allein wuerde in der Praxis nie greifen: Hatchets eigene drei Wiederholungen
-- (der erste ueber executionTimeout nach 10 Minuten, die naechsten ueber das kurze Backoff)
-- sind durchweg vor der 15-Minuten-Schwelle aufgebraucht, und danach loest nichts einen weiteren
-- Versuch mehr aus. Ohne die folgende Unterscheidung wuerde ein solcher verfrueter Versuch
-- weiterhin `null` erhalten und still Erfolg melden (siehe unten). Ein eigenstaendiger, von
-- Hatchets Wiederholungsbudget unabhaengiger Ausloeser, der die Schwelle tatsaechlich erreicht,
-- ist ein separates Vorhaben (siehe plans/README.md, geplantes Folgepaket).
create or replace function public.acquire_generation_candidate(
  p_candidate_id uuid, p_session_id uuid, p_organization_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_row public.generation_candidates%rowtype;
  current_status public.generation_candidate_status;
begin
  update public.generation_candidates set status = 'generating', updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id
      and (status = 'pending' or (status = 'generating' and updated_at < now() - interval '15 minutes'))
    returning * into candidate_row;
  if found then
    update public.composition_sessions set status = 'generating', updated_at = now()
      where id = p_session_id and organization_id = p_organization_id;
    if not found then raise exception 'composition_session_acquire_lost'; end if;
    return jsonb_build_object('id', candidate_row.id, 'status', candidate_row.status, 'revision_instruction', candidate_row.revision_instruction);
  end if;

  -- A duplicate delivery or a genuinely terminal candidate (ready/failed/accepted) is a safe
  -- no-op -- another delivery already produced a result. A candidate still 'generating' within
  -- the recovery window is different: it may genuinely still be in flight, so a delivery arriving
  -- here must not silently report success the way returning null used to (the caller,
  -- TextGenerationExecutor.execute, treats a null candidate as "nothing to do" and lets the
  -- workflow run complete successfully). Raising here makes the caller fail retryably instead,
  -- so the workflow run is honestly marked 'failed' rather than falsely 'succeeded'.
  select status into current_status from public.generation_candidates
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id;
  if current_status = 'generating' then
    raise exception 'generation_candidate_still_in_progress';
  end if;
  return null;
end;
$$;

commit;
