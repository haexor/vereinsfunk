begin;

-- Paket 023, "Umsetzung 2.": die Mitglieder-Detailebene soll die Befristung (expires_at) einer
-- bestehenden Mitgliedschaft setzen koennen -- die Spalte existiert seit Paket 010 auf allen drei
-- Mitgliedschaftstabellen, aber weder POST /v1/memberships noch PATCH /v1/memberships/:id nehmen
-- sie je entgegen. Eine eigene, schmale RPC statt change_membership_role() zu erweitern: eine
-- Befristung aendern ist kein Rollenwechsel und soll ohne can_assign_role-Pruefung einer neuen
-- Rolle moeglich sein. Dieselbe Eskalationspruefung wie dort (can_remove_role gegen die AKTUELLE
-- Rolle) verhindert, dass ein department_admin die Befristung eines organization_owner setzt.
create or replace function public.set_membership_expiry(
  target_scope text, target_membership_id uuid, target_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_organization_id uuid;
  member_department_id uuid;
  member_team_id uuid;
  member_role text;
begin
  if target_scope = 'organization' then
    select organization_id, role::text into member_organization_id, member_role
      from public.organization_memberships where id = target_membership_id for update;
  elsif target_scope = 'department' then
    select organization_id, department_id, role::text into member_organization_id, member_department_id, member_role
      from public.department_memberships where id = target_membership_id for update;
  elsif target_scope = 'team' then
    select organization_id, department_id, team_id, role::text into member_organization_id, member_department_id, member_team_id, member_role
      from public.team_memberships where id = target_membership_id for update;
  else
    raise exception 'invalid_scope';
  end if;
  if not found then
    raise exception 'not_found';
  end if;

  if target_scope = 'organization' then
    if not authz.has_organization_permission(member_organization_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  elsif target_scope = 'department' then
    if not authz.has_department_permission(member_department_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  else
    if not authz.has_team_permission(member_team_id, 'member.invite') then raise exception 'insufficient_permission'; end if;
  end if;
  if not authz.can_remove_role(member_organization_id, member_department_id, member_team_id, member_role) then
    raise exception 'insufficient_permission';
  end if;

  -- prevent_last_owner_removal() greift nur bei einem echten DELETE -- eine Befristung entfernt
  -- die Zeile nie, sie laesst sie nur irgendwann als abgelaufen gelten (dieselbe Semantik wie
  -- expires_at is null or expires_at > now() ueberall sonst). Ohne diese Pruefung koennte ein
  -- organization_owner sich selbst befristen und den Verein dadurch eigentuemerlos zuruecklassen,
  -- ohne dass der DELETE-Trigger je greift (beim Review gefunden).
  if target_scope = 'organization' and member_role = 'organization_owner' and target_expires_at is not null then
    if not exists (
      select 1 from public.organization_memberships
      where organization_id = member_organization_id
        and role = 'organization_owner'
        and id <> target_membership_id
        and (expires_at is null or expires_at > now())
    ) then
      raise exception 'the last organization_owner cannot be removed';
    end if;
  end if;

  if target_scope = 'organization' then
    update public.organization_memberships set expires_at = target_expires_at where id = target_membership_id;
  elsif target_scope = 'department' then
    update public.department_memberships set expires_at = target_expires_at where id = target_membership_id;
  else
    update public.team_memberships set expires_at = target_expires_at where id = target_membership_id;
  end if;

  return jsonb_build_object('membershipId', target_membership_id, 'expiresAt', target_expires_at);
end;
$$;
revoke all on function public.set_membership_expiry(text, uuid, timestamptz) from public;
grant execute on function public.set_membership_expiry(text, uuid, timestamptz) to authenticated;

commit;
