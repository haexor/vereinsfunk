begin;

-- Paket 046: mark_generation_candidate_ready/_failed, release_generation_candidate und
-- finalize_stalled_generation_recovery setzten composition_sessions.status bisher jeweils mit der
-- Vorbedingung "nur wenn aktuell status = 'generating'" und warfen sonst eine Exception
-- (mark_generation_candidate_ready/_failed) bzw. liessen die Aktualisierung best-effort ausfallen
-- (release_generation_candidate, finalize_stalled_generation_recovery). Das war unkritisch, solange
-- pro Sitzung immer nur ein Kandidat gleichzeitig lief. Sobald eine Runde mehrere Kandidaten
-- gleichzeitig verarbeitet (Paket 046), schaltet der zuerst fertige Kandidat den Sitzungsstatus
-- weiter -- jeder weitere fertige Geschwister-Kandidat trifft die Vorbedingung dann nicht mehr an
-- und wirft "..._update_lost". Bei mark_generation_candidate_ready/_failed reisst diese Exception
-- das gesamte Statement zurueck, inklusive des soeben geschriebenen generated_content/failure_code
-- der eigenen Zeile -- ein Kandidat, der eigentlich erfolgreich fertig wurde, waere fuer den
-- Aufrufer nicht von einem echten Fehler zu unterscheiden.
--
-- Die Loesung ist eine gemeinsame Aggregatfunktion: der Sitzungsstatus wird aus ALLEN Kandidaten
-- derselben Runde (round_input_hash) hergeleitet statt aus einer Einzelvorbedingung. Das Ergebnis
-- ist unabhaengig von der Reihenfolge, in der die Kandidaten fertig werden (kein Race mehr), und
-- deckt bei einer Ensemble-Groesse von 1 exakt dieselben Uebergaenge ab wie zuvor.
create function public.recompute_composition_session_status(p_session_id uuid, p_round_input_hash text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  generating_count integer;
  pending_count integer;
  ready_count integer;
begin
  select count(*) filter (where status = 'generating'), count(*) filter (where status = 'pending'), count(*) filter (where status = 'ready')
    into generating_count, pending_count, ready_count
    from public.generation_candidates
    where composition_session_id = p_session_id and round_input_hash = p_round_input_hash;
  -- Explizit auf den Enum-Typ gecastet: anders als eine einzelne Literal-Zuweisung
  -- ("set status = 'failed'") bleibt eine CASE-Ausdrucks-Zuweisung sonst bei text und
  -- scheitert an der Spalte (42804), da Postgres den Literal-Typ hier nicht mehr herleitet.
  update public.composition_sessions set status = (case
      when generating_count > 0 then 'generating'
      when pending_count > 0 then 'queued'
      when ready_count > 0 then 'candidate_ready'
      else 'failed'
    end)::public.composition_session_status, updated_at = now()
    where id = p_session_id;
end;
$$;
revoke all on function public.recompute_composition_session_status(uuid, text) from public, anon, authenticated;

create or replace function public.mark_generation_candidate_ready(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid, p_generated_content jsonb, p_provider_configuration_id uuid,
  p_provider_model_id text, p_provider_parameter_hash text, p_prompt_template_version text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_round_hash text;
begin
  update public.generation_candidates set status = 'ready', generated_content = p_generated_content,
      provider_configuration_id = p_provider_configuration_id, provider_model_id = p_provider_model_id,
      provider_parameter_hash = p_provider_parameter_hash, prompt_template_version = p_prompt_template_version,
      generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token
    returning round_input_hash into candidate_round_hash;
  if not found then raise exception 'generation_candidate_ready_update_lost'; end if;
  perform public.recompute_composition_session_status(p_session_id, candidate_round_hash);
end;
$$;

create or replace function public.mark_generation_candidate_failed(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid, p_error_class text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_round_hash text;
begin
  update public.generation_candidates set status = 'failed', failure_code = p_error_class, generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token
    returning round_input_hash into candidate_round_hash;
  if not found then raise exception 'generation_candidate_failed_update_lost'; end if;
  perform public.recompute_composition_session_status(p_session_id, candidate_round_hash);
end;
$$;

create or replace function public.release_generation_candidate(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_round_hash text;
begin
  update public.generation_candidates set status = 'pending', generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token
    returning round_input_hash into candidate_round_hash;
  if not found then raise exception 'generation_candidate_release_update_lost'; end if;
  perform public.recompute_composition_session_status(p_session_id, candidate_round_hash);
end;
$$;

-- finalize_stalled_generation_recovery finalisiert dieselbe Art Uebergang wie
-- mark_generation_candidate_failed (ein Kandidat wird terminal 'failed'), bisher aber mit einer
-- eigenen, best-effort-Kopie derselben Vorbedingung. Dieselbe Aggregatfunktion statt einer zweiten,
-- unabhaengig gepflegten Kopie.
create or replace function public.finalize_stalled_generation_recovery(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid, p_failure_code text default 'stalled_after_crash'
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate_round_hash text;
begin
  update public.generation_candidates set status = 'failed', failure_code = p_failure_code, generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token
    returning round_input_hash into candidate_round_hash;
  if not found then raise exception 'generation_candidate_recovery_finalize_lost'; end if;
  perform public.recompute_composition_session_status(p_session_id, candidate_round_hash);
end;
$$;

-- claim_stalled_generation_candidates gibt round_input_hash mit zurueck: die Recovery
-- (apps/worker/src/generationRecovery.ts) braucht ihn, um den Ersatzkandidaten in dieselbe Runde
-- wie den festgefahrenen einzureihen (siehe Erlaeuterung in
-- 2026081903_generation_candidate_ensemble_fan_out.sql) statt eine eigene Ein-Kandidat-Runde
-- anzulegen, die die bereits erfolgreichen Geschwister-Kandidaten aus der Anzeige verlieren wuerde.
-- Der Ausgabespaltensatz aendert sich (returns table), create or replace kann das nicht -- erst
-- droppen.
drop function if exists public.claim_stalled_generation_candidates(integer);

create function public.claim_stalled_generation_candidates(p_limit integer default 20)
returns table (id uuid, composition_session_id uuid, organization_id uuid, generation_intent text, revision_instruction text, generation_lease_token uuid, round_input_hash text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'p_limit must be between 1 and 100' using errcode = '22023'; end if;
  return query with claimable as (
    select c.id from public.generation_candidates c
    where c.status = 'generating' and c.updated_at < now() - interval '15 minutes'
    order by c.updated_at for update skip locked limit p_limit
  )
  update public.generation_candidates c set generation_lease_token = gen_random_uuid(), updated_at = now()
  from claimable where c.id = claimable.id
  returning c.id, c.composition_session_id, c.organization_id, c.generation_intent, c.revision_instruction, c.generation_lease_token, c.round_input_hash;
end;
$$;
revoke all on function public.claim_stalled_generation_candidates(integer) from public, anon, authenticated;
grant execute on function public.claim_stalled_generation_candidates(integer) to service_role;

commit;
