begin;

-- Ein abgestürzter API-Prozess darf eine bereits reservierte Aktion nicht dauerhaft sperren.
-- Die Bereinigung geschieht vor jedem Claim im selben Mandanten; eine fehlgeschlagene Aktion wird
-- bewusst nicht erneut ausgeführt, sondern bleibt für Diagnose und eine neue Nutzeraktion sichtbar.
create or replace function public.claim_agent_action_proposal(
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
  set status = 'failed'
  where organization_id = target_organization_id
    and status = 'executing'
    and execution_started_at <= now() - interval '15 minutes';

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
