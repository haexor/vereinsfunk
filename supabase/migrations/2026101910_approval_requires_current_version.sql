begin;

-- Freigabe und Einplanung haengen am Post (posts.status = 'approved', gesetzt von
-- decide_approval_stage bzw. dem stufenlosen Zweig von request_approval), die Freigabe selbst aber an
-- genau einer Version (approval_requests.post_version_id). Weder request_approval noch
-- schedule_publication prueften bislang, dass die uebergebene Version die aktuelle des Posts ist --
-- beide sind per grant execute direkt aufrufbar, und die API reicht die ID aus der URL durch:
--   * v2 (aktuell) freigegeben, v1 abgelehnt: schedule_publication(v1) plante den abgelehnten Text
--     ein, weil nur posts.status geprueft wurde;
--   * v2 aktuell, v1 alt: request_approval(v1) loeste die Route fuer v1 auf (deren Sicherheits-
--     merkmale und Verfasser:in, also z. B. ohne Minderjaehrigenstufe), nach deren Freigabe stand der
--     Post auf 'approved' und schedule_publication(v2) plante v2 ohne die fuer v2 noetigen Stufen ein.
-- Beide Funktionen verlangen jetzt die aktuelle Version ('version_not_current').
--
-- Zusaetzlich verlangt schedule_publication, dass die juengste Freigabeanfrage dieser Version nicht
-- invalidiert ist ('approval_invalidated'): die Invalidierungs-Trigger (Medium, Spielplan,
-- Veranstaltung, Einwilligung) setzen nur approval_requests.invalidated_at, nie posts.status -- ein
-- bereits freigegebener Post blieb nach einer Spielverlegung unveraendert einplanbar. Eine Version
-- ganz ohne Anfrage ist der stufenlose Weg (request_approval setzt 'approved' direkt, wenn keine
-- Ebene eine Pruefung verlangt) und bleibt einplanbar. Der Ausweg aus einer invalidierten Freigabe
-- ist eine neue Version (sie setzt den Post auf draft_ready zurueck); reresolve_approval_route
-- greift nur in awaiting_approval.
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
  -- Die Route wird aus Merkmalen DIESER Version abgeleitet, die Freigabe gilt aber fuer den Post --
  -- eine alte Version darf deshalb keine Freigabe fuer die aktuelle erzeugen (Kopfkommentar).
  if version.id is distinct from post.current_version_id then
    raise exception 'version_not_current';
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
  latest_request record;
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
  -- posts.status = 'approved' sagt nur, dass IRGENDEINE Version freigegeben wurde -- eingeplant
  -- werden darf nur die aktuelle, und nur solange ihre Freigabe nicht invalidiert ist. Keine Anfrage
  -- fuer diese Version = stufenloser Weg ohne Pruefpflicht (Kopfkommentar).
  if target_post_version_id is distinct from post.current_version_id then
    raise exception 'version_not_current';
  end if;
  select request.invalidated_at into latest_request
    from public.approval_requests request
   where request.organization_id = post.organization_id and request.post_version_id = target_post_version_id
   order by request.created_at desc, request.id desc
   limit 1;
  if found and latest_request.invalidated_at is not null then
    raise exception 'approval_invalidated';
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

commit;
