begin;

-- The 15-minute lease recovery in acquire_generation_candidate (2026081202) lets a second
-- delivery reclaim a candidate a crashed worker never released. Without a fencing token, a
-- since-crashed-but-not-actually-dead worker that finally writes back after the reclaim could
-- silently overwrite the new attempt's result. Mirrors workflow_runs.worker_lease_token
-- (2026081102_workflow_run_lifecycle.sql): only nullable while a candidate is 'generating'.
alter table public.generation_candidates add column generation_lease_token uuid;

create or replace function public.acquire_generation_candidate(
  p_candidate_id uuid, p_session_id uuid, p_organization_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_row public.generation_candidates%rowtype;
  current_status public.generation_candidate_status;
begin
  update public.generation_candidates set status = 'generating', updated_at = now(), generation_lease_token = gen_random_uuid()
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id
      and (status = 'pending' or (status = 'generating' and updated_at < now() - interval '15 minutes'))
    returning * into candidate_row;
  if found then
    update public.composition_sessions set status = 'generating', updated_at = now()
      where id = p_session_id and organization_id = p_organization_id;
    if not found then raise exception 'composition_session_acquire_lost'; end if;
    return jsonb_build_object('id', candidate_row.id, 'status', candidate_row.status, 'revision_instruction', candidate_row.revision_instruction, 'lease_token', candidate_row.generation_lease_token);
  end if;

  select status into current_status from public.generation_candidates
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id;
  if current_status = 'generating' then
    raise exception 'generation_candidate_still_in_progress';
  end if;
  return null;
end;
$$;

-- Argument list changes below (new p_lease_token parameter): create or replace cannot alter a
-- function's signature, it would just add an overload alongside the old one.
drop function if exists public.mark_generation_candidate_ready(uuid, uuid, jsonb, uuid, text, text, text);
drop function if exists public.mark_generation_candidate_failed(uuid, uuid, text);
drop function if exists public.release_generation_candidate(uuid, uuid);

create function public.mark_generation_candidate_ready(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid, p_generated_content jsonb, p_provider_configuration_id uuid,
  p_provider_model_id text, p_provider_parameter_hash text, p_prompt_template_version text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'ready', generated_content = p_generated_content,
      provider_configuration_id = p_provider_configuration_id, provider_model_id = p_provider_model_id,
      provider_parameter_hash = p_provider_parameter_hash, prompt_template_version = p_prompt_template_version,
      generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token;
  if not found then raise exception 'generation_candidate_ready_update_lost'; end if;
  update public.composition_sessions set status = 'candidate_ready', updated_at = now()
    where id = p_session_id and status = 'generating';
  if not found then raise exception 'composition_session_ready_update_lost'; end if;
end;
$$;

create function public.mark_generation_candidate_failed(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid, p_error_class text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'failed', failure_code = p_error_class, generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token;
  if not found then raise exception 'generation_candidate_failed_update_lost'; end if;
  update public.composition_sessions set status = 'failed', updated_at = now()
    where id = p_session_id and status = 'generating';
  if not found then raise exception 'composition_session_failed_update_lost'; end if;
end;
$$;

create function public.release_generation_candidate(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'pending', generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token;
  if not found then raise exception 'generation_candidate_release_update_lost'; end if;
  update public.composition_sessions set status = 'queued', updated_at = now()
    where id = p_session_id and status = 'generating';
  if not found then raise exception 'composition_session_release_update_lost'; end if;
end;
$$;

revoke all on function public.mark_generation_candidate_ready(uuid, uuid, uuid, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_generation_candidate_failed(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_generation_candidate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_generation_candidate_ready(uuid, uuid, uuid, jsonb, uuid, text, text, text) to service_role;
grant execute on function public.mark_generation_candidate_failed(uuid, uuid, uuid, text) to service_role;
grant execute on function public.release_generation_candidate(uuid, uuid, uuid) to service_role;

commit;
