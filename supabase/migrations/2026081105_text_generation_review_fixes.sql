begin;

-- Future adapter configurations may be stored, but only an implemented adapter may be active.
update public.llm_provider_configurations
set is_active = false
where is_active and (task_kind <> 'text_generation' or protocol <> 'openai');
-- NOT VALID: only the metadata catalog lock is taken here, not a full-table scan. The next
-- migration validates existing rows under a much weaker lock.
alter table public.llm_provider_configurations
  add constraint llm_provider_configurations_active_implemented_adapter_check
  check (not is_active or (task_kind = 'text_generation' and protocol = 'openai')) not valid;

-- A row lock cannot protect an as-yet nonexistent session. Serialise both session and candidate
-- creation by the durable input hash, then use the candidate ID in the outbox uniqueness key.
create or replace function public.create_text_generation_session(
  p_organization_id uuid, p_department_id uuid, p_team_id uuid, p_preset_slug text,
  p_communication_goal text, p_requested_formats jsonb, p_source_material jsonb,
  p_style_profile_id uuid, p_style_profile_snapshot jsonb, p_effective_config_snapshot jsonb,
  p_source_revision integer, p_input_hash text, p_candidate_input_hash text,
  p_generation_intent text, p_revision_instruction text, p_created_by uuid, p_correlation_id uuid,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  session_row public.composition_sessions%rowtype;
  candidate_row public.generation_candidates%rowtype;
  workflow_purpose text;
begin
  if p_generation_intent not in ('initial', 'revise') then raise exception 'invalid_generation_intent'; end if;
  if p_generation_intent = 'initial' and p_revision_instruction is not null then raise exception 'initial_generation_has_instruction'; end if;
  if p_generation_intent = 'revise' and (p_revision_instruction is null or p_revision_instruction <> btrim(p_revision_instruction) or char_length(p_revision_instruction) not between 1 and 500) then raise exception 'invalid_revision_instruction'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_input_hash, 0));
  select * into session_row from public.composition_sessions
    where organization_id = p_organization_id and input_hash = p_input_hash for update;
  if found then
    select * into candidate_row from public.generation_candidates
      where composition_session_id = session_row.id and input_hash = p_candidate_input_hash;
    if found then return jsonb_build_object('sessionId', session_row.id, 'candidateId', candidate_row.id); end if;
    if p_generation_intent = 'initial' then raise exception 'composition_session_generation_conflict'; end if;
  else
    insert into public.composition_sessions (
      organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats,
      source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot,
      source_revision, input_hash, status, created_by
    ) values (
      p_organization_id, p_department_id, p_team_id, p_preset_slug, p_communication_goal, p_requested_formats,
      p_source_material, p_style_profile_id, p_style_profile_snapshot, p_effective_config_snapshot,
      p_source_revision, p_input_hash, 'queued', p_created_by
    ) returning * into session_row;
  end if;

  insert into public.generation_candidates (
    organization_id, composition_session_id, generation_intent, revision_instruction, status, input_hash
  ) values (
    p_organization_id, session_row.id, p_generation_intent, p_revision_instruction, 'pending', p_candidate_input_hash
  ) returning * into candidate_row;
  update public.composition_sessions set status = 'queued', updated_at = now() where id = session_row.id;

  workflow_purpose := p_generation_intent || ':' || candidate_row.id::text;
  insert into public.workflow_outbox (
    organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
  ) values (
    p_organization_id, p_department_id, 'generate-text-post', session_row.id, p_source_revision, workflow_purpose,
    p_correlation_id,
    jsonb_strip_nulls(jsonb_build_object('entityId', session_row.id, 'organizationId', p_organization_id,
      'candidateId', candidate_row.id, 'departmentId', p_department_id, 'teamId', p_team_id, 'correlationId', p_correlation_id,
      'sourceRevision', p_source_revision, 'purpose', workflow_purpose, 'idempotencyKey', p_idempotency_key))
  );
  return jsonb_build_object('sessionId', session_row.id, 'candidateId', candidate_row.id);
