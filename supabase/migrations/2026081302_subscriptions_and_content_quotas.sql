begin;

-- Plan 021: Tarife sind Daten. Preise und Grenzen aendern sich ueber den Plattform-Admin-Editor
-- (Paket-021-PR-2/3), ohne Deployment und ohne eine Zeile SQL.
create table public.subscription_plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null,
  -- Preis in Cent, damit nichts gerundet wird. null = nicht selbst buchbar
  -- (individuell vereinbarter Tarif).
  monthly_price_cents integer check (monthly_price_cents >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  storage_bytes bigint not null check (storage_bytes > 0),
  max_teams integer check (max_teams > 0),
  max_departments integer check (max_departments > 0),
  -- null bei einer Grenze heisst ausdruecklich "unbegrenzt", nicht "null".
  is_self_serviceable boolean not null default true,
  sort_order integer not null default 0,
  available_from date, available_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until >= available_from)
);

-- Startbelegung; jederzeit ueber den Plattform-Admin-Editor aenderbar, nicht nur per Migration.
insert into public.subscription_plans
  (key, display_name, monthly_price_cents, storage_bytes,
   max_teams, max_departments, sort_order)
values
  ('free',    'Kostenlos',  0,    3221225472,   1,    1,    10),
  ('starter', 'Einstieg',   2000, 26843545600,  null, null, 20),
  ('premium', 'Premium',    5000, 107374182400, null, null, 30);

-- Beitragskontingente je Herkunft -- eigene Tabelle statt drei Spalten: eine Herkunftsart kann in
-- einem Tarif ganz fehlen, und eine vierte Herkunftsart waere eine Zeile, keine Migration.
create table public.subscription_plan_content_limits (
  plan_key text not null references public.subscription_plans(key) on delete cascade,
  media_origin text not null check (media_origin in ('own_upload','ai_image','ai_video')),
  -- null = unbegrenzt fuer diese Herkunft. Fehlt die Zeile komplett, ist diese Herkunft in
  -- diesem Tarif nicht enthalten (0), nicht unbegrenzt -- deshalb muss jeder Tarif explizit eine
  -- Zeile je angebotener Herkunft haben.
  max_per_month integer check (max_per_month > 0),
  -- nur fuer 'ai_video' gesetzt: hoechste erlaubte Laenge je Video in Sekunden.
  max_duration_seconds integer check (max_duration_seconds > 0),
  primary key (plan_key, media_origin),
  check (max_duration_seconds is null or media_origin = 'ai_video')
);

insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month, max_duration_seconds) values
  ('free',    'own_upload', 12,   null),
  ('free',    'ai_image',   3,    null),
  ('free',    'ai_video',   1,    10),
  ('starter', 'own_upload', 40,   null),
  ('starter', 'ai_image',   15,   null),
  ('starter', 'ai_video',   6,    20),
  ('premium', 'own_upload', null, null),
  ('premium', 'ai_image',   null, null),
  ('premium', 'ai_video',   null, 60);
-- Die Zahlenwerte sind Platzhalter mit Vorzeichen, wie die Preise und die 3 GB des kostenlosen
-- Tarifs. Bis KI-Bild-/Videoerzeugung existiert, wirken die ai_image/ai_video-Zeilen als
-- Versprechen ohne Gegenstueck -- kein Codepfad erzeugt heute einen Kandidaten fuer diese beiden
-- Herkunftsarten.

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  status text not null default 'active'
    check (status in ('active','past_due','cancelled','suspended')),
  started_at timestamptz not null default now(),
  current_period_end date,
  cancel_at_period_end boolean not null default false,

  -- Operative Uebersteuerung fuer den Einzelfall. Nur mit requirePlatformAdmin (Tabelle
  -- platform_admins, kein eigenes Recht platform.manage) setzbar, nie durch den Verein selbst.
  -- null = Tarifwert gilt.
  storage_bytes_override bigint check (storage_bytes_override > 0),
  max_teams_override integer check (max_teams_override > 0),
  max_departments_override integer check (max_departments_override > 0),
  override_reason text check (char_length(override_reason) <= 500),
  override_by uuid references public.profiles(id),
  override_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Eine Uebersteuerung ohne Begruendung ist in sechs Monaten nicht mehr nachvollziehbar.
  -- Deshalb erzwungen, sobald irgendein Wert gesetzt ist.
  check (
    (storage_bytes_override is null and max_teams_override is null
     and max_departments_override is null)
    or (override_reason is not null and override_by is not null and override_at is not null)
  )
);

