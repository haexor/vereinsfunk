begin;

-- Paket 046: create_text_generation_session erzeugt ab jetzt eine ganze Runde (ein bis N
-- generation_candidates-Zeilen, eine je zugewiesenem LLM-Provider) statt genau einer Zeile.
--
-- Die Provider-Zuweisung passiert HIER, beim Anlegen, nicht erst beim Ausfuehren im Worker: liefe
-- die Auswahl weiterhin ueber "den gerade aktiven Provider" (frueher loadActiveTextProvider() im
-- Worker), wuerden alle N parallelen Worker-Laeufe denselben Provider laden. p_provider_configuration_ids
-- kommt deshalb bereits fertig aufgeloest vom Aufrufer (apps/api/src/routes/content.ts fuer
-- Mitglieder-Anfragen, apps/worker/src/context.ts fuer Recovery) -- dieselbe Arbeitsteilung wie bei
-- p_style_profile_snapshot/p_effective_config_snapshot, die diese Funktion schon heute fertig
-- aufgeloest entgegennimmt statt selbst aufzuloesen.
--
-- p_round_input_hash ist neu und optional: faellt er weg (Regelfall, jede Mitglieder-Anfrage),
-- gruppiert die neue Runde unter p_candidate_input_hash -- fuer eine frische Runde sind beide
-- Werte ohnehin dieselbe Sache. Recovery braucht den Unterschied: eine Recovery ersetzt GENAU EINEN
-- festgefahrenen Kandidaten und muss dessen round_input_hash uebernehmen (nicht ihren eigenen,
-- zwangslaeufig frischen p_candidate_input_hash), sonst wuerde apps/api/src/routes/content.ts
-- "die juengste Runde" nur noch die frische Ein-Kandidat-Recovery-Runde finden und die anderen,
-- bereits erfolgreichen Geschwister-Kandidaten der urspruenglichen Runde aus der Anzeige verlieren.
--
-- Nebenbei gefundener, von diesem Umbau unabhaengiger Fehler wird hier mitbehoben: die Bedingung
-- "eine 'initial'-Runde ohne Treffer auf einer bereits bestehenden Sitzung ist ein Widerspruch" galt
-- bisher fuer JEDEN Aufrufer. Fuer eine Recovery ist genau das aber der Normalfall (ein
-- festgefahrener 'initial'-Kandidat wird unter frischem round_input_hash ersetzt, an derselben,
-- laengst bestehenden Sitzung) -- die Bedingung schlug fuer diesen einen Kandidaten dauerhaft fehl
-- und wurde alle 5 Minuten wiederholt, ohne je zu greifen. Ab hier gilt sie nur noch fuer
-- p_triggered_by = 'member'.
drop function if exists public.create_text_generation_session(uuid, uuid, uuid, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, text);

