begin;

-- Paket 011: Freigaberouten, Vertrauen je Mitglied, Kontingente. Erweitert public.policy_settings
-- (angelegt in 2026080604) um die Freigabe-, Medien- und Kontingentfelder -- die Tabelle selbst
-- entsteht hier nicht neu. Ursprünglich als 2026080404_policies_and_review_routes.sql geplant;
-- dieser Zeitstempel liegt vor den vier 023-Migrationen und damit vor policy_settings selbst
-- (siehe plans/011, "Ausgangslage und Evidenz").

create type public.review_mode as enum ('any_with_permission', 'named');

alter table public.policy_settings
  add column submit_requires_permission boolean,
  add column review_required boolean,
  add column review_mode public.review_mode,
  add column review_stage_label text check (char_length(review_stage_label) <= 80),
  add column review_minimum_approvals integer check (review_minimum_approvals between 1 and 5),
  add column review_deadline_hours integer check (review_deadline_hours between 1 and 720),
  add column minor_approval_required boolean,
  add column self_approval_allowed boolean,
  add column allow_same_reviewer_across_stages boolean,
  add column allow_review_exemptions boolean,
  add column media_requires_consent_check boolean,
  add column allowed_presets text[],
  add column allowed_formats text[],
  add column allowed_channel_ids uuid[],
  add column forbidden_topics text[] not null default '{}',
  add column required_hashtags text[] not null default '{}',
  add column tone text,
  add constraint policy_settings_named_requires_review
    check (review_mode is distinct from 'named' or review_required is true);

-- Ersetzt den Grant aus 2026080604 vollstaendig (Postgres erlaubt kein "ADD COLUMN TO GRANT" --
-- ein erneuter GRANT mit der vollen Spaltenliste ist additiv, kein REVOKE davor noetig). updated_by
-- bleibt aussen vor, aus demselben Grund wie in 2026080604: eine administrative Handlung einer
-- konkreten Person soll nicht vereinsweit sichtbar sein.
grant select (
  id, organization_id, scope, department_id, team_id, invite_allowed, posts_visible_org_wide,
  submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals,
  review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages,
  allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids,
  forbidden_topics, required_hashtags, tone, created_at, updated_at
) on public.policy_settings to authenticated;

-- Schreibend ueber set_policy_rules() (unten), analog zu set_policy_setting() fuer die beiden
-- booleschen Flags aus 023 -- die neuen Felder sind heterogen typisiert (integer, text[], uuid[],
-- enum), ein einzelner flag/value-Parameter wie bei set_policy_setting passt dafuer nicht mehr.
-- set_policy_setting bleibt unveraendert fuer invite_allowed/posts_visible_org_wide zustaendig.

create table public.policy_reviewers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  policy_settings_id uuid not null,
  kind text not null check (kind in ('user', 'organization_role', 'department_role', 'team_role')),
  user_id uuid references public.profiles(id) on delete cascade,
  role text,
  target_department_id uuid,
  target_team_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (kind = 'user' and user_id is not null and role is null and target_department_id is null and target_team_id is null) or
    (kind = 'organization_role' and user_id is null and role is not null and target_department_id is null and target_team_id is null) or
    (kind = 'department_role' and user_id is null and role is not null and target_department_id is not null and target_team_id is null) or
    (kind = 'team_role' and user_id is null and role is not null and target_department_id is not null and target_team_id is not null)
  ),
  foreign key (organization_id, policy_settings_id)
    references public.policy_settings(organization_id, id) on delete cascade,
  foreign key (organization_id, target_department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, target_department_id, target_team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);
