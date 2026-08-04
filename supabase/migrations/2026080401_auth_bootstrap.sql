begin;

-- Profile entsteht beim Registrieren, nicht durch manuelles Seeding.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Rueckfallebene fuer Nutzer, die vor diesem Trigger in auth.users existierten (z. B. Seed-Daten).
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());
grant insert on table public.profiles to authenticated;

create or replace function authz.has_team_permission(target_team_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_memberships membership
    where membership.team_id = target_team_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'team_manager' then permission = any(array['post.create','post.edit','post.submit','analytics.view'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.teams team
    where team.id = target_team_id
      and authz.has_department_permission(team.department_id, permission)
  );
$$;

grant execute on function authz.has_team_permission(uuid, text) to authenticated, service_role;

-- Liefert fuer auth.uid() alle Scopes mit Rollen in einem Aufruf, damit die Oberflaeche
-- nicht drei Membership-Tabellen einzeln abfragen muss, um Sidebar und Scope-Wahl zu fuellen.
create or replace function authz.membership_scopes()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(org_scope), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'organizationId', organization.id,
      'organizationName', organization.name,
      'organizationRoles', (
        select coalesce(jsonb_agg(org_membership.role), '[]'::jsonb)
        from public.organization_memberships org_membership
        where org_membership.organization_id = organization.id
          and org_membership.user_id = auth.uid()
          and (org_membership.expires_at is null or org_membership.expires_at > now())
      ),
      'departments', (
        select coalesce(jsonb_agg(department_scope), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'id', department.id,
            'name', department.name,
            'roles', (
              select coalesce(jsonb_agg(department_membership.role), '[]'::jsonb)
              from public.department_memberships department_membership
              where department_membership.department_id = department.id
                and department_membership.user_id = auth.uid()
                and (department_membership.expires_at is null or department_membership.expires_at > now())
            ),
            'teams', (
              select coalesce(jsonb_agg(team_scope), '[]'::jsonb)
              from (
                select jsonb_build_object(
                  'id', team.id,
                  'name', team.name,
                  'roles', (
                    select coalesce(jsonb_agg(team_membership.role), '[]'::jsonb)
                    from public.team_memberships team_membership
                    where team_membership.team_id = team.id
                      and team_membership.user_id = auth.uid()
                      and (team_membership.expires_at is null or team_membership.expires_at > now())
                  )
                ) as team_scope
                from public.teams team
                where team.department_id = department.id
                  and authz.is_department_member(department.id)
              ) team_rows
            )
          ) as department_scope
          from public.departments department
          where department.organization_id = organization.id
            and authz.is_department_member(department.id)
        ) department_rows
      )
    ) as org_scope
    from public.organizations organization
    where authz.is_organization_member(organization.id)
  ) org_rows;
$$;

grant execute on function authz.membership_scopes() to authenticated, service_role;

commit;
