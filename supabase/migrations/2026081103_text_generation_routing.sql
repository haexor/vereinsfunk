begin;

-- Provider routing is platform-owned.  The task vocabulary is intentionally wider than the
-- active implementation; only text_generation may be activated by the API in this release.
alter table public.llm_provider_configurations
  add column task_kind text not null default 'text_generation'
    check (task_kind in ('text_generation', 'image_generation', 'video_generation')),
  add column temperature numeric not null default 0.2 check (temperature >= 0 and temperature <= 2),
  add column max_output_tokens integer not null default 1200 check (max_output_tokens between 128 and 4000),
  add column structured_output_required boolean not null default true;

-- A free operator supplied system prompt would be an unreviewed policy bypass.  Historical values
-- are deliberately discarded rather than ever being sent to a model.
update public.llm_provider_configurations set system_prompt_override = null where system_prompt_override is not null;
alter table public.llm_provider_configurations
  add constraint llm_provider_configurations_no_system_prompt check (system_prompt_override is null);
create index llm_provider_configurations_active_task_priority_idx
  on public.llm_provider_configurations(task_kind, priority, id) where is_active;

-- Candidate metadata is written by the worker before a candidate can be accepted.  It is not a
-- secret and lets acceptance create immutable provenance without consulting mutable provider rows.
alter table public.generation_candidates
  add column provider_configuration_id uuid references public.llm_provider_configurations(id) on delete restrict,
  add column provider_model_id text,
  add column provider_parameter_hash text check (provider_parameter_hash is null or provider_parameter_hash ~ '^[a-f0-9]{64}$'),
  add column prompt_template_version text;
alter table public.composition_sessions
  add column effective_config_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(effective_config_snapshot) = 'object');
-- Preserve historical sessions while making duplicate pre-idempotency hashes unique.
with ranked as (
  select id, row_number() over (partition by organization_id, input_hash order by created_at, id) as position
  from public.composition_sessions
)
update public.composition_sessions session
set input_hash = md5(session.input_hash || ':' || session.id::text) || md5(session.id::text)
from ranked
where ranked.id = session.id and ranked.position > 1;
create unique index composition_sessions_organization_input_hash_unique on public.composition_sessions(organization_id, input_hash);

