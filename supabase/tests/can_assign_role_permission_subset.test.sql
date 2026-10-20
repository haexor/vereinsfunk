begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- 2026101917: authz.can_assign_role verlangt zusaetzlich zum Rang, dass der Aufrufer jede Permission
-- der vergebenen Rolle im Zielscope selbst haelt.
set local role postgres;

insert into public.organizations (id, name, slug) values
  ('a9000000-1000-4000-8000-000000000001', 'PGTAP Rollenvergabe', 'pgtap-rollenvergabe');
insert into public.departments (id, organization_id, name, slug) values
  ('a9000000-1100-4000-8000-000000000001', 'a9000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('a9000000-1200-4000-8000-000000000001', 'a9000000-1000-4000-8000-000000000001', 'a9000000-1100-4000-8000-000000000001', 'U13');

-- Je Rolle ein Konto mit genau dieser einen Rolle (Organisation 0x, Abteilung 1x, Mannschaft 2x).
create temporary table role_fixture (user_id uuid, scope text, role text) on commit drop;
insert into role_fixture values
  ('a9000000-0000-4000-8000-000000000001', 'organization', 'organization_owner'),
  ('a9000000-0000-4000-8000-000000000002', 'organization', 'organization_admin'),
  ('a9000000-0000-4000-8000-000000000003', 'organization', 'social_manager'),
  ('a9000000-0000-4000-8000-000000000004', 'organization', 'billing_admin'),
  ('a9000000-0000-4000-8000-000000000005', 'organization', 'organization_viewer'),
  ('a9000000-0000-4000-8000-000000000011', 'department', 'department_admin'),
  ('a9000000-0000-4000-8000-000000000012', 'department', 'editor'),
  ('a9000000-0000-4000-8000-000000000013', 'department', 'approver'),
  ('a9000000-0000-4000-8000-000000000014', 'department', 'contributor'),
  ('a9000000-0000-4000-8000-000000000015', 'department', 'viewer'),
  ('a9000000-0000-4000-8000-000000000021', 'team', 'team_manager'),
  ('a9000000-0000-4000-8000-000000000022', 'team', 'contributor'),
  ('a9000000-0000-4000-8000-000000000023', 'team', 'viewer'),
  ('a9000000-0000-4000-8000-000000000024', 'team', 'player');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', user_id, 'authenticated', 'authenticated', scope || '-' || role || '@pgtap-role-assign.local', '', '{}', '{}', now(), now()
    from role_fixture;
insert into public.organization_memberships (organization_id, user_id, role)
  select 'a9000000-1000-4000-8000-000000000001', user_id, role::public.organization_role from role_fixture where scope = 'organization';
insert into public.department_memberships (organization_id, department_id, user_id, role)
  select 'a9000000-1000-4000-8000-000000000001', 'a9000000-1100-4000-8000-000000000001', user_id, role::public.department_role from role_fixture where scope = 'department';
insert into public.team_memberships (organization_id, department_id, team_id, user_id, role)
  select 'a9000000-1000-4000-8000-000000000001', 'a9000000-1100-4000-8000-000000000001', 'a9000000-1200-4000-8000-000000000001', user_id, role::public.team_role from role_fixture where scope = 'team';

-- 1: authz.role_permissions deckt sich fuer jede Rolle mit dem, was has_*_permission ihr gewaehrt.
create temporary table role_mismatch (role text, scope text) on commit drop;
do $$
declare
  fixture record;
  all_permissions text[] := authz.role_permissions('organization_owner');
  granted text[];
begin
  for fixture in select * from role_fixture loop
    perform set_config('request.jwt.claim.sub', fixture.user_id::text, true);
    select coalesce(array_agg(p order by p), '{}') into granted from unnest(all_permissions) p
     where case fixture.scope
       when 'organization' then authz.has_organization_permission('a9000000-1000-4000-8000-000000000001', p)
       when 'department' then authz.has_department_permission('a9000000-1100-4000-8000-000000000001', p)
       else authz.has_team_permission('a9000000-1200-4000-8000-000000000001', p)
     end;
    if granted is distinct from (select coalesce(array_agg(p order by p), '{}') from unnest(authz.role_permissions(fixture.role)) p) then
      insert into role_mismatch values (fixture.role, fixture.scope);
    end if;
  end loop;
end;
$$;
select is((select string_agg(scope || ':' || role, ', ') from role_mismatch), null,
  'authz.role_permissions matches has_*_permission for every role');

set local role authenticated;

-- 2-4: der eigentliche Fund -- organization_admin vergibt billing_admin nicht mehr, der Owner schon.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000002', true);
select is(authz.can_assign_role('a9000000-1000-4000-8000-000000000001', null, null, 'billing_admin'), false,
  'negative: organization_admin cannot assign billing_admin, whose billing.manage it lacks');
select is(authz.can_assign_role('a9000000-1000-4000-8000-000000000001', null, null, 'social_manager'), true,
  'organization_admin still assigns social_manager');
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
select is(authz.can_assign_role('a9000000-1000-4000-8000-000000000001', null, null, 'billing_admin'), true,
  'organization_owner still assigns billing_admin');

-- 5-6: die ueblichen Vergaben in Abteilung und Mannschaft bleiben moeglich.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000011', true);
select is(authz.can_assign_role('a9000000-1000-4000-8000-000000000001', 'a9000000-1100-4000-8000-000000000001', 'a9000000-1200-4000-8000-000000000001', 'team_manager'), true,
  'department_admin still assigns team_manager in a team of its department');
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000021', true);
select is(authz.can_assign_role('a9000000-1000-4000-8000-000000000001', 'a9000000-1100-4000-8000-000000000001', 'a9000000-1200-4000-8000-000000000001', 'player'), true,
  'team_manager still assigns player in its own team');

-- 7-8: auch die Einladung (create_invitation) laeuft ueber can_assign_role.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.create_invitation('a9000000-1000-4000-8000-000000000001', null, null, 'kasse@pgtap-role-assign.local', 'billing_admin', repeat('a', 64), null)$$,
  'P0001', 'insufficient_permission', 'negative: organization_admin cannot invite a billing_admin'
);
select lives_ok(
  $$select public.create_invitation('a9000000-1000-4000-8000-000000000001', null, null, 'social@pgtap-role-assign.local', 'social_manager', repeat('b', 64), null)$$,
  'organization_admin still invites a social_manager'
);

select * from finish();
rollback;