create unique index policy_reviewers_user_unique on public.policy_reviewers (policy_settings_id, user_id) where kind = 'user';
create unique index policy_reviewers_role_unique on public.policy_reviewers (
  policy_settings_id, kind, role,
  coalesce(target_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(target_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where kind <> 'user';

create table public.member_review_trust (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid,
  team_id uuid,
  user_id uuid not null references public.profiles(id) on delete cascade,
  submit_allowed boolean not null default true,
  review_requirement text not null default 'inherit' check (review_requirement in ('inherit', 'always', 'waived')),
  reason text check (char_length(reason) <= 500),
  expires_at timestamptz,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department' and department_id is not null and team_id is null)
      or (scope = 'team' and department_id is not null and team_id is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);
-- Als Index statt UNIQUE-Constraint: coalesce() ist nur in Indexausdruecken erlaubt, und ohne die
-- Normalisierung waeren zwei Zeilen mit NULL-Scope fuer denselben Nutzer voneinander verschieden.
create unique index member_review_trust_unique on public.member_review_trust (
  organization_id, scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  user_id
);

create table public.approval_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_request_id uuid not null,
  position integer not null check (position > 0),
  scope public.policy_scope not null,
  scope_department_id uuid,
  scope_team_id uuid,
  label text not null,
  mode public.review_mode not null,
  minimum_approvals integer not null check (minimum_approvals between 1 and 5),
  is_minor_stage boolean not null default false,
  reviewer_snapshot jsonb not null check (jsonb_typeof(reviewer_snapshot) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'open', 'satisfied', 'rejected', 'skipped', 'stalled')),
  -- Abweichung vom Plan-DDL: deadline_hours zusaetzlich zu deadline_at, weil eine Frist relativ zum
  -- OEFFNEN der jeweiligen Stufe gilt, nicht relativ zur Erzeugung der ganzen Route (eine Stufe, die
  -- erst Tage spaeter oeffnet, soll ihre volle Frist ab dem Oeffnen bekommen). deadline_at wird beim
  -- Oeffnen aus deadline_hours berechnet (siehe decide_approval_stage/request_approval).
  deadline_hours integer check (deadline_hours between 1 and 720),
  deadline_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (approval_request_id, position),
  -- Traegt approval_request_id zusaetzlich, damit approval_decisions_stage_fk unten die Stufe an
  -- DIESELBE Anfrage binden kann -- ohne diese Constraint liesse sich eine Entscheidung an eine
  -- Stufe einer fremden approval_request haengen, und die Route wuerde umgehbar.
  unique (organization_id, approval_request_id, id),
  foreign key (organization_id, approval_request_id)
    references public.approval_requests(organization_id, id) on delete cascade,
  foreign key (organization_id, scope_department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, scope_department_id, scope_team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);
create index approval_stages_status_deadline_idx on public.approval_stages (status, deadline_at) where status = 'open';

alter table public.approval_requests
  add column self_approval_allowed boolean not null default true,
  add column allow_same_reviewer_across_stages boolean not null default false;

-- Bestandsentscheidungen einer Stufe zuordnen, bevor approval_stage_id pflichtig wird: je
-- approval_request entsteht genau eine Migrations-Stufe aus required_approvals/
-- requires_minor_approval, und jede vorhandene Entscheidung wird ihr zugewiesen.
alter table public.approval_decisions add column approval_stage_id uuid;

-- reviewer_snapshot wird aus dem bisher berechtigten Prueferkreis befuellt, nicht als leeres Array:
-- authz.can_decide_stage (unten) verlangt einen Treffer im Snapshot, und authz.is_assigned_reviewer
-- gibt daraus den Lesezugriff. Ein leerer Snapshot haette jede laufende Freigabe dauerhaft
-- unentscheidbar gemacht und den bisherigen Pruefern den Lesezugriff genommen. Der Kreis ist genau
-- der, den authz.can_approve_post_version bis zu dieser Migration durchgesetzt hat:
-- has_department_permission(post.department_id, 'post.approve') -- also die Abteilungsrollen mit
-- post.approve plus die Organisationsrollen, die dieselbe Berechtigung nach unten durchreichen.
insert into public.approval_stages (
  organization_id, approval_request_id, position, scope, scope_department_id, scope_team_id,
  label, mode, minimum_approvals, is_minor_stage, reviewer_snapshot, status, opened_at
)
select
  request.organization_id, request.id, 1, 'organization', null, null,
  'Migriert', 'any_with_permission', request.required_approvals, request.requires_minor_approval,
  coalesce(
    (
      select jsonb_agg(jsonb_build_object('userId', reviewer.user_id))
      from (
        select membership.user_id
        from public.department_memberships membership
        where membership.department_id = post.department_id
          and membership.role in ('department_admin', 'approver')
          and (membership.expires_at is null or membership.expires_at > now())
        union
        select membership.user_id
        from public.organization_memberships membership
        where membership.organization_id = post.organization_id
          and membership.role in ('organization_owner', 'organization_admin', 'social_manager')
          and (membership.expires_at is null or membership.expires_at > now())
      ) reviewer
    ),
    '[]'::jsonb
  ),
  case when exists (select 1 from public.approval_decisions decision where decision.approval_request_id = request.id)
    then 'satisfied' else 'open' end,
  request.created_at
from public.approval_requests request
join public.posts post on post.id = request.post_id and post.organization_id = request.organization_id;

update public.approval_decisions decision
set approval_stage_id = stage.id
from public.approval_stages stage
where stage.approval_request_id = decision.approval_request_id;

alter table public.approval_decisions alter column approval_stage_id set not null;

-- Dreispaltig, nicht zweispaltig: sonst laesst sich eine Entscheidung an eine Stufe einer FREMDEN
-- Anfrage haengen, und die Route wird umgehbar.
alter table public.approval_decisions add constraint approval_decisions_stage_fk
  foreign key (organization_id, approval_request_id, approval_stage_id)
  references public.approval_stages(organization_id, approval_request_id, id) on delete cascade;
alter table public.approval_decisions drop constraint approval_decisions_approval_request_id_decided_by_key;
alter table public.approval_decisions
  add constraint approval_decisions_stage_unique unique (approval_stage_id, decided_by);

create table public.channel_quotas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid,
  team_id uuid,
  social_connection_id uuid,
  period text not null check (period in ('day', 'week', 'month')),
  max_publications integer not null check (max_publications between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department' and department_id is not null and team_id is null)
      or (scope = 'team' and department_id is not null and team_id is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  foreign key (organization_id, social_connection_id)
    references public.social_connections(organization_id, id) on delete cascade
);
create unique index channel_quotas_unique on public.channel_quotas (
  organization_id, scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(social_connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period
);
create index publications_quota_idx on public.publications (organization_id, social_connection_id, created_at desc);

-- Gezaehlt wird als Aggregat, nicht als Zaehlerspalte: ein storniertes/verschobenes/wiederholtes
-- Publishing wuerde eine Zaehlerspalte sofort von der Wahrheit abweichen lassen. Perioden liegen in
-- der Vereinszeitzone. Gezaehlt werden queued/uploading/processing/published -- alles, was den
-- Platz belegt oder belegt hat; failed/cancelled nicht.
create or replace function public.count_publications_in_period(
  target_organization uuid, target_department uuid, target_team uuid,
  target_connection uuid, quota_period text, reference timestamptz
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
    and publication.status in ('queued', 'uploading', 'processing', 'published')
    and (
      (quota_period = 'day' and date_trunc('day', publication.created_at at time zone org.timezone) = date_trunc('day', reference at time zone org.timezone))
      or (quota_period = 'week' and date_trunc('week', publication.created_at at time zone org.timezone) = date_trunc('week', reference at time zone org.timezone))
      or (quota_period = 'month' and date_trunc('month', publication.created_at at time zone org.timezone) = date_trunc('month', reference at time zone org.timezone))
    );
$$;
-- Kein legitimer Aufrufer ausserhalb von schedule_publication() (SECURITY DEFINER, prueft die
-- Berechtigung vorher selbst) -- ein Grant an authenticated wuerde jedem erlauben, die
-- Veroeffentlichungszahl eines FREMDEN Vereins per direktem RPC-Aufruf abzufragen (beim
-- Mandantentrennung-Review gefunden: die Funktion selbst hat keine eigene Mitgliedschaftspruefung).
revoke all on function public.count_publications_in_period(uuid, uuid, uuid, uuid, text, timestamptz) from public;
grant execute on function public.count_publications_in_period(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;

-- Prueferzugang: ein Marketing-Pruefer ist kein Mitglied der Abteilung Fussball. reviewer_snapshot
-- friert die zum Zeitpunkt der Routenauflösung aufgeloesten Prueferinnen als {"userId": "<uuid>", ...}
-- ein -- eine Rollenaenderung mitten in einer laufenden Freigabe aendert deshalb nicht, wer zustimmen darf.
create or replace function authz.is_assigned_reviewer(target_post_version_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.approval_requests request
    join public.approval_stages stage on stage.approval_request_id = request.id and stage.organization_id = request.organization_id
    where request.post_version_id = target_post_version_id
      and stage.status <> 'skipped'
      and exists (select 1 from jsonb_array_elements(stage.reviewer_snapshot) elem where (elem->>'userId')::uuid = auth.uid())
  );
$$;

-- Generalisiert authz.is_any_member_of_organization auf eine BELIEBIGE Person statt auth.uid() --
-- request_approval() braucht das, um die vom Aufrufer mitgelieferten reviewer_snapshot-Eintraege
-- gegen echte Mitgliedschaft zu pruefen (siehe dort: "Verteidigung in der Tiefe" reichte ohne
-- diese Pruefung nicht, weil reviewer_snapshot als jsonb keinen Fremdschluessel tragen kann).
create or replace function authz.is_user_member_of_organization(target_user_id uuid, target_organization_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.organization_memberships m where m.organization_id = target_organization_id and m.user_id = target_user_id and (m.expires_at is null or m.expires_at > now()))
    or exists (select 1 from public.department_memberships m where m.organization_id = target_organization_id and m.user_id = target_user_id and (m.expires_at is null or m.expires_at > now()))
    or exists (select 1 from public.team_memberships m where m.organization_id = target_organization_id and m.user_id = target_user_id and (m.expires_at is null or m.expires_at > now()));
$$;
revoke all on function authz.is_user_member_of_organization(uuid, uuid) from public;
grant execute on function authz.is_user_member_of_organization(uuid, uuid) to authenticated, service_role;

create or replace function authz.is_assigned_reviewer_of_post(target_post_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.approval_requests request
    where request.post_id = target_post_id
      and authz.is_assigned_reviewer(request.post_version_id)
  );
$$;

-- Ersetzt authz.can_approve_post_version als Durchsetzung von approval_decisions_insert. Prueft:
-- Stufe ist offen, die Person steht im eingefrorenen reviewer_snapshot, hat auf dieser Stufe noch
-- nicht entschieden, ist nicht Autor bei self_approval_allowed = false, und hat nicht bereits auf
-- einer INNEREN Stufe entschieden bei allow_same_reviewer_across_stages = false.
create or replace function authz.can_decide_stage(target_stage_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.approval_stages stage
    join public.approval_requests request on request.id = stage.approval_request_id and request.organization_id = stage.organization_id
    join public.post_versions version on version.id = request.post_version_id and version.organization_id = request.organization_id
    where stage.id = target_stage_id
      and stage.status = 'open'
      and exists (select 1 from jsonb_array_elements(stage.reviewer_snapshot) elem where (elem->>'userId')::uuid = auth.uid())
      and not exists (select 1 from public.approval_decisions decision where decision.approval_stage_id = stage.id and decision.decided_by = auth.uid())
      and (request.self_approval_allowed or version.created_by_user_id is distinct from auth.uid())
      and (
        request.allow_same_reviewer_across_stages
        or not exists (
          select 1
          from public.approval_decisions decision
          join public.approval_stages inner_stage on inner_stage.id = decision.approval_stage_id
          where decision.approval_request_id = request.id
            and decision.decided_by = auth.uid()
            and inner_stage.position < stage.position
        )
      )
  );
$$;

-- Wrapper fuer Bestandsaufrufer, bis alle auf can_decide_stage umgestellt sind (Plan 011,
-- "Pruferzugang"): true, wenn irgendeine OFFENE Stufe der Version fuer auth.uid() entscheidbar ist.
create or replace function authz.can_approve_post_version(target_post_version_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.approval_requests request
    join public.approval_stages stage on stage.approval_request_id = request.id and stage.organization_id = request.organization_id
    where request.post_version_id = target_post_version_id
      and stage.status = 'open'
      and authz.can_decide_stage(stage.id)
  );
$$;

revoke all on function authz.is_assigned_reviewer(uuid) from public;
revoke all on function authz.is_assigned_reviewer_of_post(uuid) from public;
revoke all on function authz.can_decide_stage(uuid) from public;
grant execute on function authz.is_assigned_reviewer(uuid) to authenticated, service_role;
grant execute on function authz.is_assigned_reviewer_of_post(uuid) to authenticated, service_role;
grant execute on function authz.can_decide_stage(uuid) to authenticated, service_role;

-- RLS-Erweiterungen: nur die Policies, die zur Pruefung noetig sind (Plan 011, "Prueferzugang" --
-- die Tabelle "Ausdruecklich nicht erweitert"). Jede alter policy uebernimmt die volle bisherige
-- Bedingung (2026080603/2026080604) und ergaenzt ausschliesslich die Pruefer-/Autor-Zweige.
alter policy posts_select on public.posts
  using (
    (
      status in ('published', 'scheduled')
      and authz.is_any_member_of_organization(organization_id)
      and authz.resolve_policy_flag(organization_id, department_id, team_id, 'posts_visible_org_wide')
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
          )
          or authz.is_department_member(post.department_id)
          or (post.team_id is not null and authz.has_team_membership(post.team_id))
        )
    )
    or authz.is_assigned_reviewer(id)
  );

alter policy variants_select on public.post_variants
  using (authz.is_organization_member(organization_id) or authz.is_assigned_reviewer(post_version_id));

alter policy derivatives_select on public.media_derivatives
  using (
    authz.is_organization_member(organization_id)
    or exists (
      select 1 from public.post_media media
      where media.media_derivative_id = media_derivatives.id
        and media.organization_id = media_derivatives.organization_id
        and authz.is_assigned_reviewer(media.post_version_id)
    )
  );

alter policy post_media_select on public.post_media
  using (authz.is_organization_member(organization_id) or authz.is_assigned_reviewer(post_version_id));

alter policy snapshots_select on public.approval_media_snapshots
  using (
    authz.is_organization_member(organization_id)
    or exists (
      select 1 from public.approval_requests request
      where request.id = approval_media_snapshots.approval_request_id
        and request.organization_id = approval_media_snapshots.organization_id
        and authz.is_assigned_reviewer(request.post_version_id)
    )
  );

-- Der Autor muss die Ablehnung lesen koennen (Plan 011): reason und wer entschieden hat, nicht die
-- Zusammensetzung noch nicht geoeffneter aeusserer Stufen -- das regelt die API-Antwort, nicht RLS.
alter policy approval_requests_select on public.approval_requests
  using (
    authz.is_organization_member(organization_id)
    or authz.is_assigned_reviewer(post_version_id)
    or exists (
      select 1 from public.post_versions version
      where version.id = approval_requests.post_version_id
        and version.organization_id = approval_requests.organization_id
        and version.created_by_user_id = auth.uid()
    )
  );

alter policy approval_decisions_select on public.approval_decisions
  using (
    authz.is_organization_member(organization_id)
    or authz.is_assigned_reviewer(post_version_id)
    or exists (
      select 1 from public.post_versions version
      where version.id = approval_decisions.post_version_id
        and version.organization_id = approval_decisions.organization_id
        and version.created_by_user_id = auth.uid()
    )
  );

alter policy approval_decisions_insert on public.approval_decisions
  with check (decided_by = auth.uid() and approval_stage_id is not null and authz.can_decide_stage(approval_stage_id));

-- approval_stages hat keine eigene Select-Policy vor diesem Paket (die Tabelle existiert erst hier).
alter table public.approval_stages enable row level security;
alter table public.approval_stages force row level security;
create policy approval_stages_select on public.approval_stages for select to authenticated
  using (
    authz.is_organization_member(organization_id)
    or exists (select 1 from jsonb_array_elements(reviewer_snapshot) elem where (elem->>'userId')::uuid = auth.uid())
    or exists (
      select 1 from public.approval_requests request
      join public.post_versions version on version.id = request.post_version_id and version.organization_id = request.organization_id
      where request.id = approval_stages.approval_request_id
        and version.created_by_user_id = auth.uid()
    )
  );
grant select on public.approval_stages to authenticated;
grant all privileges on public.approval_stages to service_role;
create trigger set_approval_stages_updated_at before update on public.approval_stages for each row execute function public.set_updated_at();

alter table public.policy_reviewers enable row level security;
alter table public.policy_reviewers force row level security;
create policy policy_reviewers_select on public.policy_reviewers for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));
create policy policy_reviewers_insert on public.policy_reviewers for insert to authenticated
  with check (
    created_by = auth.uid()
    -- user_id zeigt nur auf public.profiles und kann deshalb keinen zusammengesetzten
    -- Fremdschluessel auf (organization_id, user_id) tragen -- ohne diese Pruefung liesse sich eine
    -- Person aus einem FREMDEN Verein als Pruefer eintragen. request_approval lehnt eine solche
    -- Route spaeter ab (invalid_reviewer_snapshot), die Ebene waere damit aber dauerhaft
    -- freigabeunfaehig statt die falsche Zuweisung schon hier zu verhindern.
    and (kind <> 'user' or authz.is_user_member_of_organization(user_id, organization_id))
    and exists (
      select 1 from public.policy_settings setting
      where setting.id = policy_reviewers.policy_settings_id and setting.organization_id = policy_reviewers.organization_id
        and (
          (setting.scope = 'organization' and authz.has_organization_permission(setting.organization_id, 'organization.manage'))
          or (setting.scope = 'department' and authz.has_department_permission(setting.department_id, 'department.manage'))
          or (setting.scope = 'team' and authz.has_team_permission(setting.team_id, 'team.manage'))
        )
    )
  );
create policy policy_reviewers_delete on public.policy_reviewers for delete to authenticated
  using (
    exists (
      select 1 from public.policy_settings setting
      where setting.id = policy_reviewers.policy_settings_id and setting.organization_id = policy_reviewers.organization_id
        and (
          (setting.scope = 'organization' and authz.has_organization_permission(setting.organization_id, 'organization.manage'))
          or (setting.scope = 'department' and authz.has_department_permission(setting.department_id, 'department.manage'))
          or (setting.scope = 'team' and authz.has_team_permission(setting.team_id, 'team.manage'))
        )
    )
  );
-- Spaltenweise wie policy_settings.updated_by (023) und member_review_trust.granted_by oben: wer
-- eine Pruefer-Zuweisung angelegt hat, ist eine administrative Handlung einer konkreten Person und
-- soll nicht vereinsweit sichtbar sein (authz.is_any_member_of_organization in der Select-Policy
-- oben ist bewusst weit gefasst, damit jede Ebene die volle Freigaberoute sehen kann -- created_by
-- gehoert nicht zu dem, was dafuer noetig ist). Der Insert-Grant bleibt vollstaendig, weil
-- policy_reviewers_insert oben created_by = auth.uid() prueft und die Spalte deshalb schreibbar
-- sein muss.
grant select (id, organization_id, policy_settings_id, kind, user_id, role, target_department_id, target_team_id, created_at)
  on public.policy_reviewers to authenticated;
grant insert (organization_id, policy_settings_id, kind, user_id, role, target_department_id, target_team_id, created_by)
  on public.policy_reviewers to authenticated;
grant delete on public.policy_reviewers to authenticated;
grant all privileges on public.policy_reviewers to service_role;

-- Vertrauen je Mitglied bleibt lesbar fuer die Person selbst und fuer wer diese Ebene verwaltet --
-- anders als die zwei oeffentlichen Policy-Flags ist "wer wurde von der Pruefung befreit und
-- warum" naeher an einer administrativen Handlung als an einer Vereinsregel (dieselbe Vorsicht wie
-- beim updated_by-Grant auf policy_settings). Schreibend nur ueber set_member_review_trust().
alter table public.member_review_trust enable row level security;
alter table public.member_review_trust force row level security;
create policy member_review_trust_select on public.member_review_trust for select to authenticated
  using (
    user_id = auth.uid()
    or authz.has_organization_permission(organization_id, 'department.manage')
    or (department_id is not null and authz.has_department_permission(department_id, 'department.manage'))
    or (team_id is not null and authz.has_team_permission(team_id, 'team.manage'))
  );
grant select on public.member_review_trust to authenticated;
grant all privileges on public.member_review_trust to service_role;
create trigger set_member_review_trust_updated_at before update on public.member_review_trust for each row execute function public.set_updated_at();

-- Kontingente: dieselbe Verwaltungsberechtigung wie Richtlinien, direkt per RLS (keine
-- Race-Bedingung wie bei policy_settings' Upsert-auf-eine-Zeile -- jede Kombination aus
-- Scope/Kanal/Periode ist ein eigener, unabhaengiger Datensatz).
alter table public.channel_quotas enable row level security;
alter table public.channel_quotas force row level security;
-- is_any_member_of_organization statt is_organization_member, aus demselben Grund wie bei
-- policy_settings_select (2026080604): is_organization_member verlangt eine ORGANISATIONSROLLE. Ein
-- reiner Abteilungs- oder Team-Admin darf ueber channel_quotas_insert unten ein Kontingent seiner
-- Ebene anlegen, haette es danach aber nicht lesen koennen -- schon das "insert ... returning" der
-- API waere an der Select-Policy gescheitert (beim eigenen Review dieses Pakets gefunden).
create policy channel_quotas_select on public.channel_quotas for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));
create policy channel_quotas_insert on public.channel_quotas for insert to authenticated
  with check (
    (scope = 'organization' and authz.has_organization_permission(organization_id, 'organization.manage'))
    or (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  );
create policy channel_quotas_update on public.channel_quotas for update to authenticated
  using (
    (scope = 'organization' and authz.has_organization_permission(organization_id, 'organization.manage'))
    or (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  )
  with check (
    (scope = 'organization' and authz.has_organization_permission(organization_id, 'organization.manage'))
    or (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  );
create policy channel_quotas_delete on public.channel_quotas for delete to authenticated
  using (
    (scope = 'organization' and authz.has_organization_permission(organization_id, 'organization.manage'))
    or (scope = 'department' and authz.has_department_permission(department_id, 'department.manage'))
    or (scope = 'team' and authz.has_team_permission(team_id, 'team.manage'))
  );
grant select, insert, update, delete on public.channel_quotas to authenticated;
grant all privileges on public.channel_quotas to service_role;
create trigger set_channel_quotas_updated_at before update on public.channel_quotas for each row execute function public.set_updated_at();

-- Richtlinien-Schreibpfad fuer die neuen, heterogen typisierten Felder. patch ist ein Objekt mit
-- camelCase-Schluesseln (Spiegelbild der Contracts-Schemas) -- eine unbekannte Schluessel schlaegt
-- fehl statt stillschweigend ignoriert zu werden. Dieselbe Select-for-update-dann-Upsert-Logik wie
-- set_policy_setting: eine Zeile fuer diesen Scope existiert vielleicht noch nicht.
create or replace function public.set_policy_rules(
  target_organization_id uuid, target_scope text, target_department_id uuid, target_team_id uuid, patch jsonb
) returns public.policy_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  authorized boolean;
  existing_id uuid;
  result public.policy_settings;
  allowed_keys text[] := array[
    'submitRequiresPermission', 'reviewRequired', 'reviewMode', 'reviewStageLabel', 'reviewMinimumApprovals',
    'reviewDeadlineHours', 'minorApprovalRequired', 'selfApprovalAllowed', 'allowSameReviewerAcrossStages',
    'allowReviewExemptions', 'mediaRequiresConsentCheck', 'allowedPresets', 'allowedFormats', 'allowedChannelIds',
    'forbiddenTopics', 'requiredHashtags', 'tone'
  ];
  patch_key text;
begin
  for patch_key in select jsonb_object_keys(patch) loop
    if not (patch_key = any(allowed_keys)) then
      raise exception 'unknown_policy_rule_field: %', patch_key;
    end if;
  end loop;

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

  if existing_id is null then
    insert into public.policy_settings (organization_id, scope, department_id, team_id, updated_by)
      values (target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id, auth.uid())
      returning id into existing_id;
  end if;

  update public.policy_settings set
    submit_requires_permission = case when patch ? 'submitRequiresPermission' then (patch->>'submitRequiresPermission')::boolean else submit_requires_permission end,
    review_required = case when patch ? 'reviewRequired' then (patch->>'reviewRequired')::boolean else review_required end,
    review_mode = case when patch ? 'reviewMode' then (patch->>'reviewMode')::public.review_mode else review_mode end,
    review_stage_label = case when patch ? 'reviewStageLabel' then patch->>'reviewStageLabel' else review_stage_label end,
    review_minimum_approvals = case when patch ? 'reviewMinimumApprovals' then (patch->>'reviewMinimumApprovals')::integer else review_minimum_approvals end,
    review_deadline_hours = case when patch ? 'reviewDeadlineHours' then (patch->>'reviewDeadlineHours')::integer else review_deadline_hours end,
    minor_approval_required = case when patch ? 'minorApprovalRequired' then (patch->>'minorApprovalRequired')::boolean else minor_approval_required end,
    self_approval_allowed = case when patch ? 'selfApprovalAllowed' then (patch->>'selfApprovalAllowed')::boolean else self_approval_allowed end,
    allow_same_reviewer_across_stages = case when patch ? 'allowSameReviewerAcrossStages' then (patch->>'allowSameReviewerAcrossStages')::boolean else allow_same_reviewer_across_stages end,
    allow_review_exemptions = case when patch ? 'allowReviewExemptions' then (patch->>'allowReviewExemptions')::boolean else allow_review_exemptions end,
    media_requires_consent_check = case when patch ? 'mediaRequiresConsentCheck' then (patch->>'mediaRequiresConsentCheck')::boolean else media_requires_consent_check end,
    allowed_presets = case
      when patch ? 'allowedPresets' and jsonb_typeof(patch->'allowedPresets') = 'array' then (select array_agg(value) from jsonb_array_elements_text(patch->'allowedPresets') value)
      when patch ? 'allowedPresets' then null
      else allowed_presets end,
    allowed_formats = case
      when patch ? 'allowedFormats' and jsonb_typeof(patch->'allowedFormats') = 'array' then (select array_agg(value) from jsonb_array_elements_text(patch->'allowedFormats') value)
      when patch ? 'allowedFormats' then null
      else allowed_formats end,
    allowed_channel_ids = case
      when patch ? 'allowedChannelIds' and jsonb_typeof(patch->'allowedChannelIds') = 'array' then (select array_agg(value::uuid) from jsonb_array_elements_text(patch->'allowedChannelIds') value)
      when patch ? 'allowedChannelIds' then null
      else allowed_channel_ids end,
    forbidden_topics = case
      when patch ? 'forbiddenTopics' and jsonb_typeof(patch->'forbiddenTopics') = 'array' then coalesce((select array_agg(value) from jsonb_array_elements_text(patch->'forbiddenTopics') value), '{}'::text[])
      when patch ? 'forbiddenTopics' then '{}'::text[]
      else forbidden_topics end,
    required_hashtags = case
      when patch ? 'requiredHashtags' and jsonb_typeof(patch->'requiredHashtags') = 'array' then coalesce((select array_agg(value) from jsonb_array_elements_text(patch->'requiredHashtags') value), '{}'::text[])
      when patch ? 'requiredHashtags' then '{}'::text[]
      else required_hashtags end,
    tone = case when patch ? 'tone' then patch->>'tone' else tone end,
    updated_by = auth.uid()
  where id = existing_id;

  select * into result from public.policy_settings where id = existing_id;
  return result;
end;
$$;
revoke all on function public.set_policy_rules(uuid, text, uuid, uuid, jsonb) from public;
grant execute on function public.set_policy_rules(uuid, text, uuid, uuid, jsonb) to authenticated;

-- Vertrauen je Mitglied setzen: dieselbe Verwaltungsberechtigung wie set_policy_rules fuer diesen
-- Scope. Ein NULL-Wert bei submit_allowed/review_requirement wuerde das Vertrauen unbestimmt
-- lassen -- beide sind deshalb Pflichtparameter mit sinnvollen Defaults auf Aufruferseite.
create or replace function public.set_member_review_trust(
  target_organization_id uuid, target_scope text, target_department_id uuid, target_team_id uuid,
  target_user_id uuid, target_submit_allowed boolean, target_review_requirement text,
  target_reason text, target_expires_at timestamptz
) returns public.member_review_trust
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  authorized boolean;
  existing_id uuid;
  result public.member_review_trust;
begin
  if target_review_requirement not in ('inherit', 'always', 'waived') then
    raise exception 'invalid_review_requirement';
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

  -- user_id zeigt wie bei policy_reviewers nur auf public.profiles, trägt also keinen
  -- zusammengesetzten Fremdschluessel auf den Verein. Ohne diese Pruefung liesse sich eine
  -- Vertrauenszeile fuer eine Person aus einem fremden Verein anlegen -- die diese Zeile ueber
  -- member_review_trust_select ("user_id = auth.uid()") sogar lesen koennte, samt Begruendung.
  if not authz.is_user_member_of_organization(target_user_id, target_organization_id) then
    raise exception 'user_not_a_member';
  end if;

  -- Eine Befreiung entfaellt niemals die Minderjaehrigenstufe (Plan 011, "Vertrauen je Mitglied") --
  -- das gilt bei der ROUTENAUFLOESUNG, nicht hier; diese Funktion speichert nur die Einstellung.
  select id into existing_id from public.member_review_trust
    where organization_id = target_organization_id
      and scope = target_scope::public.policy_scope
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
      and user_id = target_user_id
    for update;

  if existing_id is not null then
    update public.member_review_trust set
      submit_allowed = target_submit_allowed,
      review_requirement = target_review_requirement,
      reason = target_reason,
      expires_at = target_expires_at,
      granted_by = auth.uid()
    where id = existing_id;
  else
    insert into public.member_review_trust (
      organization_id, scope, department_id, team_id, user_id,
      submit_allowed, review_requirement, reason, expires_at, granted_by
    ) values (
      target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id, target_user_id,
      target_submit_allowed, target_review_requirement, target_reason, target_expires_at, auth.uid()
    ) returning id into existing_id;
  end if;

  select * into result from public.member_review_trust where id = existing_id;
  return result;
end;
$$;
revoke all on function public.set_member_review_trust(uuid, text, uuid, uuid, uuid, boolean, text, text, timestamptz) from public;
grant execute on function public.set_member_review_trust(uuid, text, uuid, uuid, uuid, boolean, text, text, timestamptz) to authenticated;

-- Freigabe anfordern: die Route ist bereits in TypeScript vorgeschlagen (resolveReviewRoute,
-- packages/domain) -- diese Funktion ist aber per RPC direkt erreichbar (grant execute an
-- authenticated) und darf dem Vorschlag deshalb nicht blind vertrauen. Beim Rechte- und
-- Mandantentrennung-Review gefunden: ein Aufrufer mit blossem post.submit koennte sonst
-- (a) eine fremde userId als Pruefer eintragen, (b) mit stages='[]' jede Pruefung -- inklusive
-- der unbefreibaren Minderjaehrigenstufe -- vollstaendig umgehen, und (c) sich per
-- selbstgewaehltem target_self_approval_allowed=true selbst freigeben, unabhaengig von der
-- tatsaechlichen Richtlinie. Deshalb: self_approval_allowed/allow_same_reviewer_across_stages
-- werden HIER aus policy_settings neu berechnet, nicht vom Aufrufer uebernommen; eine leere oder
-- die Minderjaehrigenstufe auslassende stages-Liste wird abgelehnt, wenn die Richtlinie das nicht
-- zulaesst; und jede reviewer_snapshot-userId wird gegen echte Vereinsmitgliedschaft geprueft.
create or replace function public.request_approval(
  target_post_version_id uuid, stages jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version record;
  post record;
  new_request_id uuid;
  stage_row jsonb;
  reviewer_elem jsonb;
  new_stage_id uuid;
  first_stage_id uuid;
  total_minimum_approvals integer := 0;
  any_minor_stage boolean := false;
  effective_self_approval_allowed boolean;
  effective_allow_same_reviewer boolean;
  any_review_required boolean;
  contains_minors boolean;
  minor_stage_present boolean;
  only_author_reviewer boolean;
begin
  select * into version from public.post_versions where id = target_post_version_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into post from public.posts where id = version.post_id and organization_id = version.organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if post.status not in ('draft_ready', 'rendering', 'changes_requested') then
    raise exception 'invalid_status';
  end if;
  if not authz.has_department_permission(post.department_id, 'post.submit') then
    raise exception 'insufficient_permission';
  end if;

  -- Dieselbe AND-Reduktion wie mergeEffectiveConfig (packages/domain), aber nur fuer die zwei
  -- Felder, die diese Funktion selbst durchsetzen muss -- null (nicht gesetzt) = neutral/true.
  select
    coalesce(bool_and(coalesce(self_approval_allowed, true)), true),
    coalesce(bool_and(coalesce(allow_same_reviewer_across_stages, true)), true),
    coalesce(bool_or(coalesce(review_required, false)), false)
  into effective_self_approval_allowed, effective_allow_same_reviewer, any_review_required
  from public.policy_settings
  where organization_id = post.organization_id
    and (
      scope = 'organization'
      or (scope = 'department' and department_id = post.department_id)
      or (scope = 'team' and post.team_id is not null and team_id = post.team_id)
    );

  contains_minors := 'minor' = any(coalesce(version.safety_flags, '{}'));
  minor_stage_present := exists (select 1 from jsonb_array_elements(stages) s where (s->>'isMinorStage')::boolean);
  if contains_minors and not minor_stage_present then
    raise exception 'minor_stage_required';
  end if;
  if jsonb_array_length(stages) = 0 and (any_review_required or contains_minors) then
    raise exception 'review_required';
  end if;

  -- Verteidigung in der Tiefe: ein jsonb-Feld kann keinen Fremdschluessel tragen, deshalb hier
  -- eine explizite Mitgliedschaftspruefung -- sonst waere jede beliebige userId als Pruefer
  -- eintragbar, auch aus einem fremden Verein.
  for stage_row in select * from jsonb_array_elements(stages) loop
    for reviewer_elem in select * from jsonb_array_elements(coalesce(stage_row->'reviewerSnapshot', '[]'::jsonb)) loop
      if not authz.is_user_member_of_organization((reviewer_elem->>'userId')::uuid, post.organization_id) then
        raise exception 'invalid_reviewer_snapshot';
      end if;
    end loop;
  end loop;

  if not effective_self_approval_allowed then
    select exists (
      select 1 from jsonb_array_elements(stages) s
      where not exists (
        select 1 from jsonb_array_elements(coalesce(s->'reviewerSnapshot', '[]'::jsonb)) e
        where (e->>'userId')::uuid is distinct from version.created_by_user_id
      )
    ) into only_author_reviewer;
    if only_author_reviewer then
      raise exception 'only_author_as_reviewer';
    end if;
  end if;

  if jsonb_array_length(stages) = 0 then
    update public.posts set status = 'approved', updated_at = now() where id = post.id;
    return jsonb_build_object('postId', post.id, 'status', 'approved', 'stages', '[]'::jsonb);
  end if;

  -- Die Positionen muessen 1..n lueckenlos und eindeutig sein. decide_approval_stage sucht die
  -- Folgestufe ueber position + 1 (siehe dort) -- eine Luecke wuerde jede aeussere Stufe hinter der
  -- Luecke fuer immer auf 'pending' stehen lassen und den Beitrag stattdessen sofort auf 'approved'
  -- setzen. Mit stages der Positionen 1 und 3 waere so auch die unbefreibare Minderjaehrigenstufe
  -- umgehbar; fehlt Position 1 ganz, oeffnet keine Stufe und der Beitrag haengt dauerhaft in
  -- 'awaiting_approval' (beim Review dieses Pakets gefunden).
  if (select count(distinct (s->>'position')::integer) from jsonb_array_elements(stages) s) <> jsonb_array_length(stages)
     or (select min((s->>'position')::integer) from jsonb_array_elements(stages) s) <> 1
     or (select max((s->>'position')::integer) from jsonb_array_elements(stages) s) <> jsonb_array_length(stages) then
    raise exception 'invalid_stage_positions';
  end if;

  -- Eine Stufe ohne Pruefer ist von niemandem entscheidbar (can_decide_stage verlangt einen Treffer
  -- im Snapshot) und liesse den Beitrag lautlos fuer immer liegen -- genau das, was
  -- resolveReviewRoute (packages/domain) auf dem regulaeren Weg als Blocker verhindert.
  if exists (
    select 1 from jsonb_array_elements(stages) s
    where jsonb_array_length(coalesce(s->'reviewerSnapshot', '[]'::jsonb)) = 0
  ) then
    raise exception 'empty_reviewer_snapshot';
  end if;

  insert into public.approval_requests (
    organization_id, post_id, post_version_id, required_approvals, requires_minor_approval,
    self_approval_allowed, allow_same_reviewer_across_stages
  ) values (
    post.organization_id, post.id, version.id, 1, false,
    effective_self_approval_allowed, effective_allow_same_reviewer
  ) returning id into new_request_id;

  for stage_row in select * from jsonb_array_elements(stages) order by (value->>'position')::integer loop
    total_minimum_approvals := total_minimum_approvals + (stage_row->>'minimumApprovals')::integer;
    any_minor_stage := any_minor_stage or (stage_row->>'isMinorStage')::boolean;
    insert into public.approval_stages (
      organization_id, approval_request_id, position, scope, scope_department_id, scope_team_id,
      label, mode, minimum_approvals, is_minor_stage, reviewer_snapshot, status, deadline_hours,
      opened_at, deadline_at
    ) values (
      post.organization_id, new_request_id, (stage_row->>'position')::integer,
      (stage_row->>'scope')::public.policy_scope, (stage_row->>'scopeDepartmentId')::uuid, (stage_row->>'scopeTeamId')::uuid,
      stage_row->>'label', (stage_row->>'mode')::public.review_mode, (stage_row->>'minimumApprovals')::integer,
      (stage_row->>'isMinorStage')::boolean, coalesce(stage_row->'reviewerSnapshot', '[]'::jsonb),
      case when (stage_row->>'position')::integer = 1 then 'open' else 'pending' end,
      (stage_row->>'deadlineHours')::integer,
      case when (stage_row->>'position')::integer = 1 then now() else null end,
      case when (stage_row->>'position')::integer = 1 and stage_row->>'deadlineHours' is not null
        then now() + ((stage_row->>'deadlineHours')::integer || ' hours')::interval else null end
    ) returning id into new_stage_id;
    if (stage_row->>'position')::integer = 1 then first_stage_id := new_stage_id; end if;
  end loop;

  update public.approval_requests set required_approvals = total_minimum_approvals, requires_minor_approval = any_minor_stage where id = new_request_id;
  update public.posts set status = 'awaiting_approval', updated_at = now() where id = post.id;

  return jsonb_build_object('postId', post.id, 'approvalRequestId', new_request_id, 'status', 'awaiting_approval', 'firstStageId', first_stage_id);
end;
$$;
revoke all on function public.request_approval(uuid, jsonb) from public;
grant execute on function public.request_approval(uuid, jsonb) to authenticated;

-- Entscheiden: authz.can_decide_stage ist die primaere Durchsetzung (kein direkter Tabellen-Grant
-- auf approval_stages fuer authenticated) -- die RLS-Policy oben ist Verteidigung in der Tiefe, kein
-- zweiter Weg. Bei changes_requested/rejected werden alle FOLGENDEN Stufen skipped -- eine bereits
-- erfuellte innere Stufe bleibt stehen, sie war ja tatsaechlich erfuellt.
create or replace function public.decide_approval_stage(
  target_stage_id uuid, target_decision text, target_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stage record;
  request record;
  approvals_count integer;
  next_stage record;
begin
  if target_decision not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'invalid_decision';
  end if;
  if not authz.can_decide_stage(target_stage_id) then
    raise exception 'insufficient_permission';
  end if;

  select * into stage from public.approval_stages where id = target_stage_id for update;
  select * into request from public.approval_requests where id = stage.approval_request_id for update;

  insert into public.approval_decisions (organization_id, approval_request_id, approval_stage_id, post_version_id, decided_by, decision, reason)
    values (stage.organization_id, request.id, stage.id, request.post_version_id, auth.uid(), target_decision::public.approval_decision_type, target_reason);

  if target_decision <> 'approved' then
    update public.approval_stages set status = 'rejected', closed_at = now() where id = stage.id;
    update public.approval_stages set status = 'skipped' where approval_request_id = request.id and position > stage.position and status = 'pending';
    update public.posts set status = case when target_decision = 'changes_requested' then 'changes_requested' else 'cancelled' end, updated_at = now() where id = request.post_id;
    return jsonb_build_object('stageId', stage.id, 'stageStatus', 'rejected', 'postStatus', case when target_decision = 'changes_requested' then 'changes_requested' else 'cancelled' end);
  end if;

  select count(*) into approvals_count from public.approval_decisions where approval_stage_id = stage.id and decision = 'approved';
  if approvals_count < stage.minimum_approvals then
    return jsonb_build_object('stageId', stage.id, 'stageStatus', 'open', 'postStatus', 'awaiting_approval');
  end if;

  update public.approval_stages set status = 'satisfied', closed_at = now() where id = stage.id;

  select * into next_stage from public.approval_stages where approval_request_id = request.id and position = stage.position + 1;
  if found then
    update public.approval_stages set
      status = 'open',
      opened_at = now(),
      deadline_at = case when deadline_hours is not null then now() + (deadline_hours || ' hours')::interval else null end
    where id = next_stage.id;
    return jsonb_build_object('stageId', stage.id, 'stageStatus', 'satisfied', 'postStatus', 'awaiting_approval', 'nextStageId', next_stage.id);
  end if;

  update public.posts set status = 'approved', updated_at = now() where id = request.post_id;
  return jsonb_build_object('stageId', stage.id, 'stageStatus', 'satisfied', 'postStatus', 'approved');
end;
$$;
revoke all on function public.decide_approval_stage(uuid, text, text) from public;
grant execute on function public.decide_approval_stage(uuid, text, text) to authenticated;

-- Einplanen und Veroeffentlichen: Kontingentpruefung und Einplanung in EINER Transaktion, die den
-- Kontingent-Scope vorher per Advisory Lock sperrt (Plan 011, "Zwei Pruefungen sind aber keine
-- atomare Pruefung"). Ohne die Sperre koennten zwei gleichzeitige Einplanungen an der Grenze beide
-- durchgehen.
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

  allowed_channels := version.effective_config_snapshot->'config'->'allowedChannelIds';
  if allowed_channels is not null and jsonb_typeof(allowed_channels) = 'array' and jsonb_array_length(allowed_channels) > 0
     and not exists (select 1 from jsonb_array_elements_text(allowed_channels) value where value = target_social_connection_id::text) then
    raise exception 'channel_not_allowed';
  end if;

  -- Auf Vereinsebene gesperrt, nicht je Abteilung/Team: die Schleife unten liest auch
  -- vereinsweite Kontingentzeilen, die fuer ALLE Abteilungen gelten. Ein abteilungsfeiner Schluessel
  -- haette zwei gleichzeitige Einplanungen aus verschiedenen Abteilungen an der Grenze desselben
  -- vereinsweiten Kontingents beide durchgelassen (beim Review dieses Pakets gefunden). Der
  -- Kontingentraum ist ohnehin je Verein serialisiert.
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
revoke all on function public.schedule_publication(uuid, uuid, timestamptz) from public;
grant execute on function public.schedule_publication(uuid, uuid, timestamptz) to authenticated;

-- Ueberschrittene Stufen als stalled markieren. Kein taeglicher Job ruft diese Funktion bisher auf:
-- der Stack hat noch keinen Scheduler (Paket 004, Hatchet-Produktionsintegration, ist laut
-- plans/README.md weiterhin "in Arbeit"). Die Funktion existiert bereits jetzt, damit ein
-- Scheduler sie nur noch verdrahten muss, statt die Logik selbst neu zu schreiben. Bis dahin liest
-- die API "ueberfaellig" live aus deadline_at, ohne den Status physisch zu aendern (siehe apps/api).
-- Nur service_role darf sie aufrufen -- es gibt noch keinen legitimen authenticated-Aufrufer.
create or replace function public.mark_stalled_approval_stages()
returns integer
language sql security definer set search_path = public, pg_temp as $$
  with updated as (
    update public.approval_stages
    set status = 'stalled'
    where status = 'open' and deadline_at is not null and deadline_at < now()
    returning id
  )
  select count(*)::integer from updated;
$$;
revoke all on function public.mark_stalled_approval_stages() from public;
grant execute on function public.mark_stalled_approval_stages() to service_role;

commit;
