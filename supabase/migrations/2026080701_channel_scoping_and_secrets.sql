begin;

-- Paket 012: Kanaele und Social-Accounts. Plan-Dateiname war 2026080405_channel_scoping_and_secrets.sql
-- -- dieser Zeitstempel liegt vor allen sechs 2026080601..06-Migrationen aus Paket 011/023 und damit
-- vor channel_quotas/policy_settings selbst (dasselbe Muster wie schon bei 2026080606, siehe dessen
-- Kopfkommentar). Der tatsaechliche Dateiname folgt der naechsten freien Zeitscheibe.

-- 0. department_admin braucht social_account.manage -------------------------------------------
--
-- Ohne dies gaebe es keine Rolle, die ausschliesslich die eigene Abteilung verwaltet, aber deren
-- Kanaele bespielen darf: social_manager (packages/authorization) ist eine Vereinsrolle,
-- department_admin die einzige abteilungsscoped Verwaltungsrolle -- und genau sie muss laut Plan
-- 012 ("ein Abteilungsadmin darf ausschliesslich Kanaele freigeben, die seine eigene Abteilung
-- besitzt") eigene, department-eigene Kanaele verwalten koennen. Volle Funktionskopie aus
-- 2026080601_structure_and_invitations.sql, nur das Array um die eine Permission erweitert.
create or replace function authz.has_department_permission(target_department_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.department_memberships membership
    where membership.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','analytics.view'])
        when 'editor' then permission = any(array['post.create','post.edit','post.submit','analytics.view'])
        when 'approver' then permission = any(array['post.approve','analytics.view'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.departments department
    where department.id = target_department_id
      and authz.has_organization_permission(department.organization_id, permission)
  );
$$;

-- 1. Geheimnisse aus dem Lesepfad nehmen -----------------------------------------------------
--
-- token_ciphertext/token_key_version wandern in eine eigene Tabelle ganz ohne Policy fuer
-- authenticated -- analog llm_provider_secrets aus Paket 022 (2026080502_platform_administration.sql),
-- das genau als Vorlage fuer dieses Muster gebaut wurde. Reihenfolge zwingend: Backfill, Abbruch bei
-- Unstimmigkeit, danach erst die Spalten entfernen. Ohne diese Reihenfolge waere jede bestehende
-- Verbindung nach der Migration geheimnislos und jede Veroeffentlichung schluege fehl, bis ein
-- Reconnect stattfindet (Plan 012, "Sicherheitsbefund zuerst").
create table public.social_connection_secrets (
  organization_id uuid not null,
  social_connection_id uuid primary key,
  token_ciphertext bytea not null,
  token_key_version text not null,
  refresh_token_ciphertext bytea,
  rotated_at timestamptz not null default now(),
  foreign key (organization_id, social_connection_id)
    references public.social_connections(organization_id, id) on delete cascade
);
alter table public.social_connection_secrets enable row level security;
alter table public.social_connection_secrets force row level security;
-- Keine Policy fuer authenticated -- nur service_role kommt heran.
grant all privileges on public.social_connection_secrets to service_role;

insert into public.social_connection_secrets (organization_id, social_connection_id, token_ciphertext, token_key_version)
select organization_id, id, token_ciphertext, token_key_version from public.social_connections;

do $$ begin
  if (select count(*) from public.social_connections) <> (select count(*) from public.social_connection_secrets) then
    raise exception 'token backfill incomplete';
  end if;
end $$;

alter table public.social_connections drop column token_ciphertext;
alter table public.social_connections drop column token_key_version;

-- 2. Kanalbesitz, Verantwortung, Vertraulichkeit ---------------------------------------------
alter table public.social_connections add column owner_scope public.policy_scope not null default 'organization';
alter table public.social_connections add column owner_department_id uuid;
alter table public.social_connections add column responsible_profile_id uuid references public.profiles(id);
alter table public.social_connections add column purpose text check (char_length(purpose) <= 200);
alter table public.social_connections add column archived_at timestamptz;
-- Vertraulicher Kanal: ein Beitrag, dessen Veroeffentlichungsziele ausschliesslich hierhin zeigen,
-- bleibt von der vereinsweiten Sichtbarkeit ausgenommen (Plan 012, "Datenmodell" -- Nachtrag zum
-- Review von Paket 010, entschieden nach Paket 023). Siehe authz.post_is_not_confidential_only
-- und die posts_select/post_versions_select-Erweiterung weiter unten.
alter table public.social_connections add column confidential boolean not null default false;
-- team ist kein gueltiger Kanalbesitz (nur organization/department) -- policy_scope selbst kennt
-- 'team', der CHECK unten laesst es aber nicht zu.
alter table public.social_connections add constraint social_connections_owner_check check (
  (owner_scope = 'organization' and owner_department_id is null) or
  (owner_scope = 'department' and owner_department_id is not null)
);
alter table public.social_connections add constraint social_connections_owner_department_fk
  foreign key (organization_id, owner_department_id)
  references public.departments(organization_id, id) on delete restrict;

-- Spaltenrechte statt Tabellenrechte (Plan 012, Massnahme 1, ergaenzend zur separaten
-- Geheimnistabelle oben, die die eigentliche Durchsetzung ist): verhindert, dass eine spaetere,
-- unbedacht hinzugefuegte Spalte automatisch ueber eine bestehende Tabellen-Grant an authenticated
-- durchsickert.
revoke select on public.social_connections from authenticated;
grant select (
  id, organization_id, platform, external_account_id, display_name, scopes, token_expires_at,
  status, last_verified_at, metadata, owner_scope, owner_department_id, responsible_profile_id,
  purpose, archived_at, confidential, created_at, updated_at
) on public.social_connections to authenticated;

-- is_any_member_of_organization statt is_organization_member, aus demselben Grund wie bei
-- channel_quotas_select (Plan 011): is_organization_member verlangt eine ORGANISATIONSROLLE. Ein
-- reiner Abteilungsadmin ohne Organisationsrolle muss einen abteilungseigenen Kanal lesen koennen,
-- um ihn ueberhaupt zu verwalten -- sonst waere schon die EXISTS-Pruefung in channel_scopes_insert
-- unten fuer ihn leer, weil die Unterabfrage denselben RLS-Policies unterliegt (beim eigenen Review
-- dieses Pakets gefunden).
alter policy connections_select on public.social_connections
  using (authz.is_any_member_of_organization(organization_id));

-- 3. Wer darf einen Kanal bespielen? Explizite Freigabe, kein implizites Erben ----------------
--
-- Ein Kanal ohne jeden channel_scopes-Eintrag ist fuer niemanden bespielbar (Plan 012). Schreibend
-- nur ueber RLS mit direkter Kanalbesitz-Pruefung, nicht ueber die Ziel-Scope-Berechtigung allein:
-- ein Abteilungsadmin darf ausschliesslich Kanaele freigeben, die seine EIGENE Abteilung besitzt
-- (Plan 012, "Zuordnung und Verantwortung") -- nicht jeden Kanal, fuer dessen Zielebene er zufaellig
-- department.manage/team.manage haelt.
create table public.channel_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  social_connection_id uuid not null,
  scope public.policy_scope not null,
  department_id uuid,
  team_id uuid,
  can_schedule boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  foreign key (organization_id, social_connection_id) references public.social_connections(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade
);
-- Wie bei channel_quotas (Paket 011): scope-Spalten sind bei einer vereinsweiten Freigabe NULL, und
-- NULL ist in einem Unique-Key nicht gleich NULL. Ohne Normalisierung koennte derselbe Kanal
-- zweimal fuer dieselbe Ebene freigegeben sein -- bei unterschiedlichem can_schedule waere
-- unentscheidbar, welche Zeile gilt.
create unique index channel_scopes_unique on public.channel_scopes (
  social_connection_id, scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
alter table public.channel_scopes enable row level security;
alter table public.channel_scopes force row level security;
create policy channel_scopes_select on public.channel_scopes for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));
create policy channel_scopes_insert on public.channel_scopes for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.social_connections connection
      where connection.id = channel_scopes.social_connection_id
        and connection.organization_id = channel_scopes.organization_id
        and (
          (connection.owner_scope = 'organization' and authz.has_organization_permission(connection.organization_id, 'social_account.manage'))
          or (connection.owner_scope = 'department' and authz.has_department_permission(connection.owner_department_id, 'social_account.manage'))
        )
    )
  );
