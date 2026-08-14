begin;

-- Analog public.jsonb_text_array_is_distinct (2026081003): eine CHECK-Expression darf keine
-- Unterabfrage enthalten, der count(distinct ...)-Vergleich gegen doppelte Array-Elemente braucht
-- deshalb diesen kleinen immutablen Helfer. Eigene text[]-Variante, weil target_platforms anders
-- als requested_formats eine echte Postgres-Array-Spalte ist und kein jsonb.
create or replace function public.text_array_is_distinct(value text[])
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select count(*) = count(distinct element) from unnest(value) as element;
$$;

-- target_platforms ist ein direktes Merkmal der Sitzung (wie preset_slug/communication_goal), kein
-- Snapshot. Mehrfachauswahl, weil ein Verein denselben Beitrag ueblicherweise auf mehreren
-- Plattformen veroeffentlicht; max_characters wird dann aus der RESTRIKTIVSTEN Auswahl abgeleitet
-- (min ueber die gewaehlten Plattformen, siehe apps/api/src/routes/content.ts), damit der eine Text
-- ueberall passt. Bei stark abweichenden Grenzen ist das die falsche Antwort -- dann gehoeren
-- getrennte Texte je Plattform her (Plan 005). Die Aufloesung geschieht bei Anlage EINMAL und ist danach
-- eingefroren -- dieselbe Begruendung wie effective_config_snapshot/style_profile_snapshot.
-- temperature ist die direkte Nutzerwahl am Beitrag, auf die vier Regler-Stufen begrenzt
-- (Dezent/Ausgewogen/Ausgepraegt/Vollgas -- siehe packages/contracts/src/content.ts
-- TEXT_GENERATION_TEMPERATURE_STEPS).
--
-- Kein CHECK auf "mindestens eine Plattform", obwohl CreateCompositionSessionSchema genau das
-- verlangt: bestehende Sitzungen haben nie eine Plattform gewaehlt, ein solcher CHECK wuerde also
-- verlangen, ihnen ruecklings eine anzudichten. Das leere Array bedeutet hier ehrlich "keine
-- Angabe" und kommt ausschliesslich aus der Vergangenheit, nicht aus der API.
alter table public.composition_sessions
  add column target_platforms text[] not null default array[]::text[]
    check (target_platforms <@ array['instagram', 'facebook']::text[] and public.text_array_is_distinct(target_platforms)),
  add column max_characters integer not null default 2200 check (max_characters between 100 and 10000),
  add column temperature numeric not null default 0.6 check (temperature in (0.3, 0.6, 0.8, 1.0));

-- create or replace kann eine mittig eingefuegte Parameterliste nicht ersetzen (Postgres erlaubt
-- das nur fuer rein angehaengte Default-Parameter, siehe 2026081204, das denselben Drop-Schritt
-- schon einmal brauchte) -- ohne drop wuerde ein zweiter, ueberladener Funktionskopf mit der alten
-- Signatur bestehen bleiben.
drop function if exists public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, integer, text, text, text, text, uuid, uuid, text, text);

create function public.create_text_generation_session(
  p_organization_id uuid, p_department_id uuid, p_team_id uuid, p_preset_slug text,
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
      organization_id, department_id, team_id, preset_slug, communication_goal, requested_formats,
      source_material, style_profile_id, style_profile_snapshot, effective_config_snapshot,
      target_platforms, max_characters, temperature,
      source_revision, input_hash, status, created_by
    ) values (
      p_organization_id, p_department_id, p_team_id, p_preset_slug, p_communication_goal, p_requested_formats,
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

revoke all on function public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_text_generation_session(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, text) to service_role;

commit;
