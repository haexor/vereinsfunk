begin;

-- A member should be able to tell that a result was produced by an automatic post-crash retry
-- rather than something they themselves asked for, without repurposing quality_flags (never
-- written to by any code today) or the failure_code column (terminal-only, not a trigger record).
alter table public.generation_candidates add column triggered_by text not null default 'member' check (triggered_by in ('member', 'automatic_recovery'));

-- Argument list changes below (new p_triggered_by parameter, defaulted so existing callers are
-- unaffected): create or replace cannot alter a function's signature, it would just add an
-- overload alongside the old one.
drop function if exists public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, integer, text, text, text, text, uuid, uuid, text);

create function public.create_text_generation_session(
  p_organization_id uuid, p_department_id uuid, p_team_id uuid, p_preset_slug text,
  p_communication_goal text, p_requested_formats jsonb, p_source_material jsonb,
  p_style_profile_id uuid, p_style_profile_snapshot jsonb, p_effective_config_snapshot jsonb,
  p_source_revision integer, p_input_hash text, p_candidate_input_hash text,
  p_generation_intent text, p_revision_instruction text, p_created_by uuid, p_correlation_id uuid,
  p_idempotency_key text, p_triggered_by text default 'member'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  session_row public.composition_sessions%rowtype;
  candidate_row public.generation_candidates%rowtype;
  workflow_purpose text;
begin
  if p_generation_intent not in ('initial', 'revise') then raise exception 'invalid_generation_intent'; end if;
  if p_generation_intent = 'initial' and p_revision_instruction is not null then raise exception 'initial_generation_has_instruction'; end if;
  if p_generation_intent = 'revise' and (p_revision_instruction is null or p_revision_instruction <> btrim(p_revision_instruction) or char_length(p_revision_instruction) not between 1 and 500) then raise exception 'invalid_revision_instruction'; end if;
  if p_triggered_by not in ('member', 'automatic_recovery') then raise exception 'invalid_triggered_by'; end if;

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
    organization_id, composition_session_id, generation_intent, revision_instruction, status, input_hash, triggered_by
  ) values (
    p_organization_id, session_row.id, p_generation_intent, p_revision_instruction, 'pending', p_candidate_input_hash, p_triggered_by
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

revoke all on function public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, integer, text, text, text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, integer, text, text, text, text, uuid, uuid, text, text) to service_role;

commit;
