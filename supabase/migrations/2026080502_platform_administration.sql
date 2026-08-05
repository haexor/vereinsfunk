begin;

-- Plattform-Admin-Identitaet: orthogonal zu allen vereinsbezogenen Rollen (authz.*,
-- organization_memberships). Kein is_platform_admin()-Helfer noetig, da keine RLS-Policy
-- ihn referenziert -- jeglicher Zugriff laeuft ausschliesslich ueber apps/api's
-- Service-Role-Client, gated durch requirePlatformAdmin. RLS ist trotzdem aktiv (deny-all
-- fuer authenticated/anon) als Verteidigung in der Tiefe.
--
-- Paket 021 (Abomodelle, plans/021-abomodelle-und-speicherkontingent.md:245,281) verlangt
-- bereits ein neues Recht "platform.manage" ausserhalb des Vereinsmodells, ohne dessen
-- Durchsetzung zu spezifizieren. Genau das liefert diese Tabelle: eine Zeile in
-- platform_admins ist "platform.manage" besessen. Wenn 021 umgesetzt wird, sollte es
-- requirePlatformAdmin (apps/api/src/auth.ts) direkt wiederverwenden statt einen zweiten
-- Mechanismus zu bauen.
create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_default_admin boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

-- Reiner Spaltenbezug + WHERE-Praedikat in einem CREATE INDEX, kein Ausdruck in einer
-- UNIQUE/PRIMARY-KEY-Tabellen-Constraint -- coalesce()/Ausdruecke sind nur in CREATE INDEX
-- erlaubt, hier aber gar nicht gebraucht.
create unique index platform_admins_default_unique on public.platform_admins (is_default_admin) where is_default_admin;

-- Der Default-Admin ist der einzige, der andere Admins loeschen darf (durchgesetzt in
-- apps/api), und darf selbst nie geloescht werden -- das waere der einzige Weg, die
-- Administrierbarkeit der Plattform vollstaendig zu verlieren.
create or replace function public.reject_default_admin_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.is_default_admin then
    raise exception 'the default platform admin cannot be deleted';
  end if;
  return old;
end;
$$;

create trigger platform_admins_protect_default
  before delete on public.platform_admins
  for each row execute function public.reject_default_admin_delete();

