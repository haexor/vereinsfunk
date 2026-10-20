begin;

-- authz ist per PostgREST exponiert (supabase/config.toml), und authz.is_user_member_of_organization
-- ist security definer und an authenticated vergeben. Jedes angemeldete Konto konnte damit fuer eine
-- beliebige Person und einen beliebigen Verein abfragen, ob sie dort Mitglied ist -- auch fuer Vereine,
-- denen es selbst nicht angehoert. Entziehen geht nicht: policy_reviewers_insert ruft die Funktion
-- im Kontext des Aufrufers auf. Alle legitimen Aufrufer (diese Policy, set_member_review_trust,
-- assert_valid_stage_list ueber request_approval/reresolve_approval_route) haben vorher eine
-- Berechtigung im selben Verein geprueft; die Service Role (auth.uid() null) bleibt unberuehrt.
create or replace function authz.is_user_member_of_organization(target_user_id uuid, target_organization_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (auth.uid() is null or authz.is_any_member_of_organization(target_organization_id))
    and (
      exists (select 1 from public.organization_memberships m where m.organization_id = target_organization_id and m.user_id = target_user_id and (m.expires_at is null or m.expires_at > now()))
      or exists (select 1 from public.department_memberships m where m.organization_id = target_organization_id and m.user_id = target_user_id and (m.expires_at is null or m.expires_at > now()))
      or exists (select 1 from public.team_memberships m where m.organization_id = target_organization_id and m.user_id = target_user_id and (m.expires_at is null or m.expires_at > now()))
    );
$$;
revoke all on function authz.is_user_member_of_organization(uuid, uuid) from public;
grant execute on function authz.is_user_member_of_organization(uuid, uuid) to authenticated, service_role;

commit;