create policy channel_scopes_delete on public.channel_scopes for delete to authenticated
  using (
    exists (
      select 1 from public.social_connections connection
      where connection.id = channel_scopes.social_connection_id
        and connection.organization_id = channel_scopes.organization_id
        and (
          (connection.owner_scope = 'organization' and authz.has_organization_permission(connection.organization_id, 'social_account.manage'))
          or (connection.owner_scope = 'department' and authz.has_department_permission(connection.owner_department_id, 'social_account.manage'))
        )
    )
  );
grant select, insert, delete on public.channel_scopes to authenticated;
grant all privileges on public.channel_scopes to service_role;

-- 4. Vereinsweite Kanal-Richtlinien, ergaenzt in policy_settings (Paket 023 legte die Tabelle an,
-- Paket 011 erweiterte sie um Freigabe-/Kontingentfelder) --------------------------------------
alter table public.policy_settings
  add column allow_department_owned_channels boolean,
  add column require_channel_responsible boolean;

-- Ersetzt den Grant aus 2026080606 vollstaendig (kein "ADD COLUMN TO GRANT" in Postgres).
grant select (
  id, organization_id, scope, department_id, team_id, invite_allowed, posts_visible_org_wide,
  submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals,
  review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages,
  allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids,
  forbidden_topics, required_hashtags, tone, allow_department_owned_channels, require_channel_responsible,
  created_at, updated_at
) on public.policy_settings to authenticated;

