-- create_text_generation_session dedupliziert Runden ueber round_input_hash (reiner Inhalts-Hash):
-- klickt ein Mitglied nach einem Fehlschlag erneut auf "Textkandidaten erzeugen", ohne den
-- Text/die Einstellungen zu aendern, ist der Hash identisch zu vorher. Die Runden-Dedup-Pruefung
-- gab bisher unabhaengig vom Status der vorhandenen Kandidaten immer die existierenden IDs zurueck
-- -- ein Retry landete also wieder auf demselben terminal 'failed'-Kandidaten, ohne dass je eine
-- neue Generierung angestossen wurde. Die Kurzschluss-Rueckgabe greift jetzt nur noch, wenn
-- mindestens ein Kandidat der Runde NICHT 'failed' ist (echtes Duplikat einer laufenden/erfolgreichen
-- Runde) -- eine Runde, in der alle Kandidaten terminal fehlgeschlagen sind, faellt stattdessen in
-- denselben Pfad wie eine neue "revise"-Runde und erzeugt frische Kandidaten fuer dieselbe Sitzung.
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
    -- Nur bei mindestens einem nicht-'failed'-Kandidaten ist das ein echtes Duplikat (laufende oder
    -- bereits erfolgreiche Runde) -- sonst faellt die Pruefung unten durch und erzeugt eine frische
    -- Runde, statt den alten Fehlschlag unveraendert zurueckzugeben.
    if existing_ids is not null and exists (
      select 1 from public.generation_candidates where id = any(existing_ids) and status <> 'failed'
    ) then
      return jsonb_build_object('sessionId', session_row.id, 'candidateIds', existing_ids);
    end if;
    if existing_ids is null and p_generation_intent = 'initial' then raise exception 'composition_session_generation_conflict'; end if;
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
