begin;

-- Globale, plattform-admin-gepflegte Laengengrenze je Ziel-Plattform. Bewusst NICHT "platform_..."
-- genannt: dieses Praefix bedeutet im Projekt sonst durchgaengig "Plattform-Administration/
-- SaaS-Betreiber" (platform_admins, platform_style_personas), nie "Social-Media-Plattform". Analog
-- zu platform_style_personas ein globaler Katalog ohne organization_id: wie lang ein Instagram-Text
-- sein darf, ist eine Eigenschaft von Instagram und fuer jeden Verein und jeden Provider dieselbe.
-- WELCHE Plattformen ein Verein benutzen darf, steht dagegen in seinen Kanaelen (Paket 012).
--
-- ZEICHEN, nicht Tokens: die Plattform weist einen zu langen Beitrag ab, und ein Token-Budget laesst
-- sich darauf nicht verlaesslich umrechnen. Das Modell-Budget bleibt daneben eine globale Konstante
-- (TEXT_GENERATION_DEFAULT_MAX_OUTPUT_TOKENS) -- es begrenzt nur den Aufruf, nicht den Beitrag.
create table public.text_generation_platform_defaults (
  platform text primary key check (platform in ('instagram', 'facebook')),
  -- Obergrenze mit Luft fuer die echten Maxima kuenftiger Plattformen (X 280, Mastodon 500,
  -- LinkedIn 3000). Wirksam gedeckelt wird ein Beitrag zusaetzlich durch GeneratedPostSchema.caption
  -- -- ein hoeherer Wert hier hebt diese Grenze nicht mit an.
  max_characters integer not null check (max_characters between 100 and 10000),
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

-- Instagrams tatsaechliche Bildtext-Grenze; fuer Facebook derselbe Wert, obwohl dort technisch weit
-- mehr erlaubt ist: ein Vereinsbeitrag von 60.000 Zeichen ist kein realistischer Fall, und
-- GeneratedPostSchema.caption deckelt ohnehin bei 2200. Der Plattform-Admin kann beide Werte in der
-- Verwaltung senken (PR 2). Erst eine Kurzform-Plattform (X 280) macht die Werte wirklich
-- unterschiedlich -- dann greift die min()-Regel bei Mehrfachauswahl sichtbar.
insert into public.text_generation_platform_defaults (platform, max_characters) values
  ('instagram', 2200),
  ('facebook', 2200);

commit;
