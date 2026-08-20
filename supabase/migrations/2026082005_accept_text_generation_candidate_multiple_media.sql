begin;

-- Plan 047, PR 0: accept_text_generation_candidate nimmt jetzt ein Array von Medien-Derivat-IDs
-- statt hoechstens einer -- Gegenstueck zur Lockerung von composition_session_post_media
-- (2026082004). Die Reihenfolge im Array wird zur position der entstehenden post_media-Zeilen;
-- Index 0 wird 'primary', alles danach 'slide' (dieselbe Konvention wie apps/api/src/routes/
-- publishing.ts). CREATE OR REPLACE allein wuerde die alte Zweiargument-Skalar-Signatur nicht
-- ersetzen, sondern eine zweite, ueberladene Variante daneben anlegen (Postgres identifiziert eine
-- Funktion ueber Name UND Parameterliste, dieselbe Lehre wie beim Anlegen des dritten Parameters
-- in 2026081803) -- deshalb zuerst die alte Signatur explizit droppen.
drop function if exists public.accept_text_generation_candidate(uuid, uuid, uuid);

create or replace function public.accept_text_generation_candidate(
  p_candidate_id uuid, p_actor_user_id uuid, p_media_derivative_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate public.generation_candidates%rowtype;
  session_row public.composition_sessions%rowtype;
  post_row public.posts%rowtype;
  version_id uuid;
  next_version_number integer;
  media_derivative_id uuid;
  media_position integer;
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
  if p_media_derivative_ids is not null then
    foreach media_derivative_id in array p_media_derivative_ids loop
      if not exists (
        select 1 from public.media_derivatives where id = media_derivative_id and organization_id = candidate.organization_id and status = 'ready'
      ) then
        raise exception 'invalid_media_derivative';
      end if;
    end loop;
  end if;

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
  -- ON CONFLICT DO NOTHING statt eines gewoehnlichen insert: der accepted-Kurzschluss oben greift
  -- nur bei einem WIEDERHOLTEN Aufruf desselben Kandidaten, schuetzt hier also nicht direkt --
  -- er sorgt aber dafuer, dass version_id bei einem Retry NIE neu entsteht, wodurch dieser insert
  -- bei einem echten Retry gar nicht erst erreicht wird. Der Conflict-Schutz selbst ist
  -- Tiefenverteidigung fuer den unwahrscheinlichen Fall, dass irgendein anderer Pfad bereits eine
  -- post_media-Zeile auf derselben Position dieser Version angelegt hat.
  if p_media_derivative_ids is not null then
    media_position := 0;
    foreach media_derivative_id in array p_media_derivative_ids loop
      insert into public.post_media (organization_id, post_version_id, media_derivative_id, position, role)
      values (session_row.organization_id, version_id, media_derivative_id, media_position, case when media_position = 0 then 'primary' else 'slide' end)
      on conflict (post_version_id, position) do nothing;
      media_position := media_position + 1;
    end loop;
  end if;
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

revoke all on function public.accept_text_generation_candidate(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.accept_text_generation_candidate(uuid, uuid, uuid[]) to service_role;

commit;
