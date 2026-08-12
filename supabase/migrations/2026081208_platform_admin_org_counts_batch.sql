begin;

-- GET /v1/platform-admin/organizations laedt alle Vereine ueber fetchAllRows und rief danach je
-- Verein zwei count-Abfragen einzeln auf (Mitglieder, Abteilungen) -- ein Round-Trip-Paar pro
-- Zeile (N+1), bei 1000 Vereinen also 2000 gleichzeitige Requests innerhalb einer einzigen
-- HTTP-Anfrage. Dieselbe Klasse Fund wie bei GET /v1/analytics/summary
-- (count_publications_for_quotas, Migration 2026081207), hier fuer die Plattformuebersicht.
create or replace function public.count_platform_admin_organization_totals(
  target_organization_ids uuid[]
) returns table (organization_id uuid, member_count integer, department_count integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select ids.organization_id,
         coalesce(member_counts.count, 0)::integer,
         coalesce(department_counts.count, 0)::integer
  from unnest(target_organization_ids) as ids(organization_id)
  left join (
    select organization_id, count(*) as count from public.organization_memberships
    where organization_id = any(target_organization_ids)
    group by organization_id
  ) member_counts on member_counts.organization_id = ids.organization_id
  left join (
    select organization_id, count(*) as count from public.departments
    where organization_id = any(target_organization_ids)
    group by organization_id
  ) department_counts on department_counts.organization_id = ids.organization_id;
$$;

-- Dieselbe Begruendung wie bei count_publications_for_quotas: kein Mitgliedschafts-Check in der
-- Funktion, ein Grant an authenticated legte Mitglieder-/Abteilungszahlen fremder Vereine offen.
-- Die Route prueft requirePlatformAdmin, bevor sie aufruft.
revoke all on function public.count_platform_admin_organization_totals(uuid[]) from public;
grant execute on function public.count_platform_admin_organization_totals(uuid[]) to service_role;

commit;
