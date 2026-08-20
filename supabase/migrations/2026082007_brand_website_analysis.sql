begin;

-- Paket 048: Vokabular-Erweiterung fuer eine kuenftige Vision-Analyse (Screenshot einer
-- Vereins-Homepage -> Farb-/Font-Vorschlag). Wie bei image_generation/video_generation zuvor wird
-- der Wert schon jetzt aufgenommen, aber die Aktivierung bleibt fuer die API weiterhin auf
-- text_generation beschraenkt (llm_provider_configurations_active_implemented_adapter_check,
-- apps/api/src/routes/llmProviders.routes.ts), bis der Worker-Adapter tatsaechlich existiert.
alter table public.llm_provider_configurations drop constraint llm_provider_configurations_task_kind_check;
alter table public.llm_provider_configurations add constraint llm_provider_configurations_task_kind_check
  check (task_kind in ('text_generation', 'image_generation', 'video_generation', 'vision_analysis'));

-- Ein Job pro Verein (kein Verlauf): jeder neue "Analyse starten"-Klick ueberschreibt den letzten.
-- requested_by referenziert profiles(id) wie an anderer Stelle (z.B. brand_assets.created_by).
create table public.brand_website_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  website_url text not null check (website_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  revision integer not null default 1 check (revision > 0),
  requested_by uuid not null references public.profiles(id),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.brand_website_analysis_jobs enable row level security;
alter table public.brand_website_analysis_jobs force row level security;
-- Dieselbe Berechtigung wie brand_profiles_update (organization.manage), nicht die breitere
-- vereinsweite Lesbarkeit von brand_assets/organization_brand_profiles: ein Analyse-Lauf und sein
-- (moeglicherweise falscher) Logo-/Farbvorschlag ist ein Arbeitszustand fuer die Personen, die die
-- Marke auch tatsaechlich bearbeiten duerfen, keine oeffentliche Markeninformation.
create policy brand_website_analysis_jobs_select on public.brand_website_analysis_jobs for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
create trigger set_brand_website_analysis_jobs_updated_at before update on public.brand_website_analysis_jobs
  for each row execute function public.set_updated_at();
grant select on public.brand_website_analysis_jobs to authenticated;
grant all privileges on public.brand_website_analysis_jobs to service_role;

-- Schreibzugriffe laufen ausschliesslich ueber diese RPC (Prinzip "RPC traut Client nicht"):
-- organisation/Auslöser sind bereits von der aufrufenden API-Route geprueft (requirePermission
-- 'brand.manage'), die RPC selbst leitet nur das technische Detail her, das die generische
-- Workflow-Huelle (workflow_outbox, siehe 202608030001) erzwingt: jede Zeile braucht eine echte
-- department_id (NOT NULL + FK auf departments). Diese Funktion ist rein organisationsbezogen und
-- hat sonst keinen fachlichen Abteilungsbezug -- sie nimmt dafuer die aelteste Abteilung des
-- Vereins, die laut structure.ts (departments-Loeschung blockiert die letzte Abteilung eines
-- Vereins) garantiert existiert.
create or replace function public.start_brand_website_analysis(
  p_organization_id uuid, p_website_url text, p_requested_by uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  job_row public.brand_website_analysis_jobs%rowtype;
  carrier_department_id uuid;
  next_revision integer;
  v_correlation_id uuid := gen_random_uuid();
begin
  select * into job_row from public.brand_website_analysis_jobs where organization_id = p_organization_id for update;
  if found and job_row.status in ('pending', 'running') then raise exception 'analysis_in_progress'; end if;

  select id into carrier_department_id from public.departments
    where organization_id = p_organization_id order by created_at asc limit 1;
  if carrier_department_id is null then raise exception 'organization_has_no_department'; end if;

  next_revision := coalesce(job_row.revision, 0) + 1;
  insert into public.brand_website_analysis_jobs (organization_id, website_url, status, revision, requested_by, result, error_reason)
  values (p_organization_id, p_website_url, 'pending', next_revision, p_requested_by, null, null)
  on conflict (organization_id) do update set
    website_url = excluded.website_url, status = 'pending', revision = excluded.revision,
    requested_by = excluded.requested_by, result = null, error_reason = null, updated_at = now()
  returning * into job_row;

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
revoke all on function public.start_brand_website_analysis(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.start_brand_website_analysis(uuid, text, uuid) to service_role;

commit;
