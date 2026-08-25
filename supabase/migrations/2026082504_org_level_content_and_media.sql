begin;

-- Org-level posting: department_id becomes optional (NULL = the whole club,
-- not one department) on composition_sessions, text_workshop_drafts,
-- media_assets, posts, post_status_events, workflow_outbox and
-- workflow_runs. Channels (social_connections/channel_scopes) and
-- content_style_profiles were already org-capable; this migration extends
-- the same nullable-FK + org-membership-fallback pattern to the rest of the
-- manual "Beitrag erstellen" flow.
--
-- Deliberately NOT reusing Paket 048's "oldest department as technical
-- carrier" placeholder trick (see start_brand_website_analysis below) for
-- workflow_outbox here: generate-text-post's worker concurrency is grouped
-- by organizationId:departmentId, and a placeholder would silently
-- throttle an org-level post against that real department's own queue.
-- workflow_outbox.payload instead carries an always-present
-- departmentConcurrencyKey ('org' when department_id is null, the real
-- department id text otherwise) that the worker's concurrency expression
-- keys on directly -- see apps/worker/src/workflows.ts.

-- 1. Nullable columns -------------------------------------------------------
alter table public.composition_sessions alter column department_id drop not null;
alter table public.composition_sessions add constraint composition_sessions_team_requires_department check (team_id is null or department_id is not null) not valid;
alter table public.composition_sessions validate constraint composition_sessions_team_requires_department;

alter table public.text_workshop_drafts alter column department_id drop not null;
-- already carries check (team_id is null or department_id is not null), 2026081703.

alter table public.media_assets alter column department_id drop not null;
-- no team_id column on media_assets, nothing else to guard.

alter table public.posts alter column department_id drop not null;
alter table public.posts add constraint posts_team_requires_department check (team_id is null or department_id is not null) not valid;
alter table public.posts validate constraint posts_team_requires_department;

alter table public.post_status_events alter column department_id drop not null;
-- trigger-populated only from posts, which now enforces the team/department check itself.

alter table public.workflow_outbox alter column department_id drop not null;
alter table public.workflow_runs alter column department_id drop not null;
-- both FKs to departments are MATCH SIMPLE composite FKs -- a null department_id already skips
-- FK enforcement for that row, no FK changes needed.

-- 2. RLS: add an org-membership fallback branch alongside each existing
--    department-scoped branch, at the SAME permission level as that branch.
-- ----------------------------------------------------------------------

alter policy composition_sessions_select on public.composition_sessions using (
  created_by = auth.uid()
  or authz.has_department_permission(department_id, 'post.edit')
  or (department_id is null and authz.has_organization_permission(organization_id, 'post.edit'))
  or (team_id is not null and authz.has_team_permission(team_id, 'post.edit'))
);

alter policy composition_session_media_select on public.composition_session_media using (
  exists (select 1 from public.composition_sessions session where session.id = composition_session_id and session.organization_id = composition_session_media.organization_id and (
    session.created_by = auth.uid()
    or authz.has_department_permission(session.department_id, 'post.edit')
    or (session.department_id is null and authz.has_organization_permission(session.organization_id, 'post.edit'))
    or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
  ))
);

alter policy generation_candidates_select on public.generation_candidates using (
  exists (select 1 from public.composition_sessions session where session.id = composition_session_id and session.organization_id = generation_candidates.organization_id and (
    session.created_by = auth.uid()
    or authz.has_department_permission(session.department_id, 'post.edit')
    or (session.department_id is null and authz.has_organization_permission(session.organization_id, 'post.edit'))
    or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
  ))
);

alter policy media_assets_select on public.media_assets using (
  authz.is_department_member(department_id)
  or (department_id is null and authz.is_any_member_of_organization(organization_id))
);
alter policy media_assets_insert on public.media_assets with check (
  created_by = auth.uid() and (
    authz.has_department_permission(department_id, 'post.create')
    or (department_id is null and authz.has_organization_permission(organization_id, 'post.create'))
  )
);
-- media_assets_update was dropped in 2026081801 and never recreated -- all mutation happens
-- through SECURITY DEFINER functions, no RLS UPDATE policy exists to touch.