end;
$$;

-- SECURITY DEFINER bypasses RLS. The API still verifies post.create, while this function also
-- enforces that the actor belongs to the candidate's actual tenant and scope.
create or replace function public.accept_text_generation_candidate(
  p_candidate_id uuid, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate public.generation_candidates%rowtype;
  session_row public.composition_sessions%rowtype;
  post_row public.posts%rowtype;
  version_id uuid;
  version_number integer;
begin
  select * into candidate from public.generation_candidates where id = p_candidate_id for update;
  if not found then raise exception 'generation_candidate_not_found'; end if;
  select * into session_row from public.composition_sessions where id = candidate.composition_session_id and organization_id = candidate.organization_id for update;
  if not found then raise exception 'composition_session_not_found'; end if;
  if not exists (
    select 1 from public.organization_memberships membership
      where membership.organization_id = candidate.organization_id and membership.user_id = p_actor_user_id and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.department_memberships membership
      where membership.department_id = session_row.department_id and membership.user_id = p_actor_user_id and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.team_memberships membership
      where membership.team_id = session_row.team_id and membership.user_id = p_actor_user_id and (membership.expires_at is null or membership.expires_at > now())
  ) then raise exception 'generation_candidate_forbidden'; end if;
  if candidate.status = 'accepted' then return jsonb_build_object('postVersionId', candidate.accepted_post_version_id, 'alreadyAccepted', true); end if;
  if candidate.status <> 'ready' or candidate.generated_content is null then raise exception 'generation_candidate_not_ready'; end if;
  if candidate.provider_configuration_id is null or candidate.provider_model_id is null or candidate.provider_parameter_hash is null or candidate.prompt_template_version is null then raise exception 'generation_candidate_missing_provenance'; end if;

  if session_row.post_id is null then
    insert into public.posts (organization_id, department_id, team_id, status, created_by)
    values (session_row.organization_id, session_row.department_id, session_row.team_id, 'draft_ready', p_actor_user_id)
    returning * into post_row;
    update public.composition_sessions set post_id = post_row.id, updated_at = now() where id = session_row.id;
  else
    select * into post_row from public.posts where id = session_row.post_id and organization_id = session_row.organization_id for update;
    update public.approval_requests set invalidated_at = now(), updated_at = now()
      where post_id = post_row.id and organization_id = post_row.organization_id and invalidated_at is null;
  end if;
  select coalesce(max(version_number), 0) + 1 into version_number from public.post_versions where post_id = post_row.id;
  insert into public.post_versions (
    organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot,
    title, caption, call_to_action, hashtags, alt_text, safety_flags, created_by_type, created_by_user_id
  ) values (
    session_row.organization_id, post_row.id, version_number, session_row.source_material, session_row.effective_config_snapshot,
    coalesce(candidate.generated_content->>'headline', ''), coalesce(candidate.generated_content->>'caption', ''),
    coalesce(candidate.generated_content->>'callToAction', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(candidate.generated_content->'hashtags', '[]'::jsonb))), '{}'),
    coalesce(candidate.generated_content->>'altText', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(candidate.generated_content->'safetyFlags', '[]'::jsonb))), '{}'),
    'llm', p_actor_user_id
  ) returning id into version_id;
  update public.posts set current_version_id = version_id, status = 'draft_ready', updated_at = now() where id = post_row.id;
  insert into public.post_generation_provenance (
    organization_id, post_version_id, composition_session_id, generation_candidate_id, style_profile_snapshot,
    prompt_template_version, provider_model_id, provider_configuration_id, provider_parameter_hash, input_hash
  ) values (
    session_row.organization_id, version_id, session_row.id, candidate.id, session_row.style_profile_snapshot,
    candidate.prompt_template_version, candidate.provider_model_id, candidate.provider_configuration_id,
    candidate.provider_parameter_hash, session_row.input_hash
  );
  update public.generation_candidates set status = 'accepted', accepted_post_version_id = version_id, updated_at = now() where id = candidate.id;
  update public.composition_sessions set status = 'accepted', updated_at = now() where id = session_row.id;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (session_row.organization_id, p_actor_user_id, 'text_generation.candidate_accepted', 'post_version', version_id, gen_random_uuid(), jsonb_build_object('candidateId', candidate.id, 'sessionId', session_row.id));
  return jsonb_build_object('postId', post_row.id, 'postVersionId', version_id, 'alreadyAccepted', false);