-- One service-only transaction creates the durable business state and its ID-only outbox record.
create or replace function public.create_text_generation_session(
  p_organization_id uuid, p_department_id uuid, p_team_id uuid, p_preset_slug text,
  p_communication_goal text, p_requested_formats jsonb, p_source_material jsonb,
  p_style_profile_id uuid, p_style_profile_snapshot jsonb, p_effective_config_snapshot jsonb,
  p_source_revision integer, p_input_hash text, p_candidate_input_hash text,
  p_generation_intent text, p_revision_instruction text, p_created_by uuid, p_correlation_id uuid,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare session_row public.composition_sessions%rowtype; candidate_row public.generation_candidates%rowtype;
begin
  if p_generation_intent not in ('initial', 'revise') then raise exception 'invalid_generation_intent'; end if;
  if p_generation_intent = 'initial' and p_revision_instruction is not null then raise exception 'initial_generation_has_instruction'; end if;
  if p_generation_intent = 'revise' and (p_revision_instruction is null or char_length(p_revision_instruction) > 500) then raise exception 'invalid_revision_instruction'; end if;

  -- Initial retries return the original durable session/candidate.  A revision deliberately
  -- keeps the same session and adds one separately auditable candidate; neither path duplicates
  -- a provider call for the same candidate input hash.
  select * into session_row from public.composition_sessions
    where organization_id = p_organization_id and input_hash = p_input_hash for update;
  if found then
    select * into candidate_row from public.generation_candidates
      where composition_session_id = session_row.id and input_hash = p_candidate_input_hash;
    if found then return jsonb_build_object('sessionId', session_row.id, 'candidateId', candidate_row.id); end if;
    if p_generation_intent = 'initial' then raise exception 'composition_session_generation_conflict'; end if;

    insert into public.generation_candidates (
      organization_id, composition_session_id, generation_intent, revision_instruction, status, input_hash
    ) values (
      p_organization_id, session_row.id, p_generation_intent, p_revision_instruction, 'pending', p_candidate_input_hash
    ) returning * into candidate_row;
    update public.composition_sessions set status = 'queued', updated_at = now() where id = session_row.id;
    insert into public.workflow_outbox (
      organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
    ) values (
      p_organization_id, p_department_id, 'generate-text-post', session_row.id, p_source_revision, p_generation_intent,
      p_correlation_id,
      jsonb_strip_nulls(jsonb_build_object('entityId', session_row.id, 'organizationId', p_organization_id,
        'candidateId', candidate_row.id, 'departmentId', p_department_id, 'teamId', p_team_id, 'correlationId', p_correlation_id,
        'sourceRevision', p_source_revision, 'purpose', p_generation_intent, 'idempotencyKey', p_idempotency_key))
    );
    return jsonb_build_object('sessionId', session_row.id, 'candidateId', candidate_row.id);
  end if;

  insert into public.composition_sessions (
    organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats,
    source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot,
    source_revision, input_hash, status, created_by
  ) values (
    p_organization_id, p_department_id, p_team_id, p_preset_slug, p_communication_goal, p_requested_formats,
    p_source_material, p_style_profile_id, p_style_profile_snapshot, p_effective_config_snapshot,
    p_source_revision, p_input_hash, 'queued', p_created_by
  ) returning * into session_row;

  insert into public.generation_candidates (
    organization_id, composition_session_id, generation_intent, revision_instruction, status, input_hash
  ) values (
    p_organization_id, session_row.id, p_generation_intent, p_revision_instruction, 'pending', p_candidate_input_hash
  ) returning * into candidate_row;

  insert into public.workflow_outbox (
    organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
  ) values (
    p_organization_id, p_department_id, 'generate-text-post', session_row.id, p_source_revision, p_generation_intent,
    p_correlation_id,
    jsonb_strip_nulls(jsonb_build_object('entityId', session_row.id, 'organizationId', p_organization_id,
      'candidateId', candidate_row.id, 'departmentId', p_department_id, 'teamId', p_team_id, 'correlationId', p_correlation_id,
      'sourceRevision', p_source_revision, 'purpose', p_generation_intent, 'idempotencyKey', p_idempotency_key))
  );
  return jsonb_build_object('sessionId', session_row.id, 'candidateId', candidate_row.id);
end;
$$;

-- The candidate is locked and consumed exactly once.  This is the only point that changes the
-- accepted content model; generation itself never writes a post_version.
create or replace function public.accept_text_generation_candidate(
  p_candidate_id uuid, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare candidate public.generation_candidates%rowtype; session_row public.composition_sessions%rowtype;
  post_row public.posts%rowtype; version_id uuid; version_number integer;
begin
  select * into candidate from public.generation_candidates where id = p_candidate_id for update;
  if not found then raise exception 'generation_candidate_not_found'; end if;
  if candidate.status = 'accepted' then return jsonb_build_object('postVersionId', candidate.accepted_post_version_id, 'alreadyAccepted', true); end if;
  if candidate.status <> 'ready' or candidate.generated_content is null then raise exception 'generation_candidate_not_ready'; end if;
  if candidate.provider_configuration_id is null or candidate.provider_model_id is null or candidate.provider_parameter_hash is null or candidate.prompt_template_version is null then raise exception 'generation_candidate_missing_provenance'; end if;
  select * into session_row from public.composition_sessions where id = candidate.composition_session_id and organization_id = candidate.organization_id for update;
  if not found then raise exception 'composition_session_not_found'; end if;

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

revoke all on function public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, integer, text, text, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.accept_text_generation_candidate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, integer, text, text, text, text, uuid, uuid, text), public.accept_text_generation_candidate(uuid, uuid) to service_role;

commit;
