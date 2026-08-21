begin;

-- Paket 049: dieselbe KI-Homepage-Analyse wie Paket 048, jetzt auch pro Abteilung statt nur
-- vereinsweit. department_id ist nullable -- null bleibt der bestehende Vereinsfall, gesetzt
-- markiert einen Abteilungs-Job. Zwei partielle Unique-Indizes statt eines einzelnen
-- unique(organization_id), weil Postgres NULL in einem normalen unique-Constraint nicht als
-- "gleich" behandelt und ein einzelner Verein sonst beliebig viele department_id=null-Zeilen
-- anlegen koennte.
alter table public.brand_website_analysis_jobs add column department_id uuid references public.departments(id) on delete cascade;
alter table public.brand_website_analysis_jobs drop constraint brand_website_analysis_jobs_organization_id_key;
create unique index brand_website_analysis_jobs_organization_unique on public.brand_website_analysis_jobs (organization_id) where department_id is null;
create unique index brand_website_analysis_jobs_department_unique on public.brand_website_analysis_jobs (department_id) where department_id is not null;

-- Dieselbe Blaupause wie department_brand_profiles_update (2026080702_brand_assets_and_fonts.sql):
-- ein Abteilungs-Job ist Arbeitszustand fuer die Personen, die das Abteilungs-Branding bearbeiten
-- duerfen, nicht fuer alle Vereinsmitglieder. Der Vereinsfall (department_id is null) behaelt die
-- bisherige Berechtigung unveraendert.
drop policy brand_website_analysis_jobs_select on public.brand_website_analysis_jobs;
create policy brand_website_analysis_jobs_select on public.brand_website_analysis_jobs for select to authenticated
  using (
    case when department_id is not null
      then authz.has_department_permission(department_id, 'brand.manage')
      else authz.has_organization_permission(organization_id, 'organization.manage')
    end
  );

-- p_department_id ist neu ans Ende angehaengt (default null). Eine zusaetzliche Parameterzahl ist
-- fuer Postgres ein eigener Funktions-Overload, kein Ersetzen der bestehenden Signatur -- die alte
-- 3-Parameter-Fassung muss deshalb explizit weg, sonst blieben beide Overloads parallel bestehen.
drop function if exists public.start_brand_website_analysis(uuid, text, uuid);
create function public.start_brand_website_analysis(
  p_organization_id uuid, p_website_url text, p_requested_by uuid, p_department_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_row public.brand_website_analysis_jobs%rowtype;
  carrier_department_id uuid;
  next_revision integer;
  v_correlation_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id and membership.user_id = p_requested_by
        and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.department_memberships membership
      where membership.organization_id = p_organization_id and membership.user_id = p_requested_by
        and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.team_memberships membership
      where membership.organization_id = p_organization_id and membership.user_id = p_requested_by
        and (membership.expires_at is null or membership.expires_at > now())
  ) then raise exception 'requested_by_not_organization_member'; end if;

  -- RPC traut dem Aufrufer nicht blind (siehe FK-Referenz-Scope-Pruefung an anderer Stelle im
  -- Projekt): ohne diese Pruefung koennte eine Abteilungs-ID einer FREMDEN Organisation
  -- durchgereicht werden, deren Job-Zeile dann trotzdem unter p_organization_id einsortiert wuerde.
  if p_department_id is not null and not exists (
    select 1 from public.departments where id = p_department_id and organization_id = p_organization_id
  ) then raise exception 'department_not_in_organization'; end if;

  -- Der Lock-Schluessel schliesst die Abteilung ein, damit ein laufender Vereins-Job eine
  -- gleichzeitige Abteilungs-Analyse (und umgekehrt, oder zwei verschiedene Abteilungen) nicht
  -- blockiert -- nur zwei echte Anlaeufe fuer denselben Scope sollen serialisiert werden.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || coalesce(p_department_id::text, 'org'), 0));

  if p_department_id is null then
    select * into job_row from public.brand_website_analysis_jobs where organization_id = p_organization_id and department_id is null for update;
  else
    select * into job_row from public.brand_website_analysis_jobs where department_id = p_department_id for update;
  end if;
  if found and job_row.status in ('pending', 'running') then raise exception 'analysis_in_progress'; end if;

  if p_department_id is not null then
    carrier_department_id := p_department_id;
  else
    select id into carrier_department_id from public.departments
      where organization_id = p_organization_id order by created_at asc limit 1;
    if carrier_department_id is null then raise exception 'organization_has_no_department'; end if;
  end if;

  next_revision := coalesce(job_row.revision, 0) + 1;
  if p_department_id is null then
    insert into public.brand_website_analysis_jobs (organization_id, department_id, website_url, status, revision, requested_by, result, error_reason)
    values (p_organization_id, null, p_website_url, 'pending', next_revision, p_requested_by, null, null)
    on conflict (organization_id) where department_id is null do update set
      website_url = excluded.website_url, status = 'pending', revision = excluded.revision,
      requested_by = excluded.requested_by, result = null, error_reason = null, updated_at = now()
    returning * into job_row;
  else
    insert into public.brand_website_analysis_jobs (organization_id, department_id, website_url, status, revision, requested_by, result, error_reason)
    values (p_organization_id, p_department_id, p_website_url, 'pending', next_revision, p_requested_by, null, null)
    on conflict (department_id) where department_id is not null do update set
      website_url = excluded.website_url, status = 'pending', revision = excluded.revision,
      requested_by = excluded.requested_by, result = null, error_reason = null, updated_at = now()
    returning * into job_row;
  end if;

  insert into public.workflow_outbox (
    organization_id, department_id, workflow_name, entity_id, source_revision, purpose, correlation_id, payload
  ) values (
    p_organization_id, carrier_department_id, 'analyze-website-branding', job_row.id, job_row.revision, 'default', v_correlation_id,
    jsonb_build_object(
      'entityId', job_row.id, 'organizationId', p_organization_id, 'departmentId', carrier_department_id,
      'correlationId', v_correlation_id, 'sourceRevision', job_row.revision, 'purpose', 'default',
      'idempotencyKey', job_row.id::text || ':' || job_row.revision::text
    )
  );
  return jsonb_build_object('jobId', job_row.id);
end;
$$;
revoke all on function public.start_brand_website_analysis(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_brand_website_analysis(uuid, text, uuid, uuid) to service_role;

commit;