alter policy posts_select on public.posts using (
  (
    status in ('published', 'scheduled')
    and authz.is_any_member_of_organization(organization_id)
    and authz.resolve_policy_flag(organization_id, department_id, team_id, 'posts_visible_org_wide')
    and authz.post_is_not_confidential_only(organization_id, current_version_id)
  )
  or authz.is_department_member(department_id)
  or (department_id is null and authz.is_any_member_of_organization(organization_id))
  or (team_id is not null and authz.has_team_membership(team_id))
  or authz.is_assigned_reviewer_of_post(id)
);

alter policy post_versions_select on public.post_versions using (
  exists (
    select 1 from public.posts post
    where post.id = post_versions.post_id
      and post.organization_id = post_versions.organization_id
      and (
        (
          post.status in ('published', 'scheduled')
          and authz.is_any_member_of_organization(post.organization_id)
          and authz.resolve_policy_flag(post.organization_id, post.department_id, post.team_id, 'posts_visible_org_wide')
          and authz.post_is_not_confidential_only(post.organization_id, post.current_version_id)
        )
        or authz.is_department_member(post.department_id)
        or (post.department_id is null and authz.is_any_member_of_organization(post.organization_id))
        or (post.team_id is not null and authz.has_team_membership(post.team_id))
      )
  )
  or authz.is_assigned_reviewer(id)
);