-- Bootstrap: idempotent, von apps/api beim Serverstart aufgerufen, wenn
-- PLATFORM_ADMIN_DEFAULT_EMAIL gesetzt ist. Tut nichts, wenn schon ein Default-Admin
-- existiert -- eine Rotation der hinterlegten E-Mail ist eine bewusste Ops-Aktion mit
-- direktem DB-Zugriff, kein API-Feature (siehe Plandokument, Risiken).
create or replace function public.bootstrap_platform_admin(target_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
begin
  if exists (select 1 from public.platform_admins where is_default_admin) then
    return;
  end if;
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then
    raise exception 'bootstrap_platform_admin: no auth.users row for %', target_email;
  end if;
  insert into public.platform_admins (user_id, is_default_admin) values (target_user_id, true);
end;
$$;
revoke all on function public.bootstrap_platform_admin(text) from public;
grant execute on function public.bootstrap_platform_admin(text) to service_role;

-- Live hinzufuegen: jeder bestehende Admin darf, nie mit dem Default-Flag.
create or replace function public.add_platform_admin(target_email text, added_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then
    raise exception 'add_platform_admin: no auth.users row for %', target_email;
  end if;
  insert into public.platform_admins (user_id, created_by) values (target_user_id, added_by)
    on conflict (user_id) do nothing;
  return target_user_id;
end;
$$;
revoke all on function public.add_platform_admin(text, uuid) from public;
grant execute on function public.add_platform_admin(text, uuid) to service_role;

-- Globale Konfiguration: loest die in Paket 009 hartkodierte Eigentuemer-Grenze ab. Ein
-- Aufrufparameter waere per rpc() aus dem Browser ueberschreibbar (siehe 009s
-- Adversarial-Review) -- eine Tabelle, die authenticated nie sieht, nicht.
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.platform_settings enable row level security;
create trigger set_platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();
insert into public.platform_settings (key, value) values ('max_organizations_per_owner', '3'::jsonb);

-- LLM-Provider-Konfiguration: Metadaten getrennt vom Geheimnis, analog zum in Plan 012
-- spezifizierten social_connection_secrets-Muster (dort noch nicht umgesetzt). Die
-- Geheimnis-Tabelle bekommt zusaetzlich FORCE ROW LEVEL SECURITY und keinerlei Policy --
-- selbst ein security-definer-Aufrufer, der vom Tabelleneigentuemer verschieden waere,
-- bekaeme keine Zeile zu sehen. Nur service_role (mit BYPASSRLS) kommt heran.
create table public.llm_provider_configurations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  protocol text not null check (protocol in ('anthropic', 'openai')),
  base_url text not null,
  model text not null,
  purpose text not null default 'default',
  priority integer not null default 100,
  is_active boolean not null default true,
  system_prompt_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.llm_provider_configurations enable row level security;
create trigger set_llm_provider_configurations_updated_at before update on public.llm_provider_configurations
  for each row execute function public.set_updated_at();

create table public.llm_provider_secrets (
  llm_provider_configuration_id uuid primary key references public.llm_provider_configurations(id) on delete cascade,
  api_key_ciphertext bytea not null,
  key_version text not null,
  updated_at timestamptz not null default now()
);
alter table public.llm_provider_secrets enable row level security;
alter table public.llm_provider_secrets force row level security;

-- Keine der vier neuen Tabellen hat eine Policy oder ein Grant fuer authenticated/anon --
-- RLS ohne Policy sperrt ohnehin auf null Zeilen, aber ohne Grant scheitert der Zugriff
-- schon auf Privilegienebene (42501), bevor RLS ueberhaupt ausgewertet wird. service_role
-- braucht den Zugriff explizit, weil 202608020003_api_grants.sql's blanket grant nur
-- die zum damaligen Zeitpunkt existierenden Tabellen erfasst hat (siehe dort:27 und die
-- gleiche Notwendigkeit in 2026080501_organization_profile_and_onboarding.sql:213).
grant all privileges on
  public.platform_admins,
  public.platform_settings,
  public.llm_provider_configurations,
  public.llm_provider_secrets
  to service_role;

-- create_organization() aus Paket 009: die hartkodierte Konstante entfaellt, der Wert kommt
-- jetzt aus platform_settings. Security definer + Owner-Exemption von RLS (keine FORCE ROW
-- LEVEL SECURITY auf platform_settings) erlauben dieser Funktion weiterhin den direkten
-- Lesezugriff, exakt wie beim bestehenden Lesen von organization_memberships. Kein
-- Aufrufparameter fuer das Limit -- die 009-Adversarial-Fallgrube (per rpc() aus dem
-- Browser ueberschreibbar) bleibt geschlossen.
create or replace function public.create_organization(
  organization_name text,
  first_department_name text,
  organization_timezone text default 'Europe/Berlin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := auth.uid();
  new_organization_id uuid;
  new_department_id uuid;
  base_slug text;
  candidate_slug text;
  department_slug text;
  suffix integer := 0;
  owner_count integer;
  max_organizations_per_owner integer;
begin
  if acting_user is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(coalesce(organization_name, ''))) = 0 then
    raise exception 'organization name is required';
  end if;
  if char_length(trim(coalesce(first_department_name, ''))) = 0 then
    raise exception 'first department name is required';
  end if;

  select (value::text)::integer into max_organizations_per_owner
  from public.platform_settings where key = 'max_organizations_per_owner';
  if max_organizations_per_owner is null then
    max_organizations_per_owner := 3;
  end if;

  -- Serialisiert konkurrierende Aufrufe desselben Nutzers, damit die Zaehlung unten auch
  -- gegen zwei parallele Anfragen an der Limitgrenze dicht ist. Andere Nutzer sind
  -- unabhaengig und blockieren sich nicht gegenseitig.
  perform pg_advisory_xact_lock(hashtext('create_organization:' || acting_user::text));

  select count(*) into owner_count
  from public.organization_memberships
  where user_id = acting_user and role = 'organization_owner';
  if owner_count >= max_organizations_per_owner then
    raise exception 'organization limit reached for this account';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'verein'; end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.organizations (name, slug, timezone)
      values (trim(organization_name), candidate_slug, organization_timezone)
      returning id into new_organization_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end;
  end loop;

  insert into public.organization_profiles (organization_id) values (new_organization_id);
  insert into public.organization_onboarding (organization_id) values (new_organization_id);
  insert into public.organization_brand_profiles (organization_id) values (new_organization_id);

  department_slug := trim(both '-' from regexp_replace(lower(trim(first_department_name)), '[^a-z0-9]+', '-', 'g'));
  if department_slug = '' then department_slug := 'abteilung'; end if;

  insert into public.departments (organization_id, name, slug)
  values (new_organization_id, trim(first_department_name), department_slug)
  returning id into new_department_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, acting_user, 'organization_owner');

  insert into public.department_memberships (organization_id, department_id, user_id, role)
  values (new_organization_id, new_department_id, acting_user, 'department_admin');

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id)
  values (new_organization_id, acting_user, 'organization.created', 'organization', new_organization_id, gen_random_uuid());

  return new_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

commit;