create function public.create_text_generation_session(
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
    -- Recovery fuegt GENAU EINEN Ersatzkandidaten zu einer bereits bestehenden Runde hinzu --
    -- anders als ein Mitglied startet sie nie eine neue Runde. Die round-weite Idempotenzprüfung
    -- unten (bezogen auf ALLE Zeilen der Runde) passt hier nicht: die Runde enthaelt bereits andere,
    -- unbeteiligte Geschwister-Kandidaten, die kein Zeichen einer Wiederholung sind. Idempotenz
    -- wirkt hier stattdessen auf Zeilenebene, wie schon vor diesem Paket: derselbe festgefahrene
    -- Kandidat erneut zu recovern (weil das Finalisieren zuvor abgestuerzt ist) darf keine zweite
    -- Ersatzzeile anlegen.
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
        'candidateId', new_candidate_id, 'departmentId', p_department_id, 'teamId', p_team_id, 'correlationId', p_correlation_id,
        'sourceRevision', p_source_revision, 'purpose', workflow_purpose,
        'idempotencyKey', p_idempotency_key || ':' || provider_id::text))
    );
    update public.composition_sessions set status = 'queued', updated_at = now() where id = session_row.id;
    return jsonb_build_object('sessionId', session_row.id, 'candidateIds', array[new_candidate_id]);
  elsif found then
    -- Ein echter Wiederholungsversuch derselben Runde (gleicher round_hash) bleibt idempotent und
    -- liefert die vorhandenen Kandidaten zurueck, statt eine zweite Runde anzulegen -- auch dann,
    -- wenn sich die Provider-Auswahl zwischenzeitlich geaendert hat (dieselbe Haltung wie beim
    -- Einfrieren von target_platforms/max_characters/temperature: eine Wiederholung bleibt
    -- idempotent gegenueber einer zwischenzeitlichen Betreiber-Aenderung).
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
    -- Je Zeile eindeutig (bestehende unique(composition_session_id, input_hash) bleibt bestehen),
    -- die Runde bleibt ueber round_input_hash trotzdem als Gruppe auffindbar.
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
    -- idempotencyKey traegt den Provider mit: Hatchets eigene idempotency-Strategie
    -- (apps/worker/src/workflows.ts, expression: 'input.idempotencyKey') dedupliziert Auslieferungen
    -- mit demselben Schluessel. Ohne die provider_id-Beimischung wuerden alle N Zeilen einer Runde
    -- denselben Schluessel tragen und Hatchet liesse nur eine davon tatsaechlich laufen.
    insert into public.workflow_outbox (
      organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
    ) values (
      p_organization_id, p_department_id, 'generate-text-post', session_row.id, p_source_revision, workflow_purpose,
      p_correlation_id,
      jsonb_strip_nulls(jsonb_build_object('entityId', session_row.id, 'organizationId', p_organization_id,
        'candidateId', new_candidate_id, 'departmentId', p_department_id, 'teamId', p_team_id, 'correlationId', p_correlation_id,
        'sourceRevision', p_source_revision, 'purpose', workflow_purpose,
        'idempotencyKey', p_idempotency_key || ':' || provider_id::text))
    );
  end loop;

  update public.composition_sessions set status = 'queued', updated_at = now() where id = session_row.id;
  return jsonb_build_object('sessionId', session_row.id, 'candidateIds', new_ids);
end;
$$;

revoke all on function public.create_text_generation_session(uuid, uuid, uuid, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.create_text_generation_session(uuid, uuid, uuid, text, jsonb, jsonb, uuid, jsonb, jsonb, text[], integer, numeric, integer, text, text, text, text, uuid, uuid, text, uuid[], text, text) to service_role;

-- acquire_generation_candidate gibt provider_configuration_id mit zurueck: der Worker
-- (apps/worker/src/textGeneration.ts) laedt ab jetzt den der Zeile fest zugewiesenen Provider statt
-- "den gerade aktiven" (siehe Erlaeuterung oben).
create or replace function public.acquire_generation_candidate(
  p_candidate_id uuid, p_session_id uuid, p_organization_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_row public.generation_candidates%rowtype;
  current_status public.generation_candidate_status;
begin
  update public.generation_candidates set status = 'generating', updated_at = now(), generation_lease_token = gen_random_uuid()
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id
      and (status = 'pending' or (status = 'generating' and updated_at < now() - interval '15 minutes'))
    returning * into candidate_row;
  if found then
    update public.composition_sessions set status = 'generating', updated_at = now()
      where id = p_session_id and organization_id = p_organization_id;
    if not found then raise exception 'composition_session_acquire_lost'; end if;
    return jsonb_build_object('id', candidate_row.id, 'status', candidate_row.status, 'revision_instruction', candidate_row.revision_instruction, 'lease_token', candidate_row.generation_lease_token, 'provider_configuration_id', candidate_row.provider_configuration_id);
  end if;

  select status into current_status from public.generation_candidates
    where id = p_candidate_id and composition_session_id = p_session_id and organization_id = p_organization_id;
  if current_status = 'generating' then
    raise exception 'generation_candidate_still_in_progress';
  end if;
  return null;
end;
$$;

commit;
