begin;

-- Zwei Funde beim Schreiben von supabase/tests/content_pipeline_smoke.test.sql (erster Testlauf,
-- der die volle Kette create_text_generation_session -> accept_text_generation_candidate ->
-- request_approval -> decide_approval_stage gegen echtes Postgres durchspielt, statt jede Funktion
-- isoliert oder nur ueber gemockte HTTP-Routen zu pruefen). Beide sind neu, keine Regression dieser
-- Migration selbst -- der Smoke-Test faengt sie beim allerersten echten Lauf ab, bevor irgendeine
-- Umgebung sie ausliefert.

-- 1. accept_text_generation_candidate (2026081105_text_generation_review_fixes.sql): die lokale
--    Variable "version_number" trug denselben Namen wie post_versions.version_number.
--    plpgsql.variable_conflict steht per Voreinstellung auf 'error' -- jeder Aufruf dieser Funktion
--    fuer eine tatsaechlich noch nicht uebernommene Sitzung (der Normalfall, nicht der
--    alreadyAccepted-Kurzschluss) scheiterte deshalb an "column reference is ambiguous", bevor
--    ueberhaupt ein post_versions-Datensatz entstehen konnte. Unbemerkt, weil kein bestehender
--    Test einen wirklich frischen Kandidaten annimmt (text_workshop_foundation.test.sql prueft nur
--    den negativen Mandantenfall, PR #96s eigene Tests nutzen bereits akzeptierte Fixtures).
create or replace function public.accept_text_generation_candidate(
  p_candidate_id uuid, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate public.generation_candidates%rowtype;
  session_row public.composition_sessions%rowtype;
  post_row public.posts%rowtype;
  version_id uuid;
  next_version_number integer;
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
  select coalesce(max(version_number), 0) + 1 into next_version_number from public.post_versions where post_id = post_row.id;
  insert into public.post_versions (
    organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot,
    title, caption, call_to_action, hashtags, alt_text, safety_flags, created_by_type, created_by_user_id
  ) values (
    session_row.organization_id, post_row.id, next_version_number, session_row.source_material, session_row.effective_config_snapshot,
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

-- 2. request_approval (2026081701_request_approval_idempotency.sql): die Idempotenz-Ergaenzung
--    wurde offenbar gegen eine Fassung von VOR 2026081601 (Freigabepflicht fuer minderjaehrige
--    Verfasser:innen, PR #95) geschrieben -- sie deklariert kein author_is_minor mehr und ruft
--    authz.assert_valid_stage_list() mit sechs statt sieben Argumenten auf. Die sechs-Parameter-
--    Fassung dieser Funktion wurde in 2026081601 per "drop function if exists" entfernt, es gibt
--    also seither KEIN passendes Overload mehr -- jeder Aufruf von request_approval scheiterte an
--    "function ... does not exist", nicht nur der Minderjaehrigenfall. Diese Migration war lokal
--    noch nicht angewendet (schema_migrations endete bei 2026081601), sonst waere jede Einreichung
--    betroffen gewesen. Fix: author_is_minor wie in 2026081601 wieder ermitteln und durchreichen,
--    der Rest (Idempotenz-Kurzschluss bei bereits laufender Freigabe) bleibt unveraendert.
create or replace function public.request_approval(
  target_post_version_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version record;
  post record;
  existing_request record;
  new_request_id uuid;
  stage jsonb;
  stages jsonb := '[]'::jsonb;
  route_row record;
  position_counter integer := 0;
  new_stage_id uuid;
  first_stage_id uuid;
  total_minimum_approvals integer := 0;
  any_minor_stage boolean := false;
  effective_self_approval_allowed boolean;
  effective_allow_same_reviewer boolean;
  any_review_required boolean;
  contains_minors boolean;
  author_is_minor boolean;
begin
  select * into version from public.post_versions where id = target_post_version_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into post from public.posts where id = version.post_id and organization_id = version.organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if not authz.has_department_permission(post.department_id, 'post.submit') then
    raise exception 'insufficient_permission';
  end if;

  if post.status = 'awaiting_approval' then
    select id into existing_request
    from public.approval_requests
    where organization_id = post.organization_id and post_version_id = version.id
    order by created_at desc, id desc
    limit 1;
    if found then
      return jsonb_build_object(
        'postId', post.id,
        'approvalRequestId', existing_request.id,
        'status', 'awaiting_approval',
        'alreadyRequested', true
      );
    end if;
  end if;

  if post.status not in ('draft_ready', 'rendering', 'changes_requested') then
    raise exception 'invalid_status';
  end if;

  select
    coalesce(bool_and(coalesce(self_approval_allowed, true)), true),
    coalesce(bool_and(coalesce(allow_same_reviewer_across_stages, true)), true),
    coalesce(bool_or(coalesce(review_required, false)), false)
  into effective_self_approval_allowed, effective_allow_same_reviewer, any_review_required
  from public.policy_settings
  where organization_id = post.organization_id
    and (
      scope = 'organization'
      or (scope = 'department' and department_id = post.department_id)
      or (scope = 'team' and post.team_id is not null and team_id = post.team_id)
    );

  contains_minors := 'minor' = any(coalesce(version.safety_flags, '{}'));
  author_is_minor := authz.is_profile_minor(post.organization_id, version.created_by_user_id);

  for route_row in select * from authz.resolve_review_route(target_post_version_id) loop
    position_counter := position_counter + 1;
    stage := jsonb_build_object(
      'position', position_counter, 'scope', route_row.scope,
      'scopeDepartmentId', route_row.scope_department_id, 'scopeTeamId', route_row.scope_team_id,
      'label', route_row.label, 'mode', route_row.mode, 'minimumApprovals', route_row.minimum_approvals,
      'isMinorStage', route_row.is_minor_stage,
      'reviewerSnapshot', (select coalesce(jsonb_agg(jsonb_build_object('userId', uid)), '[]'::jsonb) from unnest(route_row.reviewer_user_ids) uid),
      'deadlineHours', route_row.deadline_hours
    );
    stages := stages || jsonb_build_array(stage);
  end loop;

  perform authz.assert_valid_stage_list(
    post.organization_id, version.created_by_user_id, contains_minors, author_is_minor, any_review_required,
    effective_self_approval_allowed, stages
  );

  if jsonb_array_length(stages) = 0 then
    update public.posts set status = 'approved', updated_at = now() where id = post.id;
    return jsonb_build_object('postId', post.id, 'status', 'approved', 'stages', '[]'::jsonb, 'alreadyRequested', false);
  end if;

  insert into public.approval_requests (
    organization_id, post_id, post_version_id, required_approvals, requires_minor_approval,
    self_approval_allowed, allow_same_reviewer_across_stages
  ) values (
    post.organization_id, post.id, version.id, 1, false,
    effective_self_approval_allowed, effective_allow_same_reviewer
  ) returning id into new_request_id;

  for stage in select * from jsonb_array_elements(stages) order by (value->>'position')::integer loop
    total_minimum_approvals := total_minimum_approvals + (stage->>'minimumApprovals')::integer;
    any_minor_stage := any_minor_stage or (stage->>'isMinorStage')::boolean;
    insert into public.approval_stages (
      organization_id, approval_request_id, position, scope, scope_department_id, scope_team_id,
      label, mode, minimum_approvals, is_minor_stage, reviewer_snapshot, status, deadline_hours,
      opened_at, deadline_at
    ) values (
      post.organization_id, new_request_id, (stage->>'position')::integer,
      (stage->>'scope')::public.policy_scope, (stage->>'scopeDepartmentId')::uuid, (stage->>'scopeTeamId')::uuid,
      stage->>'label', (stage->>'mode')::public.review_mode, (stage->>'minimumApprovals')::integer,
      (stage->>'isMinorStage')::boolean, coalesce(stage->'reviewerSnapshot', '[]'::jsonb),
      case when (stage->>'position')::integer = 1 then 'open' else 'pending' end,
      (stage->>'deadlineHours')::integer,
      case when (stage->>'position')::integer = 1 then now() else null end,
      case when (stage->>'position')::integer = 1 and stage->>'deadlineHours' is not null
        then now() + ((stage->>'deadlineHours')::integer || ' hours')::interval else null end
    ) returning id into new_stage_id;
    if (stage->>'position')::integer = 1 then first_stage_id := new_stage_id; end if;
  end loop;

  update public.approval_requests set required_approvals = total_minimum_approvals, requires_minor_approval = any_minor_stage where id = new_request_id;
  update public.posts set status = 'awaiting_approval', updated_at = now() where id = post.id;

  return jsonb_build_object('postId', post.id, 'approvalRequestId', new_request_id, 'status', 'awaiting_approval', 'firstStageId', first_stage_id, 'alreadyRequested', false);
end;
$$;
revoke all on function public.request_approval(uuid) from public;
grant execute on function public.request_approval(uuid) to authenticated;

commit;
