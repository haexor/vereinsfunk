begin;

-- "Anlass" (preset_slug) faellt aus der Textwerkstatt komplett weg: die daran haengende
-- Pflichtfakten-Pruefung je Anlasstyp (getPreset/validateSourceMaterial, content-engine) war HIER,
-- im Textwerkstatt-Pfad (createTextGroundedContentBrief), nie mehr als ein weiches Signal im
-- Prompt und hat nie eine Generierung blockiert -- die harte Grundlage ist seit jeher die
-- source_material-CHECK unten (mindestens ein Fakt, eine Beobachtung oder ein Zitat) und
-- assertGroundedPost() gegen die bestaetigten Quellen, beides unabhaengig vom Anlass. Zusaetzlich
-- war das UI-Feld Freitext -- ein Tippfehler gegenueber einem bekannten Preset-Slug schaltete die
-- Pruefung lautlos ab, ohne dass es auffiel.
--
-- Die Foto-Pipeline (public.submissions, /v1/submissions) behaelt ihren eigenen preset_slug und
-- ist von dieser Migration nicht betroffen -- dort ist dieselbe Pruefung (missingFacts ueber
-- createGroundedContentBrief) weiterhin eine echte Sperre: fehlende Pflichtfakten lassen die
-- Route den Beitrag nur als "facts_required" anlegen, nie einen Post/Post_version. preset_slug
-- bestimmt dort ausserdem die Layout-Familie (content-engine layoutFor()) und ist Teil der
-- "Erlaubte Anlaesse"-Policy (policies.allowedPresets, evaluateSubmitPermission). Diese Migration
-- fasst nur composition_sessions/create_text_generation_session an.

-- create or replace kann eine mittig entfernte Parameterliste nicht ersetzen (siehe bereits
-- 2026081204/2026081309, die denselben Drop-Schritt fuer eine eingefuegte Spalte brauchten) --
-- ohne drop bliebe der alte, ueberladene Funktionskopf mit p_preset_slug bestehen.
drop function if exists public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, text);

alter table public.composition_sessions drop column preset_slug;

create function public.create_text_generation_session(
  p_organization_id uuid, p_department_id uuid, p_team_id uuid,
  p_communication_goal text, p_requested_formats jsonb, p_source_material jsonb,
  p_style_profile_id uuid, p_style_profile_snapshot jsonb, p_effective_config_snapshot jsonb,
  p_target_platforms text[], p_max_characters integer, p_temperature numeric,
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
    -- The first candidate of a brand new session is already reflected in this column's default
    -- (1, set below); every additional candidate on an existing session increments it here, once,
    -- so the ceiling below applies identically to a manual revision and an automatic recovery.
    if session_row.candidate_count >= 8 then raise exception 'composition_session_candidate_limit_reached'; end if;
    update public.composition_sessions set candidate_count = candidate_count + 1 where id = session_row.id;
  else
    insert into public.composition_sessions (
      organization_id, department_id, team_id, communication_goal, requested_formats,
      source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot,
      target_platforms, max_characters, temperature,
      source_revision, input_hash, status, created_by
    ) values (
      p_organization_id, p_department_id, p_team_id, p_communication_goal, p_requested_formats,
      p_source_material, p_style_profile_id, p_style_profile_snapshot, p_effective_config_snapshot,
      p_target_platforms, p_max_characters, p_temperature,
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

revoke all on function public.create_text_generation_session(uuid, uuid, uuid, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_text_generation_session(uuid, uuid, uuid, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, text) to service_role;

commit;