-- set_policy_setting() (2026080604) um die zwei neuen Felder erweitert. Beide sind bewusst NICHT
-- ueber authz.resolve_policy_flag aufloesbar wie invite_allowed/posts_visible_org_wide -- sie
-- gelten nur auf Vereinsebene (Plan 012: "eine Abteilung darf sich diese Erlaubnis nicht selbst
-- geben"). Die Durchsetzung sitzt HIER in der RPC selbst, nicht nur im Fastify-Layer: die Funktion
-- ist per Grant direkt erreichbar, ein authenticated-Aufrufer koennte target_scope sonst frei auf
-- 'department' setzen und sich die Erlaubnis selbst erteilen (dieselbe Lehre wie bei
-- request_approval/schedule_publication, Plan 011: eine security-definer-RPC leitet
-- sicherheitsrelevante Werte selbst her statt sie vom Aufrufer zu uebernehmen).
create or replace function public.set_policy_setting(
  target_organization_id uuid, target_scope text, target_department_id uuid, target_team_id uuid,
  target_flag text, target_value boolean
) returns public.policy_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authorized boolean;
  existing_id uuid;
  result public.policy_settings;
begin
  if target_flag not in ('invite_allowed', 'posts_visible_org_wide', 'allow_department_owned_channels', 'require_channel_responsible') then
    raise exception 'unknown_policy_flag';
  end if;

  if target_flag in ('allow_department_owned_channels', 'require_channel_responsible') and target_scope <> 'organization' then
    raise exception 'organization_only_flag';
  end if;

  if target_scope = 'organization' then
    authorized := authz.has_organization_permission(target_organization_id, 'organization.manage');
  elsif target_scope = 'department' then
    authorized := authz.has_department_permission(target_department_id, 'department.manage');
  elsif target_scope = 'team' then
    authorized := authz.has_team_permission(target_team_id, 'team.manage');
  else
    raise exception 'invalid_scope';
  end if;
  if not authorized then
    raise exception 'insufficient_permission';
  end if;

  select id into existing_id from public.policy_settings
    where organization_id = target_organization_id
      and scope = target_scope::public.policy_scope
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
    for update;

  if existing_id is not null then
    if target_flag = 'invite_allowed' then
      update public.policy_settings set invite_allowed = target_value, updated_by = auth.uid() where id = existing_id;
    elsif target_flag = 'posts_visible_org_wide' then
      update public.policy_settings set posts_visible_org_wide = target_value, updated_by = auth.uid() where id = existing_id;
    elsif target_flag = 'allow_department_owned_channels' then
      update public.policy_settings set allow_department_owned_channels = target_value, updated_by = auth.uid() where id = existing_id;
    else
      update public.policy_settings set require_channel_responsible = target_value, updated_by = auth.uid() where id = existing_id;
    end if;
  else
    insert into public.policy_settings (
      organization_id, scope, department_id, team_id, invite_allowed, posts_visible_org_wide,
      allow_department_owned_channels, require_channel_responsible, updated_by
    )
      values (
        target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id,
        case when target_flag = 'invite_allowed' then target_value end,
        case when target_flag = 'posts_visible_org_wide' then target_value end,
        case when target_flag = 'allow_department_owned_channels' then target_value end,
        case when target_flag = 'require_channel_responsible' then target_value end,
        auth.uid()
      )
      returning id into existing_id;
  end if;

  select * into result from public.policy_settings where id = existing_id;
  return result;
end;
$$;
revoke all on function public.set_policy_setting(uuid, text, uuid, uuid, text, boolean) from public;
grant execute on function public.set_policy_setting(uuid, text, uuid, uuid, text, boolean) to authenticated;

-- 5. Einplanen: channel_scopes und Kanalstatus durchsetzen -------------------------------------
--
-- schedule_publication() (2026080606) ist die tatsaechliche Durchsetzungsgrenze -- resolveAvailableChannels
-- (packages/domain) spiegelt dieselbe Regel fuer die Oberflaeche/den API-Vorabcheck, ersetzt diese
-- Pruefung hier aber nicht: die RPC ist per Grant direkt erreichbar (Plan 011/012).
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
  result public.publications;
begin
  select * into version from public.post_versions where id = target_post_version_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into post from public.posts where id = version.post_id and organization_id = version.organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if post.status <> 'approved' then raise exception 'invalid_status'; end if;
  if not authz.has_department_permission(post.department_id, 'post.publish') then
    raise exception 'insufficient_permission';
  end if;

  select * into connection from public.social_connections where id = target_social_connection_id and organization_id = post.organization_id;
  if not found then raise exception 'not_found'; end if;
  -- Ein Token, das in weniger als sieben Tagen ablaeuft oder dessen Pruefung fehlgeschlagen ist,
  -- setzt status = 'action_required' (public.flag_channels_needing_reconnect weiter unten bzw. der
  -- Verify-Endpunkt; ein Scheduler, der die Funktion taeglich aufruft, fehlt dem Stack noch --
  -- siehe Plan 012, "Risiken und offene Entscheidungen"). Einplanen auf einem solchen Kanal ist
  -- kein Retry-faehiger Fehler, sondern ein fachlicher Zustand.
  if connection.status <> 'active' or connection.archived_at is not null then
    raise exception 'channel_not_allowed';
  end if;

  -- Ein Kanal ohne jeden channel_scopes-Eintrag fuer diesen Scope oder eine uebergeordnete Ebene
  -- ist fuer niemanden bespielbar (Plan 012, "Auflösungsregel fuer erlaubte Kanaele").
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

  -- null heisst "keine Einschraenkung", die leere Liste heisst "nichts erlaubt" (Plan 011,
  -- "Zusammenfuehrung der Ebenen"; resolveAvailableChannels in packages/domain setzt genau das um).
  -- Deshalb KEIN jsonb_array_length(...) > 0 hier: das haette eine leere Liste stillschweigend zu
  -- "alles erlaubt" gemacht und die Richtlinie ueber den direkten RPC-Aufruf umgehbar.
  allowed_channels := version.effective_config_snapshot->'config'->'allowedChannelIds';
  if allowed_channels is not null and jsonb_typeof(allowed_channels) = 'array'
     and not exists (select 1 from jsonb_array_elements_text(allowed_channels) value where value = target_social_connection_id::text) then
    raise exception 'channel_not_allowed';
  end if;

  -- Auf Vereinsebene gesperrt, nicht je Abteilung/Team: die Schleife unten liest auch
  -- vereinsweite Kontingentzeilen, die fuer ALLE Abteilungen gelten. Ein abteilungsfeiner Schluessel
  -- haette zwei gleichzeitige Einplanungen aus verschiedenen Abteilungen an der Grenze desselben
  -- vereinsweiten Kontingents beide durchgelassen (Plan 011). Der Kontingentraum ist ohnehin je
  -- Verein serialisiert.
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

-- 6. Sichtbarkeit: ein Beitrag, der ausschliesslich vertrauliche Kanaele bedient, bleibt bei der
-- abteilungsweiten Sichtbarkeit (Plan 012, "Datenmodell") ---------------------------------------
--
-- Als eigene Funktion statt inline dupliziert: posts_select und post_versions_select brauchen
-- dieselbe Pruefung, einmal ueber posts.id/current_version_id, einmal ueber post.current_version_id
-- aus dem Join. Restriktiv wird es NUR, wenn Publikationen existieren UND alle davon vertraulich
-- sind -- keine Publikation zur aktuellen Version (z. B. ein aeltere Fixture ohne Kanalbezug, oder
-- ein kuenftiger Veroeffentlichungspfad ohne Publikationszeile) ist kein Beweis fuer Vertraulichkeit
-- und darf die bisherige org-weite Sichtbarkeit nicht stillschweigend entziehen.
create or replace function authz.post_is_not_confidential_only(target_organization_id uuid, target_post_version_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
    not exists (
      select 1 from public.publications publication
      where publication.organization_id = target_organization_id
        and publication.post_version_id = target_post_version_id
    )
    or exists (
      select 1 from public.publications publication
      join public.social_connections connection
        on connection.id = publication.social_connection_id and connection.organization_id = publication.organization_id
      where publication.organization_id = target_organization_id
        and publication.post_version_id = target_post_version_id
        and connection.confidential = false
    );
$$;
revoke all on function authz.post_is_not_confidential_only(uuid, uuid) from public;
grant execute on function authz.post_is_not_confidential_only(uuid, uuid) to authenticated, service_role;

alter policy posts_select on public.posts
  using (
    (
      status in ('published', 'scheduled')
      and authz.is_any_member_of_organization(organization_id)
      and authz.resolve_policy_flag(organization_id, department_id, team_id, 'posts_visible_org_wide')
      and authz.post_is_not_confidential_only(organization_id, current_version_id)
    )
    or authz.is_department_member(department_id)
    or (team_id is not null and authz.has_team_membership(team_id))
    or authz.is_assigned_reviewer_of_post(id)
  );

alter policy post_versions_select on public.post_versions
  using (
    exists (
      select 1 from public.posts post
      where post.id = post_versions.post_id
        and post.organization_id = post_versions.organization_id
        and (
          (
            post.status in ('published', 'scheduled')
            and authz.is_any_member_of_organization(post.organization_id)
            and authz.resolve_policy_flag(post.organization_id, post.department_id, post.team_id, 'posts_visible_org_wide')
            and authz.post_is_not_confidential_only(post.organization_id, post.current_version_id)
          )
          or authz.is_department_member(post.department_id)
          or (post.team_id is not null and authz.has_team_membership(post.team_id))
        )
    )
    or authz.is_assigned_reviewer(id)
  );

-- 7. OAuth-Zwischenspeicher: kurzlebig, ausschliesslich service_role --------------------------
--
-- 'state' wird nie ungeprueft zurueckvertraut (Plan 012): die Callback-Route prueft den Nonce
-- gegen genau diese Zeile und verbraucht ihn dabei. Keine Policy fuer authenticated -- der Nonce ist
-- ein reines Implementierungsdetail der API.
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  owner_scope public.policy_scope not null,
  owner_department_id uuid,
  nonce text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check ((owner_scope = 'organization' and owner_department_id is null) or (owner_scope = 'department' and owner_department_id is not null)),
  foreign key (organization_id, owner_department_id) references public.departments(organization_id, id) on delete cascade
);
alter table public.oauth_states enable row level security;
alter table public.oauth_states force row level security;
grant all privileges on public.oauth_states to service_role;

-- Zwischenspeicher zwischen Callback (Token-Tausch) und Auswahl (welche Seite/welches
-- Instagram-Business-Konto). Erst nach expliziter Auswahl entsteht die social_connections-Zeile
-- (Plan 012: "Es entstehen nie Zeilen fuer Konten, die der Nutzer nicht ausgewaehlt hat"). Kein
-- Nutzertoken hier -- der Callback tauscht es sofort gegen die Seiten-/Instagram-Business-Tokens in
-- available_accounts, danach wird das Nutzertoken nicht mehr gebraucht. Jeder Seiten-Token darin ist
-- einzeln versiegelt (AAD = Zeilen-ID + externalAccountId), nicht die ganze Zeile auf einmal --
-- GET /v1/oauth-pending/:id gibt nur externalAccountId/displayName heraus, nie einen Ciphertext.
create table public.oauth_pending_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  owner_scope public.policy_scope not null,
  owner_department_id uuid,
  available_accounts jsonb not null check (jsonb_typeof(available_accounts) = 'array'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check ((owner_scope = 'organization' and owner_department_id is null) or (owner_scope = 'department' and owner_department_id is not null)),
  foreign key (organization_id, owner_department_id) references public.departments(organization_id, id) on delete cascade
);
alter table public.oauth_pending_connections enable row level security;
alter table public.oauth_pending_connections force row level security;
grant all privileges on public.oauth_pending_connections to service_role;

-- 8. Taeglicher Kanal-Check: Token-Ablauf, ueberfaellige Verbindungen -------------------------
--
-- Erster echter Scheduler-Aufrufer im Repository (mark_stalled_approval_stages aus Paket 011
-- wartet noch auf einen). Nur service_role -- kein legitimer authenticated-Aufrufer.
create or replace function public.flag_channels_needing_reconnect(warning_window interval default interval '7 days')
returns integer
language sql security definer set search_path = public, pg_temp as $$
  with updated as (
    update public.social_connections
    set status = 'action_required'
    where status = 'active'
      and archived_at is null
      and token_expires_at is not null
      and token_expires_at < now() + warning_window
    returning id
  )
  select count(*)::integer from updated;
$$;
revoke all on function public.flag_channels_needing_reconnect(interval) from public;
grant execute on function public.flag_channels_needing_reconnect(interval) to service_role;

-- Raeumt abgelaufene OAuth-Zwischenzustaende weg -- reine Housekeeping, kein Sicherheitsgate (ein
-- abgelaufener Datensatz wird von der Callback-/Auswahl-Route ohnehin abgelehnt).
create or replace function public.cleanup_expired_oauth_state()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  removed integer;
begin
  delete from public.oauth_states where expires_at < now();
  get diagnostics removed = row_count;
  delete from public.oauth_pending_connections where expires_at < now();
  return removed;
end;
$$;
revoke all on function public.cleanup_expired_oauth_state() from public;
grant execute on function public.cleanup_expired_oauth_state() to service_role;

commit;