end;
$$;

-- The worker previously updated generation_candidates and composition_sessions in two
-- separate requests. A failure between them left the pair in an inconsistent status
-- combination (e.g. a ready candidate under a still-generating session). Each of the four
-- functions below performs its coupled transition in one transaction.
create or replace function public.acquire_generation_candidate(
  p_candidate_id uuid, p_session_id uuid, p_organization_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare candidate_row public.generation_candidates%rowtype;
begin
  update public.generation_candidates set status = 'generating', updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id and status = 'pending'
    returning * into candidate_row;
  if not found then return null; end if;
  update public.composition_sessions set status = 'generating', updated_at = now()
    where id = p_session_id and organization_id = p_organization_id;
  if not found then raise exception 'composition_session_acquire_lost'; end if;
  return jsonb_build_object('id', candidate_row.id, 'status', candidate_row.status, 'revision_instruction', candidate_row.revision_instruction);
end;
$$;

create or replace function public.mark_generation_candidate_ready(
  p_candidate_id uuid, p_session_id uuid, p_generated_content jsonb, p_provider_configuration_id uuid,
  p_provider_model_id text, p_provider_parameter_hash text, p_prompt_template_version text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'ready', generated_content = p_generated_content,
      provider_configuration_id = p_provider_configuration_id, provider_model_id = p_provider_model_id,
      provider_parameter_hash = p_provider_parameter_hash, prompt_template_version = p_prompt_template_version, updated_at = now()
    where id = p_candidate_id and status = 'generating';
  if not found then raise exception 'generation_candidate_ready_update_lost'; end if;
  update public.composition_sessions set status = 'candidate_ready', updated_at = now()
    where id = p_session_id and status = 'generating';
  if not found then raise exception 'composition_session_ready_update_lost'; end if;
end;
$$;

create or replace function public.mark_generation_candidate_failed(
  p_candidate_id uuid, p_session_id uuid, p_error_class text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'failed', failure_code = p_error_class, updated_at = now()
    where id = p_candidate_id and status = 'generating';
  if not found then raise exception 'generation_candidate_failed_update_lost'; end if;
  update public.composition_sessions set status = 'failed', updated_at = now()
    where id = p_session_id and status = 'generating';
  if not found then raise exception 'composition_session_failed_update_lost'; end if;
end;
$$;

create or replace function public.release_generation_candidate(
  p_candidate_id uuid, p_session_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'pending', updated_at = now()
    where id = p_candidate_id and status = 'generating';
  if not found then raise exception 'generation_candidate_release_update_lost'; end if;
  update public.composition_sessions set status = 'queued', updated_at = now()
    where id = p_session_id and status = 'generating';
  if not found then raise exception 'composition_session_release_update_lost'; end if;
end;
$$;

revoke all on function public.acquire_generation_candidate(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_generation_candidate_ready(uuid, uuid, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_generation_candidate_failed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_generation_candidate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_generation_candidate(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_generation_candidate_ready(uuid, uuid, jsonb, uuid, text, text, text) to service_role;
grant execute on function public.mark_generation_candidate_failed(uuid, uuid, text) to service_role;
grant execute on function public.release_generation_candidate(uuid, uuid) to service_role;

commit;
