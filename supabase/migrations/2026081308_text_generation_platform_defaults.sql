begin;

-- Globale, plattform-admin-gepflegte Vorgabe fuer max_output_tokens je Ziel-Plattform. Bewusst
-- NICHT "platform_..." genannt: dieses Praefix bedeutet im Projekt sonst durchgaengig
-- "Plattform-Administration/SaaS-Betreiber" (platform_admins, platform_style_personas), nie
-- "Social-Media-Plattform". Analog zu platform_style_personas ein globaler Katalog ohne
-- organization_id; gilt fuer jeden Provider gleich.
create table public.text_generation_platform_defaults (
  platform text primary key check (platform in ('instagram', 'facebook')),
  max_output_tokens integer not null check (max_output_tokens between 128 and 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.text_generation_platform_defaults enable row level security;
alter table public.text_generation_platform_defaults force row level security;

-- Lesbar fuer jedes eingeloggte Mitglied (wie platform_style_personas_select): die Textwerkstatt
-- muss den Standardwert zum Vorbefuellen zeigen koennen, ohne dass der Nutzer Plattform-Admin ist.
-- Schreiben bleibt ausschliesslich dem Service-Role-Client hinter requirePlatformAdmin vorbehalten.
create policy text_generation_platform_defaults_select on public.text_generation_platform_defaults
  for select to authenticated using (true);
grant select on public.text_generation_platform_defaults to authenticated;
grant all privileges on public.text_generation_platform_defaults to service_role;
create trigger set_text_generation_platform_defaults_updated_at before update on public.text_generation_platform_defaults
  for each row execute function public.set_updated_at();

-- Platzhalterwerte, unkalibriert -- identisch zum bisherigen globalen Default 1200.
insert into public.text_generation_platform_defaults (platform, max_output_tokens) values
  ('instagram', 1200),
  ('facebook', 1200);

commit;
