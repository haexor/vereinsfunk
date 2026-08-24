begin;

alter table public.agent_action_proposals
  drop constraint agent_action_proposals_status_check,
  add constraint agent_action_proposals_status_check
    check (status in ('pending', 'executing', 'confirmed', 'cancelled', 'expired', 'failed')),
  add column execution_started_at timestamptz;

-- Ein Proposal darf nicht gleichzeitig ausgefuehrt werden. Der bedingte Zustandswechsel ist die
-- atomare Reservierung; ein zweiter Confirm-Aufruf sieht danach niemals mehr `pending`.
create function public.claim_agent_action_proposal(
  target_organization_id uuid,
  target_proposal_id uuid,
  target_owner_id uuid
)
returns public.agent_action_proposals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  proposal public.agent_action_proposals;
begin
  update public.agent_action_proposals
  set status = case when expires_at <= now() then 'expired' else 'executing' end,
      execution_started_at = case when expires_at > now() then clock_timestamp() else null end
  where id = target_proposal_id
    and organization_id = target_organization_id
    and created_by = target_owner_id
    and status = 'pending'
  returning * into proposal;

  if not found then
    raise exception 'agent_proposal_not_pending' using errcode = 'P0002';
  end if;
  return proposal;
end;
$$;

revoke all on function public.claim_agent_action_proposal(uuid, uuid, uuid) from public;
grant execute on function public.claim_agent_action_proposal(uuid, uuid, uuid) to service_role;

commit;