-- Jeder Bestandsverein braucht eine Zeile, sonst liefert effective_limits() fuer ihn nichts.
insert into public.organization_subscriptions (organization_id, plan_key)
select id, 'free' from public.organizations
where id not in (select organization_id from public.organization_subscriptions);

-- Operative Uebersteuerung je Herkunftsart, analog zu organization_subscriptions, aber als eigene
-- Tabelle -- eine Zeile pro uebersteuerter Herkunftsart, nicht weitere Override-Spalten. Eine
-- Zeile bedeutet bereits "uebersteuert", deshalb sind Begruendung/Aufrufer/Zeitpunkt hier direkt
-- not null.
create table public.organization_content_limit_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  media_origin text not null check (media_origin in ('own_upload','ai_image','ai_video')),
  max_per_month integer check (max_per_month > 0),
  max_duration_seconds integer check (max_duration_seconds > 0),
  override_reason text not null check (char_length(override_reason) <= 500),
  override_by uuid not null references public.profiles(id),
  override_at timestamptz not null default now(),
  primary key (organization_id, media_origin),
  check (max_duration_seconds is null or media_origin = 'ai_video')
);

-- create_organization() (zuletzt 2026080901) legt bislang keine organization_subscriptions-Zeile
-- an. Ohne diese Ergaenzung waeren die Backfill-Zeile oben und die Grenzen dieses Pakets nur fuer
-- BESTEHENDE Vereine wirksam -- jeder ab jetzt neu gegruendete Verein haette effective_limits() ohne
-- Treffer, und der enforce_structure_limit()-Trigger wuerde still nichts durchsetzen (max_allowed
-- bliebe NULL). Einzige Aenderung gegenueber der bisherigen Fassung: die neue Zeile vor der ersten
-- Abteilung, damit schon deren eigener Trigger-Aufruf effective_limits() findet.
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

  perform pg_advisory_xact_lock(hashtext('create_organization:' || acting_user::text));

  select count(*) into owner_count
  from public.organization_memberships
  where user_id = acting_user
    and role = 'organization_owner'
    and (expires_at is null or expires_at > now());
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
  insert into public.organization_subscriptions (organization_id, plan_key) values (new_organization_id, 'free');
  insert into public.retention_settings (organization_id, updated_by) values (new_organization_id, acting_user);
  insert into public.processing_records (organization_id, purpose, legal_basis, data_categories, subject_categories, retention_note) values
    (new_organization_id, 'Beitragserstellung und Freigabe', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Beitragstexte', 'Bildmaterial'], array['Mitglieder', 'Verzeichnispersonen'], 'Bis zur Loeschung des Vereinskontos'),
    (new_organization_id, 'Medienverarbeitung (Anonymisierung, Rendering)', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Bildmaterial', 'Videomaterial'], array['Mitglieder', 'Verzeichnispersonen'], 'Gemaess Aufbewahrungsfrist fuer Rohmedien'),
    (new_organization_id, 'Einwilligungsverwaltung', 'Einwilligung -- bitte durch den Verein bestaetigen oder anpassen', array['Einwilligungserklaerungen', 'Kontaktdaten Erziehungsberechtigter'], array['Verzeichnispersonen', 'Erziehungsberechtigte'], 'Gemaess gesetzlicher Aufbewahrungsfrist fuer Nachweise'),
    (new_organization_id, 'Mitgliederverzeichnis', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Stammdaten', 'Kontaktdaten'], array['Mitglieder', 'Verzeichnispersonen'], 'Bis zum Austritt bzw. Loeschung des Vereinskontos');

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

-- Grenzen werden nie direkt aus dem Tarif gelesen, sondern ueber diese Funktionen, damit die
-- Uebersteuerung nicht an jedem Aufrufer wiederholt werden muss. Kein legitimer Aufrufer
-- ausserhalb von apps/api's Service-Client (dieselbe Begruendung wie bei
-- count_publications_in_period, 2026080606): ein Grant an authenticated wuerde jedem erlauben,
-- die Grenzen eines FREMDEN Vereins per direktem RPC-Aufruf abzufragen.
create or replace function public.effective_limits(target uuid)
returns table (storage_bytes bigint, max_teams integer, max_departments integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(s.storage_bytes_override, p.storage_bytes),
         coalesce(s.max_teams_override, p.max_teams),
         coalesce(s.max_departments_override, p.max_departments)
    from public.organization_subscriptions s
    join public.subscription_plans p on p.key = s.plan_key
   where s.organization_id = target;
$$;
revoke all on function public.effective_limits(uuid) from public;
grant execute on function public.effective_limits(uuid) to service_role;

create or replace function public.effective_content_limits(target uuid)
returns table (media_origin text, max_per_month integer, max_duration_seconds integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select pcl.media_origin,
         coalesce(clo.max_per_month, pcl.max_per_month),
         coalesce(clo.max_duration_seconds, pcl.max_duration_seconds)
    from public.organization_subscriptions s
    join public.subscription_plan_content_limits pcl on pcl.plan_key = s.plan_key
    left join public.organization_content_limit_overrides clo
      on clo.organization_id = s.organization_id and clo.media_origin = pcl.media_origin
   where s.organization_id = target;
$$;
revoke all on function public.effective_content_limits(uuid) from public;
grant execute on function public.effective_content_limits(uuid) to service_role;

-- Deny-all-RLS: dieselbe Begruendung wie platform_admins/platform_settings (2026080502) -- Zugriff
-- ausschliesslich ueber die API (supabaseClients.forService() + requirePermission/
-- requirePlatformAdmin im Code). Kein Grant an authenticated: ohne Grant scheitert der Zugriff
-- schon auf Privilegienebene, bevor RLS ueberhaupt ausgewertet wird.
alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_content_limits enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_content_limit_overrides enable row level security;
grant all privileges on
  public.subscription_plans,
  public.subscription_plan_content_limits,
  public.organization_subscriptions,
  public.organization_content_limit_overrides
  to service_role;

create trigger set_subscription_plans_updated_at before update on public.subscription_plans
  for each row execute function public.set_updated_at();
create trigger set_organization_subscriptions_updated_at before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();

-- Speicher-Unterlimits je Abteilung und Mannschaft (nur Speicher -- Beitragskontingente je
-- Abteilung/Mannschaft sind bewusst nicht Teil dieser Fassung). 'organization' ist hier nicht
-- zulaessig: das Vereinslimit kommt aus dem Tarif und ist keine frei setzbare Zeile.
create table public.storage_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  storage_bytes bigint not null check (storage_bytes > 0),
  set_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'department' and department_id is not null and team_id is null)
      or (scope = 'team'       and department_id is not null and team_id is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

-- Ausdruecke gehen nur im Index, nicht im Constraint -- und ohne die Normalisierung waeren zwei
-- Zeilen mit NULL-team_id voneinander verschieden.
create unique index storage_limits_unique on public.storage_limits (
  organization_id, scope, department_id,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Echtes RLS-Muster wie channel_quotas (2026080606), nur ohne den organization-Zweig, den es fuer
-- Speicher-Unterlimits nicht gibt.
alter table public.storage_limits enable row level security;
alter table public.storage_limits force row level security;
create policy storage_limits_select on public.storage_limits for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));
create policy storage_limits_insert on public.storage_limits for insert to authenticated
  with check (
    (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  );
create policy storage_limits_update on public.storage_limits for update to authenticated
  using (
    (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  )
  with check (
    (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  );
create policy storage_limits_delete on public.storage_limits for delete to authenticated
  using (
    (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  );
grant select, insert, update, delete on public.storage_limits to authenticated;
grant all privileges on public.storage_limits to service_role;
create trigger set_storage_limits_updated_at before update on public.storage_limits for each row execute function public.set_updated_at();

-- Nutzung als Aggregat, nicht als Zaehlerspalte -- dieselbe Begruendung wie
-- count_publications_in_period: eine Zaehlerspalte weicht von der Wahrheit ab, sobald ein Objekt
-- geloescht oder ein Derivat invalidiert wird. Kein storage_usage_cache in dieser ersten Fassung
-- (siehe Plan-Kontext): die Aufnahmepruefung liest ohnehin immer dieses Aggregat, nie einen Cache,
-- und bei praktisch null echten Uploads (LocalUploadService ist noch ein Stub) gibt es nichts zu
-- cachen. media_assets/media_derivatives kennen keine Mannschaftsebene -- ein team-skopierter
-- Aufruf zaehlt dort deshalb nichts mit, nur brand_assets hat eine echte team_id-Spalte.
create or replace function public.storage_usage_bytes(
  target_organization uuid, target_department uuid default null, target_team uuid default null
) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select sum(asset.byte_size) from public.media_assets asset
     where asset.organization_id = target_organization
       and target_team is null
       and (target_department is null or asset.department_id = target_department)
       and asset.upload_status <> 'deleted'
  ), 0)
  + coalesce((
    select sum(derivative.byte_size)
      from public.media_derivatives derivative
      join public.media_assets asset
        on asset.organization_id = derivative.organization_id and asset.id = derivative.media_asset_id
     where derivative.organization_id = target_organization
       and target_team is null
       and (target_department is null or asset.department_id = target_department)
       and asset.upload_status <> 'deleted'
  ), 0)
  + coalesce((
    select sum(brand.byte_size) from public.brand_assets brand
     where brand.organization_id = target_organization
       and (target_department is null or brand.department_id = target_department)
       and (target_team is null or brand.team_id = target_team)
  ), 0);
$$;
revoke all on function public.storage_usage_bytes(uuid, uuid, uuid) from public;
grant execute on function public.storage_usage_bytes(uuid, uuid, uuid) to service_role;

-- Abteilungs- und Mannschaftsgrenze: ein before-insert-Trigger statt nur eine RPC-Pruefung.
-- create_department prueft heute nur die Permission, keine Menge, und Teams entstehen per
-- direktem insert ohne jede RPC (apps/api/src/routes/structure.ts) -- eine reine RPC-Pruefung
-- waere also umgehbar. Der Trigger deckt jeden Einfuegeweg ab, auch einen kuenftigen.
create or replace function public.enforce_structure_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_count integer;
  max_allowed integer;
begin
  -- Ohne diese Sperre koennten zwei gleichzeitige Einfuegungen an der Grenze beide dieselbe
  -- "current_count < max_allowed"-Pruefung bestehen (READ COMMITTED sieht fuer beide denselben
  -- Stand), und der Verein laeuft um eins ueber sein Limit -- exakt der Grund, warum
  -- schedule_publication() dieselbe Sperre je Verein haelt (beim CodeRabbit-Review dieses Pakets
  -- gefunden). Anderer Salt (1) als dort (0), damit Struktur- und Kontingentpruefungen sich nicht
  -- gegenseitig unnoetig blockieren.
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 1));
  if tg_table_name = 'departments' then
    select count(*) into current_count from public.departments
     where organization_id = new.organization_id and archived_at is null;
    select max_departments into max_allowed from public.effective_limits(new.organization_id);
  else
    select count(*) into current_count from public.teams
     where organization_id = new.organization_id and archived_at is null;
    select max_teams into max_allowed from public.effective_limits(new.organization_id);
  end if;
  if max_allowed is not null and current_count >= max_allowed then
    raise exception 'structure limit reached for this organization' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger departments_enforce_limit before insert on public.departments
  for each row execute function public.enforce_structure_limit();
create trigger teams_enforce_limit before insert on public.teams
  for each row execute function public.enforce_structure_limit();
-- Archivieren/Entarchivieren aendert archived_at ueber ein gewoehnliches UPDATE (apps/api/src/
-- routes/structure.ts) -- ohne diesen zweiten Trigger liesse sich die Grenze umgehen, indem man
-- eine Abteilung archiviert und wieder entarchiviert, sobald der Verein bereits am Limit ist
-- (beim CodeRabbit-Review gefunden). Die WHEN-Klausel beschraenkt das auf genau den
-- Reaktivierungs-Uebergang, ein reines Umbenennen loest die Pruefung nicht erneut aus.
create trigger departments_enforce_limit_on_reactivate before update of archived_at on public.departments
  for each row when (old.archived_at is not null and new.archived_at is null) execute function public.enforce_structure_limit();
create trigger teams_enforce_limit_on_reactivate before update of archived_at on public.teams
  for each row when (old.archived_at is not null and new.archived_at is null) execute function public.enforce_structure_limit();

-- Beitragszaehler je Herkunft: post_versions braucht ein Herkunftsfeld. Default 'own_upload' fuer
-- jede bestehende und jede neue Zeile -- solange KI-Bild-/Videoerzeugung nicht existiert, setzt
-- ohnehin kein Codepfad einen anderen Wert. Die Spalte ist trotzdem jetzt schon richtig, weil ein
-- kuenftiges Erzeugungs-Paket sie nur noch befuellen muss, nicht mehr anlegen.
alter table public.post_versions
  add column media_origin text not null default 'own_upload'
    check (media_origin in ('own_upload','ai_image','ai_video')),
  add column ai_generated_video_duration_seconds integer
    check (ai_generated_video_duration_seconds > 0),
  add constraint post_versions_ai_video_duration_check
    check (ai_generated_video_duration_seconds is null or media_origin = 'ai_video');

-- count_publications_in_period (2026080606) bekommt eine neue, standardmaessig nulle
-- Filterdimension, damit dieselbe Funktion fuer beide Zwecke weiterverwendet wird -- die
-- vereinseigenen channel_quotas (weiterhin null, also herkunftsunabhaengig) und das neue
-- Tarifkontingent (mit gesetztem Wert). Kein neuer Join noetig, die Funktion joint bereits ueber
-- post_versions. Bestehende Aufrufer (die channel_quotas-Pruefung in schedule_publication)
-- uebergeben weiterhin nichts fuer den neuen Parameter und bleiben unveraendert, weil er einen
-- Default hat. "create or replace" allein wuerde hier NICHT die alte Funktion ersetzen, sondern
-- eine zweite, ueberladene Variante daneben anlegen (Postgres identifiziert eine Funktion ueber
-- Name UND Parameterliste, und die ist mit dem siebten Parameter eine andere) -- jeder Aufruf mit
-- genau sechs Argumenten waere danach zwischen beiden Varianten nicht mehr eindeutig entscheidbar
-- (beim eigenen Testlauf dieses Pakets gefunden: "is not unique"). Deshalb zuerst die alte
-- Signatur explizit droppen.
drop function if exists public.count_publications_in_period(uuid, uuid, uuid, uuid, text, timestamptz);
create or replace function public.count_publications_in_period(
  target_organization uuid, target_department uuid, target_team uuid,
  target_connection uuid, quota_period text, reference timestamptz,
  target_media_origin text default null
) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer
  from public.publications publication
  join public.post_versions version on version.id = publication.post_version_id and version.organization_id = publication.organization_id
  join public.posts post on post.id = version.post_id and post.organization_id = version.organization_id
  join public.organizations org on org.id = publication.organization_id
  where publication.organization_id = target_organization
    and (target_connection is null or publication.social_connection_id = target_connection)
    and (target_department is null or post.department_id = target_department)
    and (target_team is null or post.team_id = target_team)
    and (target_media_origin is null or version.media_origin = target_media_origin)
    and publication.status in ('queued', 'uploading', 'processing', 'published')
    and (
      (quota_period = 'day' and date_trunc('day', publication.created_at at time zone org.timezone) = date_trunc('day', reference at time zone org.timezone))
      or (quota_period = 'week' and date_trunc('week', publication.created_at at time zone org.timezone) = date_trunc('week', reference at time zone org.timezone))
      or (quota_period = 'month' and date_trunc('month', publication.created_at at time zone org.timezone) = date_trunc('month', reference at time zone org.timezone))
    );
$$;
revoke all on function public.count_publications_in_period(uuid, uuid, uuid, uuid, text, timestamptz, text) from public;
grant execute on function public.count_publications_in_period(uuid, uuid, uuid, uuid, text, timestamptz, text) to service_role;

-- schedule_publication (2026081107): unveraendert bis zum Ende der bestehenden
-- channel_quotas-Schleife, danach ein neuer Block unter derselben bereits gehaltenen
-- pg_advisory_xact_lock-Sperre, vor dem insert in publications. Laengenpruefung vor
-- Monatszaehlung, beide unabhaengig -- ein zu langes KI-Video wird abgelehnt, selbst wenn das
-- Monatskontingent noch nicht ausgeschoepft ist.
create or replace function public.schedule_publication(
  target_post_version_id uuid, target_social_connection_id uuid, target_scheduled_for timestamptz
) returns public.publications
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version record;
  post record;
  connection record;
  quota_scope_key text;
  allowed_channels jsonb;
  require_responsible boolean;
  quota_row record;
  content_limit_row record;
  content_limit_found boolean;
  result public.publications;
  media_blockers text[] := '{}';
begin
  select * into version from public.post_versions where id = target_post_version_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into post from public.posts where id = version.post_id and organization_id = version.organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if post.status <> 'approved' then raise exception 'invalid_status'; end if;
  if not authz.has_department_permission(post.department_id, 'post.publish') then
    raise exception 'insufficient_permission';
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.media_assets ma on ma.organization_id = md.organization_id and ma.id = md.media_asset_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and ma.scan_status <> 'clean'
  ) then
    media_blockers := array_append(media_blockers, 'scan_pending');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and md.status <> 'ready'
  ) then
    media_blockers := array_append(media_blockers, 'derivative_stale');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.face_regions fr on fr.organization_id = pm.organization_id and fr.media_asset_id = md.media_asset_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and fr.decision = 'pending'
  ) then
    media_blockers := array_append(media_blockers, 'face_pending');
  end if;

  if exists (
    select 1 from public.post_media pm
    join public.media_derivatives md on md.organization_id = pm.organization_id and md.id = pm.media_derivative_id
    join public.face_regions fr on fr.organization_id = pm.organization_id and fr.media_asset_id = md.media_asset_id
    left join public.consent_records cr on cr.organization_id = fr.organization_id and cr.id = fr.consent_record_id
    left join public.directory_people dp on dp.organization_id = cr.organization_id and dp.id = cr.directory_person_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and fr.decision = 'consented'
      and (
        cr.id is null
        or cr.revoked_at is not null
        or cr.superseded_by is not null
        or (cr.valid_from is not null and now() < cr.valid_from)
        or (cr.valid_until is not null and now() > cr.valid_until)
        or (coalesce(dp.is_minor, false) and cr.signer_role is distinct from 'guardian')
      )
  ) then
    media_blockers := array_append(media_blockers, 'consent_invalid');
  end if;

  if array_length(media_blockers, 1) > 0 then
    raise exception 'media_gate_blocked: %', array_to_string(media_blockers, ',');
  end if;

  select * into connection from public.social_connections where id = target_social_connection_id and organization_id = post.organization_id;
  if not found then raise exception 'not_found'; end if;
  if connection.status <> 'active' or connection.archived_at is not null then
    raise exception 'channel_not_allowed';
  end if;

  if not exists (
    select 1 from public.channel_scopes grant_row
    where grant_row.social_connection_id = target_social_connection_id
      and grant_row.organization_id = post.organization_id
      and grant_row.can_schedule
      and (
        grant_row.scope = 'organization'
        or (grant_row.scope = 'department' and grant_row.department_id = post.department_id)
        or (grant_row.scope = 'team' and post.team_id is not null and grant_row.team_id = post.team_id)
      )
  ) then
    raise exception 'channel_not_allowed';
  end if;

  select require_channel_responsible into require_responsible
    from public.policy_settings where organization_id = post.organization_id and scope = 'organization';
  if coalesce(require_responsible, false) and connection.responsible_profile_id is null then
    raise exception 'channel_not_allowed';
  end if;

  allowed_channels := version.effective_config_snapshot->'config'->'allowedChannelIds';
  if allowed_channels is not null and jsonb_typeof(allowed_channels) = 'array'
     and not exists (select 1 from jsonb_array_elements_text(allowed_channels) value where value = target_social_connection_id::text) then
    raise exception 'channel_not_allowed';
  end if;

  quota_scope_key := post.organization_id::text;
  perform pg_advisory_xact_lock(hashtextextended(quota_scope_key, 0));

  for quota_row in
    select * from public.channel_quotas
    where organization_id = post.organization_id
      and (social_connection_id is null or social_connection_id = target_social_connection_id)
      and (
        (scope = 'organization')
        or (scope = 'department' and department_id = post.department_id)
        or (scope = 'team' and post.team_id is not null and team_id = post.team_id)
      )
  loop
    if public.count_publications_in_period(
      post.organization_id,
      case quota_row.scope when 'department' then post.department_id when 'team' then post.department_id else null end,
      case quota_row.scope when 'team' then post.team_id else null end,
      quota_row.social_connection_id, quota_row.period, now()
    ) >= quota_row.max_publications then
      raise exception 'quota_exceeded: %/%', quota_row.scope, quota_row.period;
    end if;
  end loop;

  -- Tarifkontingent nach Medienherkunft, unter derselben Vereinssperre wie die Schleife oben. Nur
  -- die Herkunftsart der einzuplanenden Version wird geprueft -- ein ausgeschoepftes
  -- KI-Video-Kontingent blockiert keine eigenen Beitraege. Ohne JEDE organization_subscriptions-
  -- Zeile gilt weiterhin "keine Grenze aus diesem Paket" (Datenmodell-Kommentar) -- das betrifft
  -- Vereine, die vor dieser Migration entstanden sind und noch nicht ueber create_organization()
  -- nachgezogen wurden, u. a. zahlreiche bestehende pgTAP-Fixtures. NUR wenn eine Abo-Zeile
  -- existiert, aber fuer genau diese Herkunftsart JEDE Zeile fehlt (weder Tarif noch
  -- Uebersteuerung), gilt 0 statt unbegrenzt -- die Schleife allein wuerde das faelschlich als
  -- "keine Grenze" behandeln, weil ihr Rumpf fuer eine fehlende Zeile nie ausgefuehrt wird (beim
  -- CodeRabbit-Review dieses Pakets gefunden: ein Tarif ohne z. B. eine ai_image-Zeile liess
  -- KI-Bilder bislang ungeprueft durch).
  if exists (select 1 from public.organization_subscriptions where organization_id = post.organization_id) then
    content_limit_found := false;
    for content_limit_row in
      select * from public.effective_content_limits(post.organization_id) where media_origin = version.media_origin
    loop
      content_limit_found := true;
      if content_limit_row.media_origin = 'ai_video' and version.ai_generated_video_duration_seconds is not null
         and content_limit_row.max_duration_seconds is not null
         and version.ai_generated_video_duration_seconds > content_limit_row.max_duration_seconds then
        raise exception 'content_duration_exceeded: %/%', version.media_origin, content_limit_row.max_duration_seconds;
      end if;
      if content_limit_row.max_per_month is not null
         and public.count_publications_in_period(post.organization_id, null, null, null, 'month', now(), version.media_origin) >= content_limit_row.max_per_month then
        raise exception 'content_quota_exceeded: %/%', version.media_origin, content_limit_row.max_per_month;
      end if;
    end loop;
    if not content_limit_found then
      raise exception 'content_quota_exceeded: %/0', version.media_origin;
    end if;
  end if;

  insert into public.publications (organization_id, post_version_id, social_connection_id, platform, scheduled_for, idempotency_key)
  values (
    post.organization_id, target_post_version_id, target_social_connection_id, connection.platform, target_scheduled_for,
    'publish:' || target_post_version_id::text || ':' || connection.platform || ':' || target_social_connection_id::text
  )
  returning * into result;

  update public.posts set status = 'scheduled', updated_at = now() where id = post.id;

  return result;
end;
$$;

commit;