-- storage: raw-media objects for an org-level upload live at
-- organizations/<org>/assets/<assetId>/<filename> (no departments/<dept> segment) -- add the
-- matching branch alongside the existing ones.
alter policy storage_read_raw_media on storage.objects using (
  bucket_id = 'raw-media'
  and (storage.foldername(name))[1] = 'organizations'
  and case (storage.foldername(name))[3]
    when 'compliance' then authz.has_organization_permission(((storage.foldername(name))[2])::uuid, 'organization.manage')
    when 'exports' then authz.has_organization_permission(((storage.foldername(name))[2])::uuid, 'organization.manage')
    when 'consents' then
      (storage.foldername(name))[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and authz.can_read_consent_evidence_object(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[4])::uuid)
    when 'departments' then
      (storage.foldername(name))[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and authz.is_department_member(((storage.foldername(name))[4])::uuid)
    when 'brand' then authz.is_any_member_of_organization(((storage.foldername(name))[2])::uuid)
    when 'assets' then authz.is_any_member_of_organization(((storage.foldername(name))[2])::uuid)
    else false
  end
);

-- 3. Backfill: every pre-existing workflow_outbox row was written before departmentConcurrencyKey
--    existed, so its payload lacks the key the new CHECK constraint below is about to require.
--    Postgres re-validates CHECK constraints on every UPDATE of a row, not just when the checked
--    column changes, so a still-pending row would fail its next claim/release update once the
--    function is replaced. department_id was NOT NULL on every affected table until this same
--    migration, so every existing row's real department_id is exactly its concurrency key.
update public.workflow_outbox
  set payload = payload || jsonb_build_object('departmentConcurrencyKey', department_id::text)
  where not (payload ? 'departmentConcurrencyKey');

-- 4. workflow_outbox payload contract: departmentId becomes optional, and a new always-present
--    departmentConcurrencyKey is added to the allowed/required key set.
create or replace function public.is_id_only_workflow_payload(value jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(value) = 'object'
    and value ?& array['entityId', 'organizationId', 'departmentConcurrencyKey', 'correlationId', 'sourceRevision', 'purpose', 'idempotencyKey']
    and not exists (
      select 1 from jsonb_object_keys(value) as key
      where key not in ('submissionId', 'candidateId', 'entityId', 'organizationId', 'departmentId', 'departmentConcurrencyKey', 'teamId', 'correlationId', 'sourceRevision', 'purpose', 'idempotencyKey')
    )
    and coalesce((value->>'entityId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and (not value ? 'candidateId' or (jsonb_typeof(value->'candidateId') = 'string' and coalesce((value->>'candidateId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and coalesce((value->>'organizationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and coalesce((value->>'correlationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    and (not value ? 'submissionId' or (jsonb_typeof(value->'submissionId') = 'string' and coalesce((value->>'submissionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and (not value ? 'submissionId' or value->>'submissionId' = value->>'entityId')
    and (not value ? 'departmentId' or (jsonb_typeof(value->'departmentId') = 'string' and coalesce((value->>'departmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and (not value ? 'teamId' or (jsonb_typeof(value->'teamId') = 'string' and coalesce((value->>'teamId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)))
    and jsonb_typeof(value->'departmentConcurrencyKey') = 'string'
    and ((value->>'departmentConcurrencyKey') = 'org' or coalesce((value->>'departmentConcurrencyKey') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false))
    and jsonb_typeof(value->'sourceRevision') = 'number' and (value->>'sourceRevision') ~ '^[1-9][0-9]*$'
    and jsonb_typeof(value->'purpose') = 'string' and value->>'purpose' = btrim(value->>'purpose') and char_length(value->>'purpose') between 1 and 80
    and jsonb_typeof(value->'idempotencyKey') = 'string' and char_length(value->>'idempotencyKey') between 1 and 240;
$$;

-- 5. create_text_generation_session: same signature (p_department_id was already nullable at the
--    SQL level), body now stamps departmentConcurrencyKey on every workflow_outbox insert.
create or replace function public.create_text_generation_session(
  p_organization_id uuid, p_department_id uuid, p_team_id uuid,
  p_communication_goal text, p_requested_formats jsonb, p_source_material jsonb,
  p_style_profile_id uuid, p_style_profile_snapshot jsonb, p_effective_config_snapshot jsonb,
  p_target_platforms text[], p_max_characters integer, p_temperature numeric,
  p_source_revision integer, p_input_hash text, p_candidate_input_hash text,
  p_generation_intent text, p_revision_instruction text, p_created_by uuid, p_correlation_id uuid,
  p_idempotency_key text, p_provider_configuration_ids uuid[],
  p_triggered_by text default 'member', p_round_input_hash text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  session_row public.composition_sessions%rowtype;
  round_hash text := coalesce(p_round_input_hash, p_candidate_input_hash);
  round_size integer := coalesce(array_length(p_provider_configuration_ids, 1), 0);
  existing_ids uuid[];
  new_ids uuid[] := '{}';
  provider_id uuid;
  candidate_row_hash text;
  new_candidate_id uuid;
  workflow_purpose text;
  department_concurrency_key text := coalesce(p_department_id::text, 'org');
begin
  if p_generation_intent not in ('initial', 'revise') then raise exception 'invalid_generation_intent'; end if;
  if p_generation_intent = 'initial' and p_revision_instruction is not null then raise exception 'initial_generation_has_instruction'; end if;
  if p_generation_intent = 'revise' and (p_revision_instruction is null or p_revision_instruction <> btrim(p_revision_instruction) or char_length(p_revision_instruction) not between 1 and 500) then raise exception 'invalid_revision_instruction'; end if;
  if p_triggered_by not in ('member', 'automatic_recovery') then raise exception 'invalid_triggered_by'; end if;
  if round_size < 1 then raise exception 'invalid_provider_configuration_ids'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_input_hash, 0));
  select * into session_row from public.composition_sessions
    where organization_id = p_organization_id and input_hash = p_input_hash for update;
  if found and p_triggered_by = 'automatic_recovery' then
    provider_id := p_provider_configuration_ids[1];
    candidate_row_hash := encode(extensions.digest(p_candidate_input_hash || ':' || provider_id::text, 'sha256'), 'hex');
    select id into new_candidate_id from public.generation_candidates
      where composition_session_id = session_row.id and input_hash = candidate_row_hash;
    if new_candidate_id is not null then return jsonb_build_object('sessionId', session_row.id, 'candidateIds', array[new_candidate_id]); end if;
    if session_row.candidate_count + 1 > 8 then raise exception 'composition_session_candidate_limit_reached'; end if;
    update public.composition_sessions set candidate_count = candidate_count + 1 where id = session_row.id;
    insert into public.generation_candidates (
      organization_id, composition_session_id, generation_intent, revision_instruction, status,
      input_hash, round_input_hash, provider_configuration_id, triggered_by
    ) values (
      p_organization_id, session_row.id, p_generation_intent, p_revision_instruction, 'pending',
      candidate_row_hash, round_hash, provider_id, p_triggered_by
    ) returning id into new_candidate_id;
    workflow_purpose := p_generation_intent || ':' || new_candidate_id::text;
    insert into public.workflow_outbox (
      organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
    ) values (
      p_organization_id, p_department_id, 'generate-text-post', session_row.id, p_source_revision, workflow_purpose,
      p_correlation_id,
      jsonb_strip_nulls(jsonb_build_object('entityId', session_row.id, 'organizationId', p_organization_id,
        'candidateId', new_candidate_id, 'departmentId', p_department_id, 'departmentConcurrencyKey', department_concurrency_key,
        'teamId', p_team_id, 'correlationId', p_correlation_id,
        'sourceRevision', p_source_revision, 'purpose', workflow_purpose,
        'idempotencyKey', p_idempotency_key || ':' || provider_id::text))
    );
    update public.composition_sessions set status = 'queued', updated_at = now() where id = session_row.id;
    return jsonb_build_object('sessionId', session_row.id, 'candidateIds', array[new_candidate_id]);
  elsif found then
    select array_agg(id) into existing_ids from public.generation_candidates
      where composition_session_id = session_row.id and round_input_hash = round_hash;
    if existing_ids is not null then return jsonb_build_object('sessionId', session_row.id, 'candidateIds', existing_ids); end if;
    if p_generation_intent = 'initial' then raise exception 'composition_session_generation_conflict'; end if;
    if session_row.candidate_count + round_size > 8 then raise exception 'composition_session_candidate_limit_reached'; end if;
    update public.composition_sessions set candidate_count = candidate_count + round_size where id = session_row.id;
  else
    if round_size > 8 then raise exception 'composition_session_candidate_limit_reached'; end if;
    insert into public.composition_sessions (
      organization_id, department_id, team_id, communication_goal, requested_formats,
      source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot,
      target_platforms, max_characters, temperature,
      source_revision, input_hash, status, candidate_count, created_by
    ) values (
      p_organization_id, p_department_id, p_team_id, p_communication_goal, p_requested_formats,
      p_source_material, p_style_profile_id, p_style_profile_snapshot, p_effective_config_snapshot,
      p_target_platforms, p_max_characters, p_temperature,
      p_source_revision, p_input_hash, 'queued', round_size, p_created_by
    ) returning * into session_row;
  end if;

  foreach provider_id in array p_provider_configuration_ids loop
    candidate_row_hash := encode(extensions.digest(p_candidate_input_hash || ':' || provider_id::text, 'sha256'), 'hex');
    insert into public.generation_candidates (
      organization_id, composition_session_id, generation_intent, revision_instruction, status,
      input_hash, round_input_hash, provider_configuration_id, triggered_by
    ) values (
      p_organization_id, session_row.id, p_generation_intent, p_revision_instruction, 'pending',
      candidate_row_hash, round_hash, provider_id, p_triggered_by
    ) returning id into new_candidate_id;
    new_ids := array_append(new_ids, new_candidate_id);

    workflow_purpose := p_generation_intent || ':' || new_candidate_id::text;
    insert into public.workflow_outbox (
      organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
    ) values (
      p_organization_id, p_department_id, 'generate-text-post', session_row.id, p_source_revision, workflow_purpose,
      p_correlation_id,
      jsonb_strip_nulls(jsonb_build_object('entityId', session_row.id, 'organizationId', p_organization_id,
        'candidateId', new_candidate_id, 'departmentId', p_department_id, 'departmentConcurrencyKey', department_concurrency_key,
        'teamId', p_team_id, 'correlationId', p_correlation_id,
        'sourceRevision', p_source_revision, 'purpose', workflow_purpose,
        'idempotencyKey', p_idempotency_key || ':' || provider_id::text))
    );
  end loop;

  update public.composition_sessions set status = 'queued', updated_at = now() where id = session_row.id;
  return jsonb_build_object('sessionId', session_row.id, 'candidateIds', new_ids);
end;
$$;

-- 6. start_brand_website_analysis (Paket 048/049): department_id keeps carrying the organization's
--    technical carrier department for an org-level job (pre-existing behaviour, see
--    brand_website_analysis.test.sql). departmentConcurrencyKey is independent of that carrier --
--    'org' for an org-level job, the real department id otherwise -- so an org-level analysis gets
--    its own concurrency lane instead of silently sharing a real department's.
create or replace function public.start_brand_website_analysis(
  p_organization_id uuid, p_website_url text, p_requested_by uuid, p_department_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_row public.brand_website_analysis_jobs%rowtype;
  carrier_department_id uuid;
  next_revision integer;
  v_correlation_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id and membership.user_id = p_requested_by
        and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.department_memberships membership
      where membership.organization_id = p_organization_id and membership.user_id = p_requested_by
        and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.team_memberships membership
      where membership.organization_id = p_organization_id and membership.user_id = p_requested_by
        and (membership.expires_at is null or membership.expires_at > now())
  ) then raise exception 'requested_by_not_organization_member'; end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments where id = p_department_id and organization_id = p_organization_id
  ) then raise exception 'department_not_in_organization'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || coalesce(p_department_id::text, 'org'), 0));

  if p_department_id is null then
    select * into job_row from public.brand_website_analysis_jobs where organization_id = p_organization_id and department_id is null for update;
  else
    select * into job_row from public.brand_website_analysis_jobs where department_id = p_department_id for update;
  end if;
  if found and job_row.status in ('pending', 'running') then raise exception 'analysis_in_progress'; end if;

  if p_department_id is not null then
    carrier_department_id := p_department_id;
  else
    select id into carrier_department_id from public.departments
      where organization_id = p_organization_id order by created_at asc limit 1;
    if carrier_department_id is null then raise exception 'organization_has_no_department'; end if;
  end if;

  next_revision := coalesce(job_row.revision, 0) + 1;
  if p_department_id is null then
    insert into public.brand_website_analysis_jobs (organization_id, department_id, website_url, status, revision, requested_by, result, error_reason)
    values (p_organization_id, null, p_website_url, 'pending', next_revision, p_requested_by, null, null)
    on conflict (organization_id) where department_id is null do update set
      website_url = excluded.website_url, status = 'pending', revision = excluded.revision,
      requested_by = excluded.requested_by, result = null, error_reason = null, updated_at = now()
    returning * into job_row;
  else
    insert into public.brand_website_analysis_jobs (organization_id, department_id, website_url, status, revision, requested_by, result, error_reason)
    values (p_organization_id, p_department_id, p_website_url, 'pending', next_revision, p_requested_by, null, null)
    on conflict (department_id) where department_id is not null do update set
      website_url = excluded.website_url, status = 'pending', revision = excluded.revision,
      requested_by = excluded.requested_by, result = null, error_reason = null, updated_at = now()
    returning * into job_row;
  end if;

  insert into public.workflow_outbox (
    organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
  ) values (
    p_organization_id, carrier_department_id, 'analyze-website-branding', job_row.id, job_row.revision, 'default', v_correlation_id,
    jsonb_build_object(
      'entityId', job_row.id, 'organizationId', p_organization_id, 'departmentId', carrier_department_id,
      'departmentConcurrencyKey', coalesce(p_department_id::text, 'org'),
      'correlationId', v_correlation_id, 'sourceRevision', job_row.revision, 'purpose', 'default',
      'idempotencyKey', job_row.id::text || ':' || job_row.revision::text
    )
  );
  return jsonb_build_object('jobId', job_row.id);
end;
$$;

-- 7. schedule_publication / request_approval: add an org-fallback branch to the department
--    permission gate. Channel-scope matching, quota-row matching and the policy_settings lookup
--    (request_approval) already degrade correctly on a null post.department_id -- confirmed by
--    reading each site, no change needed there.
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
  if not (
    authz.has_department_permission(post.department_id, 'post.submit')
    or (post.department_id is null and authz.has_organization_permission(post.organization_id, 'post.submit'))
  ) then
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

create or replace function public.schedule_publication(
  target_post_version_id uuid, target_social_connection_id uuid, target_scheduled_for timestamptz
) returns public.publications
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version record;
  post record;
  connection record;
  quota_scope_key text;
  allowed_channels jsonb;
  require_responsible boolean;
  quota_row record;
  content_limit_row record;
  content_limit_found boolean;
  result public.publications;
  media_blockers text[] := '{}';
begin
  select * into version from public.post_versions where id = target_post_version_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into post from public.posts where id = version.post_id and organization_id = version.organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if post.status <> 'approved' then raise exception 'invalid_status'; end if;
  if not (
    authz.has_department_permission(post.department_id, 'post.publish')
    or (post.department_id is null and authz.has_organization_permission(post.organization_id, 'post.publish'))
  ) then
    raise exception 'insufficient_permission';
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.media_assets ma on ma.organization_id = md.organization_id and ma.id = md.media_asset_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and ma.scan_status <> 'clean'
  ) then
    media_blockers := array_append(media_blockers, 'scan_pending');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.media_assets ma on ma.organization_id = md.organization_id and ma.id = md.media_asset_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and ma.people_reviewed_at is null
  ) then
    media_blockers := array_append(media_blockers, 'people_review_pending');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and md.status <> 'ready'
  ) then
    media_blockers := array_append(media_blockers, 'derivative_stale');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.face_regions fr on fr.organization_id = pm.organization_id and fr.media_asset_id = md.media_asset_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and fr.decision = 'pending'
  ) then
    media_blockers := array_append(media_blockers, 'face_pending');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.face_regions fr on fr.organization_id = pm.organization_id and fr.media_asset_id = md.media_asset_id
    left join public.consent_records cr on cr.organization_id = fr.organization_id and cr.id = fr.consent_record_id
    left join public.directory_people dp on dp.organization_id = cr.organization_id and dp.id = cr.directory_person_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and fr.decision = 'consented'
      and (
        cr.id is null
        or cr.revoked_at is not null
        or cr.superseded_by is not null
        or (cr.valid_from is not null and now() < cr.valid_from)
        or (cr.valid_until is not null and now() > cr.valid_until)
        or (coalesce(dp.is_minor, false) and cr.signer_role is distinct from 'guardian')
      )
  ) then
    media_blockers := array_append(media_blockers, 'consent_invalid');
  end if;

  if array_length(media_blockers, 1) > 0 then
    raise exception 'media_gate_blocked: %', array_to_string(media_blockers, ',');
  end if;

  select * into connection from public.social_connections where id = target_social_connection_id and organization_id = post.organization_id;
  if not found then raise exception 'not_found'; end if;
  if connection.status <> 'active' or connection.archived_at is not null then
    raise exception 'channel_not_allowed';
  end if;

  if not exists (
    select 1 from public.channel_scopes grant_row
    where grant_row.social_connection_id = target_social_connection_id
      and grant_row.organization_id = post.organization_id
      and grant_row.can_schedule
      and (
        grant_row.scope = 'organization'
        or (grant_row.scope = 'department' and grant_row.department_id = post.department_id)
        or (grant_row.scope = 'team' and post.team_id is not null and grant_row.team_id = post.team_id)
      )
  ) then
    raise exception 'channel_not_allowed';
  end if;

  select require_channel_responsible into require_responsible
    from public.policy_settings where organization_id = post.organization_id and scope = 'organization';
  if coalesce(require_responsible, false) and connection.responsible_profile_id is null then
    raise exception 'channel_not_allowed';
  end if;

  allowed_channels := version.effective_config_snapshot->'config'->'allowedChannelIds';
  if allowed_channels is not null and jsonb_typeof(allowed_channels) = 'array'
     and not exists (select 1 from jsonb_array_elements_text(allowed_channels) value where value = target_social_connection_id::text) then
    raise exception 'channel_not_allowed';
  end if;

  quota_scope_key := post.organization_id::text;
  perform pg_advisory_xact_lock(hashtextextended(quota_scope_key, 0));

  for quota_row in
    select * from public.channel_quotas
    where organization_id = post.organization_id
      and (social_connection_id is null or social_connection_id = target_social_connection_id)
      and (
        (scope = 'organization')
        or (scope = 'department' and department_id = post.department_id)
        or (scope = 'team' and post.team_id is not null and team_id = post.team_id)
      )
  loop
    if public.count_publications_in_period(
      post.organization_id,
      case quota_row.scope when 'department' then post.department_id when 'team' then post.department_id else null end,
      case quota_row.scope when 'team' then post.team_id else null end,
      quota_row.social_connection_id, quota_row.period, now()
    ) >= quota_row.max_publications then
      raise exception 'quota_exceeded: %/%', quota_row.scope, quota_row.period;
    end if;
  end loop;

  if exists (select 1 from public.organization_subscriptions where organization_id = post.organization_id) then
    content_limit_found := false;
    for content_limit_row in
      select * from public.effective_content_limits(post.organization_id) where media_origin = version.media_origin
    loop
      content_limit_found := true;
      if content_limit_row.media_origin = 'ai_video' and version.ai_generated_video_duration_seconds is not null
         and content_limit_row.max_duration_seconds is not null
         and version.ai_generated_video_duration_seconds > content_limit_row.max_duration_seconds then
        raise exception 'content_duration_exceeded: %/%', version.media_origin, content_limit_row.max_duration_seconds;
      end if;
      if content_limit_row.max_per_month is not null
         and public.count_publications_in_period(post.organization_id, null, null, null, 'month', now(), version.media_origin) >= content_limit_row.max_per_month then
        raise exception 'content_quota_exceeded: %/%', version.media_origin, content_limit_row.max_per_month;
      end if;
    end loop;
    if not content_limit_found then
      raise exception 'content_quota_exceeded: %/0', version.media_origin;
    end if;
  end if;

  insert into public.publications (organization_id, post_version_id, social_connection_id, platform, scheduled_for, idempotency_key)
  values (
    post.organization_id, target_post_version_id, target_social_connection_id, connection.platform, target_scheduled_for,
    'publish:' || target_post_version_id::text || ':' || connection.platform || ':' || target_social_connection_id::text
  )
  returning * into result;

  update public.posts set status = 'scheduled', updated_at = now() where id = post.id;

  return result;
end;
$$;

-- 8. confirm_media_people_review: add the same org-fallback branch as media_assets_select/_insert above.
create or replace function public.confirm_media_people_review(
  target_asset_id uuid, faces_present boolean
) returns public.media_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  asset public.media_assets;
  region_count integer;
  pending_count integer;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into asset from public.media_assets where id = target_asset_id for update;
  if not found then raise exception 'not_found'; end if;
  if not (
    authz.has_department_permission(asset.department_id, 'post.edit')
    or (asset.department_id is null and authz.has_organization_permission(asset.organization_id, 'post.edit'))
  ) then
    raise exception 'insufficient_permission';
  end if;
  select count(*), count(*) filter (where decision = 'pending')
    into region_count, pending_count
    from public.face_regions where media_asset_id = target_asset_id;
  if not faces_present and region_count > 0 then raise exception 'faces_present_mismatch'; end if;
  if faces_present and (region_count = 0 or pending_count > 0) then raise exception 'faces_incomplete'; end if;
  update public.media_assets set people_reviewed_at = now(), people_reviewed_by = auth.uid()
    where id = target_asset_id returning * into asset;
  return asset;
end;
$$;

commit;
