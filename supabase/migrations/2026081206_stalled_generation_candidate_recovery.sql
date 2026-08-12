begin;

-- The 15-minute lease recovery in acquire_generation_candidate can only ever fire on the next
-- *call* of that function -- and after a real worker crash, nothing calls it again (Hatchet's own
-- retry budget is exhausted long before the 15-minute threshold; see plans/035). This function is
-- the independent trigger. It deliberately does NOT terminally fail the candidate here: the caller
-- still has to load the session and create a replacement attempt over the network, and a crash in
-- that window must not lose the row. Instead it only refreshes the fencing token and updated_at --
-- mirrors acquire_generation_candidate's own reclaim, not mark_generation_candidate_failed -- so a
-- claim that is never finalized simply becomes claimable again after another 15 minutes.
create or replace function public.claim_stalled_generation_candidates(p_limit integer default 20)
returns table (id uuid, composition_session_id uuid, organization_id uuid, generation_intent text, revision_instruction text, generation_lease_token uuid)
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
  returning c.id, c.composition_session_id, c.organization_id, c.generation_intent, c.revision_instruction, c.generation_lease_token;
end;
$$;

-- Finalizes a claimed candidate once the caller knows the outcome of the replacement attempt (or
-- knows there cannot be one). Fenced by generation_lease_token exactly like mark_generation_candidate_
-- failed, so a delivery that lost its claim to a later scan cannot overwrite the newer state. Unlike
-- mark_generation_candidate_failed, the composition_sessions update is best-effort: if a replacement
-- attempt already advanced the session (e.g. back to 'queued'), there is nothing left to fail here.
create or replace function public.finalize_stalled_generation_recovery(
  p_candidate_id uuid, p_session_id uuid, p_lease_token uuid, p_failure_code text default 'stalled_after_crash'
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.generation_candidates set status = 'failed', failure_code = p_failure_code, generation_lease_token = null, updated_at = now()
    where id = p_candidate_id and composition_session_id = p_session_id and status = 'generating' and generation_lease_token = p_lease_token;
  if not found then raise exception 'generation_candidate_recovery_finalize_lost'; end if;
  update public.composition_sessions set status = 'failed', updated_at = now()
    where id = p_session_id and status = 'generating';
end;
$$;

revoke all on function public.claim_stalled_generation_candidates(integer) from public, anon, authenticated;
revoke all on function public.finalize_stalled_generation_recovery(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_stalled_generation_candidates(integer) to service_role;
grant execute on function public.finalize_stalled_generation_recovery(uuid, uuid, uuid, text) to service_role;

commit;
