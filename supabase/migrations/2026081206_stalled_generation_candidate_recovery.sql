begin;

-- The 15-minute lease recovery in acquire_generation_candidate can only ever fire on the next
-- *call* of that function -- and after a real worker crash, nothing calls it again (Hatchet's own
-- retry budget is exhausted long before the 15-minute threshold; see plans/035). This function is
-- the independent trigger: it ends a stalled candidate's session honestly and hands back enough
-- to start a fresh attempt, analogous to claim_workflow_outbox (2026081101_workflow_outbox_dispatch.sql).
create or replace function public.claim_stalled_generation_candidates(p_limit integer default 20)
returns table (id uuid, composition_session_id uuid, organization_id uuid, generation_intent text, revision_instruction text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'p_limit must be between 1 and 100' using errcode = '22023'; end if;
  return query with claimable as (
    select c.id from public.generation_candidates c
    where c.status = 'generating' and c.updated_at < now() - interval '15 minutes'
    order by c.updated_at for update skip locked limit p_limit
  ), claimed as (
    update public.generation_candidates c set status = 'failed', failure_code = 'stalled_after_crash', generation_lease_token = null, updated_at = now()
    from claimable where c.id = claimable.id
    returning c.id, c.composition_session_id, c.organization_id, c.generation_intent, c.revision_instruction
  ), session_sync as (
    -- Mirrors mark_generation_candidate_failed's coupled transition: a session must not stay on
    -- 'generating' once its only in-flight candidate has been terminally failed.
    update public.composition_sessions s set status = 'failed', updated_at = now()
    where s.id in (select claimed.composition_session_id from claimed) and s.status = 'generating'
    returning s.id
  )
  select claimed.id, claimed.composition_session_id, claimed.organization_id, claimed.generation_intent, claimed.revision_instruction from claimed;
end;
$$;

revoke all on function public.claim_stalled_generation_candidates(integer) from public, anon, authenticated;
grant execute on function public.claim_stalled_generation_candidates(integer) to service_role;

commit;
