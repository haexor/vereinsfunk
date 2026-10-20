begin;

-- authz.can_assign_role verglich nur Raenge. Die Permission-Mengen sind aber nicht geschachtelt:
-- ein organization_admin (Rang 90) hat kein billing.manage, durfte ueber den Rang jedoch
-- billing_admin (Rang 30, mit billing.manage) einladen oder vergeben -- und sich damit ueber ein
-- zweites Konto die Abrechnung verschaffen. Vergebbar ist jetzt nur noch eine Rolle, deren
-- Permissions der Aufrufer im Zielscope selbst haelt (Spiegel von canAssignRole in
-- packages/authorization). Die Permission-Listen je Rolle sind wie bisher zwischen TS
-- (rolePermissions) und SQL (has_*_permission) dupliziert; authz.role_permissions fasst sie fuer
-- diese Pruefung zusammen, ein pgTAP-Test haelt sie deckungsgleich mit has_*_permission.
create or replace function authz.role_permissions(role text) returns text[]
language sql immutable set search_path = pg_catalog as $$
  select case role
    when 'organization_owner' then array['organization.manage','department.manage','team.manage','member.invite','member.remove','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','billing.manage','directory.read','integration.manage','fixture.manage','event.manage','consent.manage','training.view','training.manage','playerboard.manage']
    when 'organization_admin' then array['organization.manage','department.manage','team.manage','member.invite','member.remove','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','directory.read','integration.manage','fixture.manage','event.manage','consent.manage','training.view','training.manage','playerboard.manage']
    when 'social_manager' then array['post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','analytics.view']
    when 'billing_admin' then array['billing.manage','analytics.view']
    when 'organization_viewer' then array['analytics.view']
    when 'department_admin' then array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','directory.read','integration.manage','fixture.manage','event.manage','consent.manage','training.view','training.manage','playerboard.manage']
    when 'editor' then array['post.create','post.edit','post.submit','analytics.view']
    when 'approver' then array['post.approve','analytics.view']
    when 'contributor' then array['post.create','post.submit']
    when 'viewer' then array['analytics.view']
    when 'team_manager' then array['post.create','post.edit','post.submit','analytics.view','member.invite','member.remove','brand.manage','directory.read','training.view','training.manage','playerboard.manage']
    when 'player' then array['training.view']
    else array[]::text[]
  end;
$$;
revoke all on function authz.role_permissions(text) from public;

create or replace function authz.can_assign_role(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, role text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role <> 'organization_owner'
    and authz.role_rank(role) <= authz.actor_max_role_rank(target_organization_id, target_department_id, target_team_id)
    and not exists (
      select 1 from unnest(authz.role_permissions(role)) as granted(permission)
      where not case
        when target_team_id is not null then authz.has_team_permission(target_team_id, granted.permission)
        when target_department_id is not null then authz.has_department_permission(target_department_id, granted.permission)
        else authz.has_organization_permission(target_organization_id, granted.permission)
      end
    );
$$;
revoke all on function authz.can_assign_role(uuid, uuid, uuid, text) from public;
grant execute on function authz.can_assign_role(uuid, uuid, uuid, text) to authenticated, service_role;

commit;
