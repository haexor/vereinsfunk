begin;

-- Paket 050: Plattform-Admin-Werkzeug, um mehrere aktive Vision-Provider gegen dieselbe Test-URL
-- laufen zu lassen und die Ergebnisse (Farb-/Font-Vorschlag je Modell) zu vergleichen -- Grundlage
-- fuer die Entscheidung, welche Vision-Modelle fuer die echte Markenerkennung aktiv bleiben.
-- Bewusst keine workflow_outbox-Zeile: die generische Huelle erzwingt eine echte organization_id +
-- department_id (202608030001_content_media_workflows_publishing.sql), die es fuer einen rein
-- plattformbezogenen Testlauf nicht gibt und fuer die es hier auch keinen fachlichen Trager gibt
-- (anders als bei start_brand_website_analysis, das dafuer die aelteste Abteilung des jeweiligen
-- Vereins nimmt). Stattdessen pollt ein eigener, kleiner Cron-Task ausserhalb des
-- WorkflowNameSchema-Loops diese Tabelle direkt (analog createGenerationRecoveryScanWorkflow,
-- apps/worker/src/workflows.ts).
create table public.vision_provider_comparison_runs (
  id uuid primary key default gen_random_uuid(),
  website_url text not null check (website_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  requested_by uuid not null references public.profiles(id),
  detected_font_family text,
  logo_object_path text,
  logo_mime_type text,
  -- Ein Eintrag je zum Startzeitpunkt aktivem Vision-Provider:
  -- {providerConfigurationId, providerLabel, status: 'succeeded'|'failed', primaryColor?, accentColor?,
  --  backgroundColor?, textColor?, onPrimaryColor?, suggestedFontPairingKey?, errorReason?}.
  -- Ein einzelner scheiternder Provider darf die uebrigen Ergebnisse nicht verdecken, deshalb je
  -- Provider ein eigener Status statt eines Abbruchs des gesamten Laufs.
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vision_provider_comparison_runs enable row level security;
alter table public.vision_provider_comparison_runs force row level security;
create trigger set_vision_provider_comparison_runs_updated_at before update on public.vision_provider_comparison_runs
  for each row execute function public.set_updated_at();

-- Dieselbe Haltung wie llm_provider_configurations/platform_admins: keine Policy, kein Grant fuer
-- authenticated/anon -- der Zugriff laeuft ausschliesslich ueber apps/api's Service-Role-Client,
-- gated durch requirePlatformAdmin.
grant all privileges on public.vision_provider_comparison_runs to service_role;

-- for update skip locked, analog claim_workflow_outbox/claim_stalled_generation_candidates: mehrere
-- Worker-Replikate duerfen denselben Lauf nicht doppelt claimen.
create or replace function public.claim_pending_vision_provider_comparison_run()
returns table(id uuid, website_url text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed_id uuid;
  claimed_url text;
begin
  select r.id, r.website_url into claimed_id, claimed_url
    from public.vision_provider_comparison_runs r
    where r.status = 'pending'
    order by r.created_at
    for update skip locked
    limit 1;
  if claimed_id is null then
    return;
  end if;
  update public.vision_provider_comparison_runs set status = 'running', updated_at = now() where id = claimed_id;
  id := claimed_id; website_url := claimed_url;
  return next;
end;
$$;
revoke all on function public.claim_pending_vision_provider_comparison_run() from public, anon, authenticated;
grant execute on function public.claim_pending_vision_provider_comparison_run() to service_role;

commit;
