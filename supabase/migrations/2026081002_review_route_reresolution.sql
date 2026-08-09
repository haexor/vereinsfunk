begin;

-- Paket 024: Freigaberoute bewusst neu aufloesen. Siehe plans/024-freigaberoute-neu-aufloesen.md.
--
-- Entschiedene Fragen (Abschnitt "Entschiedene Fragen" im Plan, 2026-08-09):
-- 1. Variante A: authz.resolve_review_route baut buildStageDefinitions()+resolveReviewRoute()
--    (packages/domain, apps/api/src/app.ts) in SQL nach. request_approval und die neue
--    reresolve_approval_route bleiben fuer authenticated per Grant erreichbar und leiten die Route
--    SELBST ab -- RLS/Server-Definer-Logik bleibt zweite Verteidigungslinie wie bei jeder anderen
--    privilegierten Funktion in diesem Projekt, kein struktureller Bruch mit dem Muster.
-- 2. request_approval wird in diesem Paket mitgehaertet: die Funktion nimmt keinen "stages"-Client-
--    Parameter mehr entgegen, sondern ruft authz.resolve_review_route() selbst auf. Schliesst die
--    seit Paket 011 offene Luecke, dass ein Einreichender per direktem RPC-Aufruf einen selbst
--    gewaehlten Pruefer -- auch fuer die Minderjaehrigenstufe -- htte eintragen koennen, obwohl
--    review_mode = 'named' etwas anderes verlangt.
-- 3. Eine 'rejected'-Stufe bleibt nicht neu aufloesbar (Ablehnung ist eine inhaltliche Aussage ueber
--    die Version, der reguläre Weg ist eine neue Post-Version).

-- 1. authz.resolve_review_route: baut die Freigaberoute EINES post_version JETZT, aus aktueller
--    Richtlinie, aktuellem Vertrauen und aktuellen Mitgliedschaften -- nie aus einem Client-Wert.
--    Rueckgabereihenfolge ist innen (Team) nach aussen (Verein), Minderjaehrigenstufe unmittelbar
--    vor einer etwaigen Vereinsstufe einsortiert (mirrort resolveReviewRoute, packages/domain).
--
--    Nur fuer den definierenden Eigentuemer/service_role nutzbar (siehe Grants unten) -- anders als
--    authz.resolve_policy_flag (das eine RLS-Policy direkt aufruft und deshalb an authenticated
--    gehen muss) wird diese Funktion ausschliesslich aus ANDEREN security-definer-Funktionen heraus
--    aufgerufen (request_approval, reresolve_approval_route). Ein direkter Aufruf durch
--    authenticated wuerde Pruefer-Identitaeten fuer eine BELIEBIGE post_version_id offenlegen, ohne
--    dass die aufrufende Person je Zugriff auf diesen Beitrag haben muesste.
--
--    ORG_ROLES_WITH_APPROVE/DEPARTMENT_ROLES_WITH_APPROVE/TEAM_ROLES_WITH_APPROVE unten sind
--    dieselbe Rollenliste wie in apps/api/src/app.ts (membersWithApprovePermission) -- gefiltert auf
--    Rollen, die laut authz.has_organization_permission/has_department_permission/
--    has_team_permission 'post.approve' halten. TEAM_ROLES_WITH_APPROVE ist damit leer (keine
--    Teamrolle traegt post.approve direkt), deshalb keine eigene Teamrollen-Abfrage unten -- sollte
--    sich das Rollenmodell aendern, muss diese Liste hier UND dort mitgezogen werden (derselbe
--    Abgleichsbedarf, den die drei TS-Konstanten bereits gegen has_*_permission haben).
create or replace function authz.resolve_review_route(target_post_version_id uuid)
returns table (
  sort_order integer,
  scope public.policy_scope,
  scope_department_id uuid,
  scope_team_id uuid,
  label text,
  mode public.review_mode,
  minimum_approvals integer,
  is_minor_stage boolean,
  reviewer_user_ids uuid[],
  deadline_hours integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  org_row public.policy_settings;
  dept_row public.policy_settings;
  team_row public.policy_settings;
  allow_review_exemptions boolean;
  contains_minors boolean;
  org_trust_req text;
  dept_trust_req text;
  team_trust_req text;
  not_expired constant text := '(expires_at is null or expires_at > now())';
begin
  select version.id as version_id, version.created_by_user_id, version.safety_flags,
         post.id as post_id, post.organization_id, post.department_id, post.team_id
    into v
  from public.post_versions version
  join public.posts post on post.id = version.post_id and post.organization_id = version.organization_id
  where version.id = target_post_version_id;
  if not found then
    raise exception 'not_found';
  end if;

  contains_minors := 'minor' = any(coalesce(v.safety_flags, '{}'::text[]));

  -- "scope" ist unqualifiziert mehrdeutig: RETURNS TABLE(..., scope, ...) legt eine gleichnamige
  -- PL/pgSQL-Variable an, die die Spalte policy_settings.scope/member_review_trust.scope sonst
  -- verdeckt -- deshalb ab hier immer tabellenqualifiziert.
  select * into org_row from public.policy_settings
    where organization_id = v.organization_id and policy_settings.scope = 'organization';
  select * into dept_row from public.policy_settings
    where organization_id = v.organization_id and policy_settings.scope = 'department' and department_id = v.department_id;
  if v.team_id is not null then
    select * into team_row from public.policy_settings
      where organization_id = v.organization_id and policy_settings.scope = 'team' and team_id = v.team_id;
  end if;

  allow_review_exemptions := coalesce(org_row.allow_review_exemptions, true);

  -- Vertrauenseinstellungen des AUTORS (nicht des Aufrufers) je Ebene -- abgelaufene Befreiungen
  -- zaehlen nicht mehr (dieselbe Ablauflogik wie bei Mitgliedschaften), hoechstens eine Zeile je
  -- Ebene durch member_review_trust_unique.
  select review_requirement into org_trust_req from public.member_review_trust
    where organization_id = v.organization_id and user_id = v.created_by_user_id and member_review_trust.scope = 'organization'
      and (expires_at is null or expires_at > now());
  select review_requirement into dept_trust_req from public.member_review_trust
    where organization_id = v.organization_id and user_id = v.created_by_user_id and member_review_trust.scope = 'department'
      and department_id = v.department_id and (expires_at is null or expires_at > now());
  if v.team_id is not null then
    select review_requirement into team_trust_req from public.member_review_trust
      where organization_id = v.organization_id and user_id = v.created_by_user_id and member_review_trust.scope = 'team'
        and team_id = v.team_id and (expires_at is null or expires_at > now());
  end if;
  org_trust_req := coalesce(org_trust_req, 'inherit');
  dept_trust_req := coalesce(dept_trust_req, 'inherit');
  team_trust_req := coalesce(team_trust_req, 'inherit');

  return query
  with reviewers as (
    -- 'named': policy_reviewers je aufgeloester Zeile. kind='user' wird UNGEPRUEFT uebernommen
    -- (auch wenn die Person inzwischen ausgetreten ist) -- exakt wie resolveReviewers()
    -- (packages/domain): die nachgelagerte authz.assert_valid_stage_list prueft Mitgliedschaft und
    -- lehnt sonst mit invalid_reviewer_snapshot ab, statt hier still eine leere Stufe zu erzeugen.
    select org_row.id as policy_settings_id, array_agg(distinct uid) filter (where uid is not null) as user_ids
    from (
      select reviewer.user_id as uid from public.policy_reviewers reviewer
        where reviewer.policy_settings_id = org_row.id and reviewer.kind = 'user'
      union all
      select membership.user_id from public.policy_reviewers reviewer
        join public.organization_memberships membership
          on membership.organization_id = v.organization_id and membership.role = reviewer.role::public.organization_role
          and (membership.expires_at is null or membership.expires_at > now())
        where reviewer.policy_settings_id = org_row.id and reviewer.kind = 'organization_role'
    ) reviewer_ids
    where org_row.id is not null
    union all
    select dept_row.id, array_agg(distinct uid) filter (where uid is not null)
    from (
      select reviewer.user_id from public.policy_reviewers reviewer
        where reviewer.policy_settings_id = dept_row.id and reviewer.kind = 'user'
      union all
      select membership.user_id from public.policy_reviewers reviewer
        join public.organization_memberships membership
          on membership.organization_id = v.organization_id and membership.role = reviewer.role::public.organization_role
          and (membership.expires_at is null or membership.expires_at > now())
        where reviewer.policy_settings_id = dept_row.id and reviewer.kind = 'organization_role'
      union all
      select membership.user_id from public.policy_reviewers reviewer
        join public.department_memberships membership
          on membership.department_id = reviewer.target_department_id and membership.role = reviewer.role::public.department_role
          and (membership.expires_at is null or membership.expires_at > now())
        where reviewer.policy_settings_id = dept_row.id and reviewer.kind = 'department_role'
    ) uid(uid)
    where dept_row.id is not null
    union all
    select team_row.id, array_agg(distinct uid) filter (where uid is not null)
    from (
      select reviewer.user_id from public.policy_reviewers reviewer
        where reviewer.policy_settings_id = team_row.id and reviewer.kind = 'user'
      union all
      select membership.user_id from public.policy_reviewers reviewer
        join public.organization_memberships membership
          on membership.organization_id = v.organization_id and membership.role = reviewer.role::public.organization_role
          and (membership.expires_at is null or membership.expires_at > now())
        where reviewer.policy_settings_id = team_row.id and reviewer.kind = 'organization_role'
      union all
      select membership.user_id from public.policy_reviewers reviewer
        join public.department_memberships membership
          on membership.department_id = reviewer.target_department_id and membership.role = reviewer.role::public.department_role
          and (membership.expires_at is null or membership.expires_at > now())
        where reviewer.policy_settings_id = team_row.id and reviewer.kind = 'department_role'
      union all
      select membership.user_id from public.policy_reviewers reviewer
        join public.team_memberships membership
          on membership.team_id = reviewer.target_team_id and membership.role = reviewer.role::public.team_role
          and (membership.expires_at is null or membership.expires_at > now())
        where reviewer.policy_settings_id = team_row.id and reviewer.kind = 'team_role'
    ) uid(uid)
    where team_row.id is not null
  ),
  approvers as (
    -- 'any_with_permission': jede Person, die JETZT post.approve im Scope oder einer aeusseren Ebene
    -- haelt -- ORG_ROLES_WITH_APPROVE/DEPARTMENT_ROLES_WITH_APPROVE oben, kaskadierend wie
    -- has_team_permission -> has_department_permission -> has_organization_permission.
    select array_agg(distinct user_id) as user_ids from (
      select user_id from public.organization_memberships
        where organization_id = v.organization_id
          and role in ('organization_owner', 'organization_admin', 'social_manager')
          and (expires_at is null or expires_at > now())
      union all
      select user_id from public.department_memberships
        where department_id = v.department_id
          and role in ('department_admin', 'approver')
          and (expires_at is null or expires_at > now())
    ) org_and_dept
  ),
  org_approvers as (
    select array_agg(distinct user_id) as user_ids from public.organization_memberships
      where organization_id = v.organization_id
        and role in ('organization_owner', 'organization_admin', 'social_manager')
        and (expires_at is null or expires_at > now())
  ),
  candidates as (
    select
      0 as sort_order, 'team'::public.policy_scope as scope, v.department_id as scope_department_id, v.team_id as scope_team_id,
      coalesce(team_row.review_stage_label, 'Team') as label,
      coalesce(team_row.review_mode, 'any_with_permission')::public.review_mode as mode,
      coalesce(team_row.review_minimum_approvals, 1) as minimum_approvals,
      false as is_minor_stage,
      coalesce(
        case when team_row.review_mode = 'named'
          then (select user_ids from reviewers where policy_settings_id = team_row.id)
          else (select user_ids from approvers)
        end, '{}'::uuid[]
      ) as reviewer_user_ids,
      team_row.review_deadline_hours as deadline_hours
    where v.team_id is not null and team_row.review_required is true
      and (
        team_trust_req = 'always'
        or not (allow_review_exemptions and (team_trust_req = 'waived' or dept_trust_req = 'waived' or org_trust_req = 'waived'))
      )
    union all
    select
      10, 'department', v.department_id, null,
      coalesce(dept_row.review_stage_label, 'Abteilung'),
      coalesce(dept_row.review_mode, 'any_with_permission')::public.review_mode,
      coalesce(dept_row.review_minimum_approvals, 1),
      false,
      coalesce(
        case when dept_row.review_mode = 'named'
          then (select user_ids from reviewers where policy_settings_id = dept_row.id)
          else (select user_ids from approvers)
        end, '{}'::uuid[]
      ),
      dept_row.review_deadline_hours
    where dept_row.review_required is true
      and (
        dept_trust_req = 'always'
        or not (allow_review_exemptions and (dept_trust_req = 'waived' or org_trust_req = 'waived'))
      )
    union all
    select
      15, 'organization', null, null,
      'Minderjährigenschutz', 'any_with_permission'::public.review_mode, 1, true,
      coalesce((select user_ids from org_approvers), '{}'::uuid[]),
      null
    where contains_minors
    union all
    select
      20, 'organization', null, null,
      coalesce(org_row.review_stage_label, 'Verein'),
      coalesce(org_row.review_mode, 'any_with_permission')::public.review_mode,
      coalesce(org_row.review_minimum_approvals, 1),
      false,
      coalesce(
        case when org_row.review_mode = 'named'
          then (select user_ids from reviewers where policy_settings_id = org_row.id)
          else (select user_ids from org_approvers)
        end, '{}'::uuid[]
      ),
      org_row.review_deadline_hours
    where org_row.review_required is true
      and (org_trust_req = 'always' or not (allow_review_exemptions and org_trust_req = 'waived'))
  )
  select c.sort_order, c.scope, c.scope_department_id, c.scope_team_id, c.label, c.mode,
         c.minimum_approvals, c.is_minor_stage, c.reviewer_user_ids, c.deadline_hours
  from candidates c
  order by c.sort_order;
end;
$$;
revoke all on function authz.resolve_review_route(uuid) from public;

-- 2. authz.assert_valid_stage_list: der Validierungsblock aus request_approval, herausgeloest, damit
--    reresolve_approval_route (Abschnitt 4) dieselbe Pruefung benutzt statt einer zweiten, aehnlichen
--    Fassung (Plan, "Kein Duplikat"). Wirft dieselben Fehlernamen wie zuvor request_approval selbst.
--    "stages" traegt dieselbe Form wie bisher an request_approval uebergeben:
--    [{position, scope, scopeDepartmentId, scopeTeamId, label, mode, minimumApprovals, isMinorStage,
--      reviewerSnapshot: [{userId}], deadlineHours}, ...] -- unveraendert, damit der Einfuegeblock in
--    request_approval/reresolve_approval_route unangetastet bleibt.
create or replace function authz.assert_valid_stage_list(
  target_organization_id uuid,
  target_author_user_id uuid,
  contains_minors boolean,
  any_review_required boolean,
  effective_self_approval_allowed boolean,
  stages jsonb
) returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  stage_row jsonb;
  reviewer_elem jsonb;
  minor_stage_present boolean;
  only_author_reviewer boolean;
begin
  minor_stage_present := exists (select 1 from jsonb_array_elements(stages) s where (s->>'isMinorStage')::boolean);
  if contains_minors and not minor_stage_present then
    raise exception 'minor_stage_required';
  end if;
  if jsonb_array_length(stages) = 0 and (any_review_required or contains_minors) then
    raise exception 'review_required';
  end if;
  if jsonb_array_length(stages) = 0 then
    return;
  end if;

  -- Verteidigung in der Tiefe: ein jsonb-Feld kann keinen Fremdschluessel tragen, deshalb hier eine
  -- explizite Mitgliedschaftspruefung -- sonst waere jede beliebige userId als Pruefer eintragbar,
  -- auch aus einem fremden Verein (oder, seit authz.resolve_review_route kind='user' ungeprueft
  -- uebernimmt, eine bereits ausgetretene Person).
  for stage_row in select * from jsonb_array_elements(stages) loop
    for reviewer_elem in select * from jsonb_array_elements(coalesce(stage_row->'reviewerSnapshot', '[]'::jsonb)) loop
      if not authz.is_user_member_of_organization((reviewer_elem->>'userId')::uuid, target_organization_id) then
        raise exception 'invalid_reviewer_snapshot';
      end if;
    end loop;
  end loop;

  if not effective_self_approval_allowed then
    select exists (
      select 1 from jsonb_array_elements(stages) s
      where not exists (
        select 1 from jsonb_array_elements(coalesce(s->'reviewerSnapshot', '[]'::jsonb)) e
        where (e->>'userId')::uuid is distinct from target_author_user_id
      )
    ) into only_author_reviewer;
    if only_author_reviewer then
      raise exception 'only_author_as_reviewer';
    end if;
  end if;

  if (select count(distinct (s->>'position')::integer) from jsonb_array_elements(stages) s) <> jsonb_array_length(stages)
     or (select min((s->>'position')::integer) from jsonb_array_elements(stages) s) <> 1
     or (select max((s->>'position')::integer) from jsonb_array_elements(stages) s) <> jsonb_array_length(stages) then
    raise exception 'invalid_stage_positions';
  end if;

  if exists (
    select 1 from jsonb_array_elements(stages) s
    where jsonb_array_length(coalesce(s->'reviewerSnapshot', '[]'::jsonb)) = 0
  ) then
    raise exception 'empty_reviewer_snapshot';
  end if;
end;
$$;
revoke all on function authz.assert_valid_stage_list(uuid, uuid, boolean, boolean, boolean, jsonb) from public;

-- 3. request_approval haertet sich selbst: kein "stages"-Parameter mehr, die Route kommt
--    ausschliesslich aus authz.resolve_review_route(). Die alte Zwei-Parameter-Signatur wird
--    entfernt (nicht nur "or replace"), damit kein Aufrufer -- auch kein direkter RPC-Aufruf --
--    weiterhin einen eigenen Pruefkreis einschleusen kann.
drop function if exists public.request_approval(uuid, jsonb);

create or replace function public.request_approval(
  target_post_version_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  version record;
  post record;
  new_request_id uuid;
  stage jsonb;
  stages jsonb := '[]'::jsonb;
  route_row record;
  position_counter integer := 0;
  new_stage_id uuid;
  first_stage_id uuid;
  total_minimum_approvals integer := 0;
  any_minor_stage boolean := false;
  effective_self_approval_allowed boolean;
  effective_allow_same_reviewer boolean;
  any_review_required boolean;
  contains_minors boolean;
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

  for route_row in select * from authz.resolve_review_route(target_post_version_id) loop
    position_counter := position_counter + 1;
    stage := jsonb_build_object(
      'position', position_counter, 'scope', route_row.scope,
      'scopeDepartmentId', route_row.scope_department_id, 'scopeTeamId', route_row.scope_team_id,
      'label', route_row.label, 'mode', route_row.mode, 'minimumApprovals', route_row.minimum_approvals,
      'isMinorStage', route_row.is_minor_stage,
      'reviewerSnapshot', (select coalesce(jsonb_agg(jsonb_build_object('userId', uid)), '[]'::jsonb) from unnest(route_row.reviewer_user_ids) uid),
      'deadlineHours', route_row.deadline_hours
    );
    stages := stages || jsonb_build_array(stage);
  end loop;

  perform authz.assert_valid_stage_list(
    post.organization_id, version.created_by_user_id, contains_minors, any_review_required,
    effective_self_approval_allowed, stages
  );

  if jsonb_array_length(stages) = 0 then
    update public.posts set status = 'approved', updated_at = now() where id = post.id;
    return jsonb_build_object('postId', post.id, 'status', 'approved', 'stages', '[]'::jsonb);
  end if;

  insert into public.approval_requests (
    organization_id, post_id, post_version_id, required_approvals, requires_minor_approval,
    self_approval_allowed, allow_same_reviewer_across_stages
  ) values (
    post.organization_id, post.id, version.id, 1, false,
    effective_self_approval_allowed, effective_allow_same_reviewer
  ) returning id into new_request_id;

  for stage in select * from jsonb_array_elements(stages) order by (value->>'position')::integer loop
    total_minimum_approvals := total_minimum_approvals + (stage->>'minimumApprovals')::integer;
    any_minor_stage := any_minor_stage or (stage->>'isMinorStage')::boolean;
    insert into public.approval_stages (
      organization_id, approval_request_id, position, scope, scope_department_id, scope_team_id,
      label, mode, minimum_approvals, is_minor_stage, reviewer_snapshot, status, deadline_hours,
      opened_at, deadline_at
    ) values (
      post.organization_id, new_request_id, (stage->>'position')::integer,
      (stage->>'scope')::public.policy_scope, (stage->>'scopeDepartmentId')::uuid, (stage->>'scopeTeamId')::uuid,
      stage->>'label', (stage->>'mode')::public.review_mode, (stage->>'minimumApprovals')::integer,
      (stage->>'isMinorStage')::boolean, coalesce(stage->'reviewerSnapshot', '[]'::jsonb),
      case when (stage->>'position')::integer = 1 then 'open' else 'pending' end,
      (stage->>'deadlineHours')::integer,
      case when (stage->>'position')::integer = 1 then now() else null end,
      case when (stage->>'position')::integer = 1 and stage->>'deadlineHours' is not null
        then now() + ((stage->>'deadlineHours')::integer || ' hours')::interval else null end
    ) returning id into new_stage_id;
    if (stage->>'position')::integer = 1 then first_stage_id := new_stage_id; end if;
  end loop;

  update public.approval_requests set required_approvals = total_minimum_approvals, requires_minor_approval = any_minor_stage where id = new_request_id;
  update public.posts set status = 'awaiting_approval', updated_at = now() where id = post.id;

  return jsonb_build_object('postId', post.id, 'approvalRequestId', new_request_id, 'status', 'awaiting_approval', 'firstStageId', first_stage_id);
end;
$$;
revoke all on function public.request_approval(uuid) from public;
grant execute on function public.request_approval(uuid) to authenticated;

-- 4. approval_route_changes: Verlauf einer Neuaufloesung, fuer den Autor lesbar (der bestehende
--    audit_events-Trail verlangt organization.manage und erreicht ihn nicht, siehe "Ausgangslage").
create table public.approval_route_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_request_id uuid not null,
  changed_by uuid not null references public.profiles(id),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  -- Bewusst OHNE Pruefer-IDs: nur Position, Label, Ebene und die ANZAHL der Pruefer je Stufe (siehe
  -- Plan, "Datenmodell" -- ein voller Snapshot-Verlauf wuerde die opened_at-basierte
  -- Sichtbarkeitsregel fuer den Autor umgehen).
  stages_before jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, approval_request_id)
    references public.approval_requests(organization_id, id) on delete restrict
);
alter table public.approval_route_changes enable row level security;
alter table public.approval_route_changes force row level security;

-- Dieselben Personen wie approval_requests_select (siehe Plan, "Datenmodell"): Vereinsmitglieder mit
-- Organisationsrolle, zugewiesene Pruefer der Anfrage, der Autor der Version -- UND wer die
-- betroffene Abteilung verwaltet (department.manage): sonst koennte die Person, die eine
-- Neuaufloesung durchgefuehrt hat, den eigenen Eintrag danach nicht einmal lesen (siehe Erweiterung
-- von approval_requests_select/approval_stages_select oben, derselbe Grund).
create policy approval_route_changes_select on public.approval_route_changes for select to authenticated
  using (
    authz.is_organization_member(organization_id)
    or exists (
      select 1 from public.approval_requests request
      where request.id = approval_route_changes.approval_request_id
        and request.organization_id = approval_route_changes.organization_id
        and authz.is_assigned_reviewer(request.post_version_id)
    )
    or exists (
      select 1 from public.approval_requests request
      join public.post_versions version
        on version.id = request.post_version_id and version.organization_id = request.organization_id
      where request.id = approval_route_changes.approval_request_id
        and request.organization_id = approval_route_changes.organization_id
        and version.created_by_user_id = auth.uid()
    )
    or exists (
      select 1 from public.approval_requests request
      join public.posts post on post.id = request.post_id and post.organization_id = request.organization_id
      where request.id = approval_route_changes.approval_request_id
        and request.organization_id = approval_route_changes.organization_id
        and authz.has_department_permission(post.department_id, 'department.manage')
    )
  );
-- Kein Insert/Update/Delete-Grant fuer authenticated -- ausschliesslich ueber reresolve_approval_route.
revoke all on public.approval_route_changes from authenticated;
grant select on public.approval_route_changes to authenticated;

-- approval_stages.position ist bisher NICHT DEFERRABLE (unique (approval_request_id, position),
-- ohne Zusatz). Eine Neuaufloesung muss mehrere Positionen einer Anfrage gleichzeitig verschieben
-- ("Stufe A wird Position 1, was vorher Position 1 war wird Position 2") -- ohne DEFERRABLE wuerde
-- schon die erste Einzel-UPDATE-Anweisung mit einem noch belegten Zielwert kollidieren, obwohl der
-- Endzustand gueltig ist. ALTER TABLE ... ALTER CONSTRAINT unterstuetzt das fuer UNIQUE-Constraints
-- nicht (nur fuer Fremdschluessel) -- deshalb drop+neu anlegen. INITIALLY IMMEDIATE aendert das
-- Verhalten fuer jeden bestehenden Aufrufer nicht; nur reresolve_approval_route unten nutzt
-- "set constraints ... deferred" explizit.
alter table public.approval_stages drop constraint approval_stages_approval_request_id_position_key;
alter table public.approval_stages add constraint approval_stages_approval_request_id_position_key
  unique (approval_request_id, position) deferrable initially immediate;

-- 5. reresolve_approval_route: der eigentliche Ausweg aus einer festhaengenden Freigabe. Kein
--    "stages"-Parameter (siehe Plan, Abschnitt 2 "Umsetzung" -- der wichtigste Satz des Plans): die
--    Route wird ausschliesslich selbst abgeleitet, sonst waere assert_valid_stage_list die einzige
--    Verteidigung gegen einen frei waehlbaren Pruferkreis und "review_mode = 'named'" waere ueber
--    einen direkten RPC-Aufruf aushebelbar.
--
--    Implementierungsentscheidung, vom Plan nicht bis ins Detail vorgegeben: JEDE nicht-abgeschlossene
--    Stufe (auch eine mit bereits erweitertem reviewer_snapshot) wird zunaechst auf 'pending'
--    zurueckgesetzt (opened_at/deadline_at geleert); Schritt 9 danach oeffnet genau die niedrigste
--    davon neu. Das haelt "genau eine Stufe oeffnen" (Plan, Schritt 9) woertlich ein, statt den
--    bisherigen 'open'/'stalled'-Status einer erweiterten Stufe unangetastet zu lassen, was bei
--    einer vorgezogenen neuen Stufe zwei gleichzeitig offene Stufen erzeugen wuerde. Bereits
--    abgegebene approval_decisions bleiben davon unberuehrt und zaehlen bei der naechsten Entscheidung
--    auf dieser Stufe weiter mit.
create or replace function public.reresolve_approval_route(
  target_approval_request_id uuid, reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  request record;
  version record;
  post record;
  route_row record;
  new_stage jsonb;
  new_stages jsonb := '[]'::jsonb;
  stages_before jsonb := '[]'::jsonb;
  effective_self_approval_allowed boolean;
  any_review_required boolean;
  contains_minors boolean;
  first_open_stage_id uuid;
  matched_stage_id uuid;
  matched_status text;
  has_decisions boolean;
  stage jsonb;
  loop_index integer := 0;
begin
  select * into request from public.approval_requests where id = target_approval_request_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into version from public.post_versions where id = request.post_version_id for update;
  select * into post from public.posts where id = request.post_id and organization_id = request.organization_id for update;
  if not found then raise exception 'not_found'; end if;
  if post.status <> 'awaiting_approval' then
    raise exception 'invalid_status';
  end if;
  if not authz.has_department_permission(post.department_id, 'department.manage') then
    raise exception 'insufficient_permission';
  end if;
  if version.created_by_user_id = auth.uid() then
    raise exception 'author_cannot_reresolve';
  end if;
  if char_length(btrim(reason)) < 10 then
    raise exception 'reason_required';
  end if;

  -- invalidated_at wird NICHT als Abbruchgrund geprueft -- eine invalidierte Freigabe darf gerade
  -- DESHALB neu aufgeloest werden (Plan, "Ergebnis": "invalidated_at bekommt damit erstmals eine
  -- Wirkung im Lesepfad"); sie wird unten explizit auf null zurueckgesetzt.

  -- Eine rejected-Stufe schliesst die Neuaufloesung ganz aus (Plan, "Entschiedene Fragen" Punkt 3):
  -- eine Ablehnung ist eine inhaltliche Aussage ueber die Version, der reguläre Weg ist eine neue
  -- Post-Version, nicht dieselbe Version mit anderen Pruefern erneut vorzulegen.
  if exists (select 1 from public.approval_stages where approval_request_id = request.id and status = 'rejected') then
    raise exception 'route_has_rejected_stage';
  end if;

  select
    coalesce(bool_and(coalesce(self_approval_allowed, true)), true),
    coalesce(bool_or(coalesce(review_required, false)), false)
  into effective_self_approval_allowed, any_review_required
  from public.policy_settings
  where organization_id = post.organization_id
    and (
      scope = 'organization'
      or (scope = 'department' and department_id = post.department_id)
      or (scope = 'team' and post.team_id is not null and team_id = post.team_id)
    );
  contains_minors := 'minor' = any(coalesce(version.safety_flags, '{}'));

  -- Redigierte Projektion des bisherigen Zustands, VOR jeder Aenderung -- ohne Pruefer-IDs (Plan,
  -- "Datenmodell").
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', s.position, 'label', s.label, 'scope', s.scope, 'status', s.status,
    'reviewerCount', jsonb_array_length(s.reviewer_snapshot)
  ) order by s.position), '[]'::jsonb) into stages_before
  from public.approval_stages s where s.approval_request_id = request.id;

  -- Neue Route ableiten und in dieselbe jsonb-Form wie request_approval bringen -- Reihenfolge aus
  -- authz.resolve_review_route (sort_order) bleibt durch den einfachen Verkettungs-Loop erhalten.
  for route_row in select * from authz.resolve_review_route(request.post_version_id) loop
    new_stage := jsonb_build_object(
      'scope', route_row.scope, 'scopeDepartmentId', route_row.scope_department_id, 'scopeTeamId', route_row.scope_team_id,
      'label', route_row.label, 'mode', route_row.mode, 'minimumApprovals', route_row.minimum_approvals,
      'isMinorStage', route_row.is_minor_stage,
      'reviewerSnapshot', (select coalesce(jsonb_agg(jsonb_build_object('userId', uid)), '[]'::jsonb) from unnest(route_row.reviewer_user_ids) uid),
      'deadlineHours', route_row.deadline_hours
    );
    new_stages := new_stages || jsonb_build_array(new_stage);
  end loop;

  -- Gueltigkeit der neuen Route pruefen -- Guertel und Hosentraeger, obwohl sie jetzt selbst
  -- berechnet ist (Plan, Schritt 6). Position hier ist nur die vorlaeufige 1..n-Nummerierung fuer
  -- die Struktur-/Luecken-Pruefung in assert_valid_stage_list, nicht die endgueltige.
  select coalesce(jsonb_agg(elem || jsonb_build_object('position', rn)), '[]'::jsonb)
    into new_stages
  from (select elem, row_number() over () as rn from jsonb_array_elements(new_stages) elem) numbered;
  perform authz.assert_valid_stage_list(
    post.organization_id, version.created_by_user_id, contains_minors, any_review_required,
    effective_self_approval_allowed, new_stages
  );

  -- Ab hier werden mehrere Positionen derselben Anfrage verschoben -- Eindeutigkeitspruefung bis
  -- zum Ende dieser Transaktion (Funktionsaufruf) verschieben, siehe Kommentar oben der Funktion.
  set constraints public.approval_stages_approval_request_id_position_key deferred;

  -- Jede neue Stufe gegen eine noch bestehende Stufe DESSELBEN Schluessels (scope,
  -- scope_department_id, scope_team_id, is_minor_stage) zuordnen -- "position" ist dafuer bewusst
  -- NICHT der Schluessel (Plan, "Fachliches Modell": "Die Zuordnung alt zu neu laeuft nicht ueber
  -- position").
  for stage in select * from jsonb_array_elements(new_stages) loop
    loop_index := loop_index + 1;

    -- Doppelte Stufen derselben Ebene sind ein Datenfehler (Plan, "Schluessel doppelt"): raten statt
    -- abzubrechen wuerde eine der beiden Stufen mit ihrer alten Position stehen lassen oder je nach
    -- Entscheidungslage stillschweigend entfernen.
    if (
      select count(*) from public.approval_stages s
      where s.approval_request_id = request.id
        and s.status in ('satisfied', 'pending', 'open', 'stalled')
        and s.scope = (stage->>'scope')::public.policy_scope
        and s.scope_department_id is not distinct from (stage->>'scopeDepartmentId')::uuid
        and s.scope_team_id is not distinct from (stage->>'scopeTeamId')::uuid
        and s.is_minor_stage = (stage->>'isMinorStage')::boolean
    ) > 1 then
      raise exception 'ambiguous_stage_mapping';
    end if;

    select id, status into matched_stage_id, matched_status
    from public.approval_stages s
    where s.approval_request_id = request.id
      and s.status in ('satisfied', 'pending', 'open', 'stalled')
      and s.scope = (stage->>'scope')::public.policy_scope
      and s.scope_department_id is not distinct from (stage->>'scopeDepartmentId')::uuid
      and s.scope_team_id is not distinct from (stage->>'scopeTeamId')::uuid
      and s.is_minor_stage = (stage->>'isMinorStage')::boolean
    limit 1;

    if found and matched_status = 'satisfied' then
      -- Bleibt unveraendert, samt approval_decisions (Plan, "Fachliches Modell") -- nur die
      -- Position wird unten in der Endnummerierung neu vergeben.
      update public.approval_stages set position = loop_index where id = matched_stage_id;
    elsif found then
      select exists (select 1 from public.approval_decisions where approval_stage_id = matched_stage_id) into has_decisions;
      if has_decisions then
        -- open/stalled MIT Entscheidungen: reviewer_snapshot wird um den neu aufgeloesten Kreis
        -- ERWEITERT, sonst nichts an der Stufe selbst geaendert (Plan, "Fachliches Modell").
        update public.approval_stages set
          reviewer_snapshot = (
            select jsonb_agg(distinct entry) from (
              select jsonb_array_elements(reviewer_snapshot) as entry from public.approval_stages where id = matched_stage_id
              union
              select jsonb_array_elements(coalesce(stage->'reviewerSnapshot', '[]'::jsonb))
            ) merged
          ),
          position = loop_index, status = 'pending', opened_at = null, deadline_at = null, updated_at = now()
        where id = matched_stage_id;
      else
        -- pending/open/stalled OHNE Entscheidungen: wird ersetzt (Plan, "Fachliches Modell").
        update public.approval_stages set
          label = stage->>'label', mode = (stage->>'mode')::public.review_mode,
          minimum_approvals = (stage->>'minimumApprovals')::integer,
          reviewer_snapshot = coalesce(stage->'reviewerSnapshot', '[]'::jsonb),
          deadline_hours = (stage->>'deadlineHours')::integer,
          position = loop_index, status = 'pending', opened_at = null, deadline_at = null, updated_at = now()
        where id = matched_stage_id;
      end if;
    else
      -- Neue Stufe, die es vorher nicht gab (Plan, "Fachliches Modell").
      insert into public.approval_stages (
        organization_id, approval_request_id, position, scope, scope_department_id, scope_team_id,
        label, mode, minimum_approvals, is_minor_stage, reviewer_snapshot, status, deadline_hours
      ) values (
        post.organization_id, request.id, loop_index,
        (stage->>'scope')::public.policy_scope, (stage->>'scopeDepartmentId')::uuid, (stage->>'scopeTeamId')::uuid,
        stage->>'label', (stage->>'mode')::public.review_mode, (stage->>'minimumApprovals')::integer,
        (stage->>'isMinorStage')::boolean, coalesce(stage->'reviewerSnapshot', '[]'::jsonb), 'pending',
        (stage->>'deadlineHours')::integer
      );
    end if;
  end loop;

  -- Uebrig gebliebene pending/open/stalled-Stufen ohne Entscheidung, deren Ebene die neue Route gar
  -- nicht mehr enthaelt (z. B. Team stellt review_required ab): es gibt nichts, womit sie "ersetzt"
  -- werden koennten -- sie entfallen ersatzlos. Stufen MIT Entscheidung bleiben immer stehen (oben
  -- bereits durch den Match abgedeckt, wenn ihre Ebene noch existiert; existiert sie nicht mehr,
  -- verhindert das rejected/skip-Muster ohnehin keinen Datenverlust, da approval_decisions nie durch
  -- diese Bereinigung geloescht wird -- sie betrifft ausschliesslich entscheidungslose Stufen).
  delete from public.approval_stages s
  where s.approval_request_id = request.id
    and s.status in ('pending', 'open', 'stalled')
    and not exists (select 1 from public.approval_decisions d where d.approval_stage_id = s.id)
    and not exists (
      select 1 from jsonb_array_elements(new_stages) ns
      where (ns->>'scope')::public.policy_scope = s.scope
        and (ns->>'scopeDepartmentId')::uuid is not distinct from s.scope_department_id
        and (ns->>'scopeTeamId')::uuid is not distinct from s.scope_team_id
        and (ns->>'isMinorStage')::boolean = s.is_minor_stage
    );

  -- Endgueltige, lueckenlose Nummerierung: erfuellte/uebersprungene/abgelehnte zuerst in ihrer
  -- bisherigen relativen Reihenfolge (ihr "position"-Wert wurde oben nie angefasst), danach der Rest
  -- in der neuen Routen-Reihenfolge (oben je per loop_index gesetzt) -- ein einziges
  -- UPDATE...FROM, keine schrittweise Verschiebung, dank des oben deferrierten Constraints sicher
  -- auch bei Zwischenkollisionen.
  with ranked as (
    select id, row_number() over (
      order by
        case status when 'satisfied' then 0 when 'skipped' then 1 when 'rejected' then 2 else 3 end,
        position
    ) as final_position
    from public.approval_stages where approval_request_id = request.id
  )
  update public.approval_stages s set position = ranked.final_position
  from ranked where ranked.id = s.id;

  -- Genau eine Stufe oeffnen: die niedrigste, die weder erfuellt noch uebersprungen noch abgelehnt
  -- ist (Plan, Schritt 9) -- nach dem Reset oben ist das immer 'pending'.
  select id into first_open_stage_id from public.approval_stages
    where approval_request_id = request.id and status = 'pending'
    order by position limit 1;
  if first_open_stage_id is not null then
    update public.approval_stages set
      status = 'open',
      opened_at = now(),
      deadline_at = case when deadline_hours is not null then now() + (deadline_hours || ' hours')::interval else null end
    where id = first_open_stage_id;
  end if;

  update public.approval_requests set
    required_approvals = (select coalesce(sum(minimum_approvals), 1) from public.approval_stages where approval_request_id = request.id),
    requires_minor_approval = (select coalesce(bool_or(is_minor_stage), false) from public.approval_stages where approval_request_id = request.id),
    invalidated_at = null,
    updated_at = now()
  where id = request.id;

  insert into public.approval_route_changes (organization_id, approval_request_id, changed_by, reason, stages_before)
  values (post.organization_id, request.id, auth.uid(), reason, stages_before);

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
  values (
    post.organization_id, auth.uid(), 'approval_route.reresolved', 'approval_request', request.id, gen_random_uuid(),
    jsonb_build_object('reason', reason, 'stagesBefore', stages_before, 'stagesAfter', new_stages)
  );

  return jsonb_build_object(
    'postId', post.id, 'approvalRequestId', request.id, 'status', 'awaiting_approval',
    'firstStageId', first_open_stage_id
  );
end;
$$;
revoke all on function public.reresolve_approval_route(uuid, text) from public;
grant execute on function public.reresolve_approval_route(uuid, text) to authenticated;

-- 6. invalidated_at wirksam machen: eine Freigabe, deren Medium sich unter ihr geaendert hat, ist ab
--    jetzt nicht mehr entscheidbar -- reresolve_approval_route (oben) ist der Weg zurueck, denn sie
--    setzt invalidated_at ausdruecklich wieder auf null.
create or replace function authz.can_decide_stage(target_stage_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.approval_stages stage
    join public.approval_requests request on request.id = stage.approval_request_id and request.organization_id = stage.organization_id
    join public.post_versions version on version.id = request.post_version_id and version.organization_id = request.organization_id
    where stage.id = target_stage_id
      and stage.status in ('open', 'stalled')
      and request.invalidated_at is null
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

-- decide_approval_stage prueft invalidated_at ZUSAETZLICH nach dem "for update" der Anfrage: der
-- Helper oben ist stable und laeuft VOR dem Sperren -- der Medien-Trigger kann dazwischen zuschlagen.
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
  if request.invalidated_at is not null then
    raise exception 'approval_invalidated';
  end if;

  insert into public.approval_decisions (organization_id, approval_request_id, approval_stage_id, post_version_id, decided_by, decision, reason)
    values (stage.organization_id, request.id, stage.id, request.post_version_id, auth.uid(), target_decision::public.approval_decision_type, target_reason);

  if target_decision <> 'approved' then
    update public.approval_stages set status = 'rejected', closed_at = now() where id = stage.id;
    update public.approval_stages set status = 'skipped' where approval_request_id = request.id and position > stage.position and status = 'pending';
    -- Vorbestehender Fund (Paket 024, beim Schreiben der pgTAP-Tests entdeckt): ein CASE mit
    -- ausschliesslich Text-Literalen loest ohne expliziten Cast auf "text" auf, nicht auf den
    -- Zielspaltentyp -- die Zuweisung an posts.status (Enum post_status) scheiterte deshalb bei
    -- JEDER Ablehnung/Aenderungsanfrage seit Paket 011 mit einem SQL-Typfehler (500), unbemerkt, weil
    -- kein bestehender Test decide_approval_stage mit "rejected"/"changes_requested" gegen echtes
    -- Postgres ausgefuehrt hat (nur TS-seitige Tests mit gemocktem Client).
    update public.posts set status = (case when target_decision = 'changes_requested' then 'changes_requested' else 'cancelled' end)::public.post_status,
      updated_at = now() where id = request.post_id;
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

-- 7. Sichtbarkeit fuer Verwaltende: die Oberflaeche dieses Pakets ("festhaengende Freigaben der
--    eigenen Ebene", Plan Abschnitt 4) braucht eine Person mit department.manage, die eine Anfrage
--    ihrer Abteilung sehen kann, OHNE selbst zugewiesener Pruefer oder der Autor zu sein -- bislang
--    deckte weder approval_requests_select noch approval_stages_select diesen Fall ab (beim
--    Schreiben der pgTAP-Tests dieses Pakets gefunden: reresolve_approval_route selbst braucht das
--    nicht, es ist SECURITY DEFINER und liest ueber for update ohne RLS -- aber der Aufrufer kann
--    die approval_request_id vorher nicht einmal per SELECT finden, um sie ueberhaupt zu nennen).
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
    or exists (
      select 1 from public.posts post
      where post.id = approval_requests.post_id and post.organization_id = approval_requests.organization_id
        and authz.has_department_permission(post.department_id, 'department.manage')
    )
  );

alter policy approval_stages_select on public.approval_stages
  using (
    authz.is_organization_member(organization_id)
    or exists (select 1 from jsonb_array_elements(reviewer_snapshot) elem where (elem->>'userId')::uuid = auth.uid())
    or exists (
      select 1 from public.approval_requests request
      join public.post_versions version on version.id = request.post_version_id and version.organization_id = request.organization_id
      where request.id = approval_stages.approval_request_id
        and version.created_by_user_id = auth.uid()
    )
    or exists (
      select 1 from public.approval_requests request
      join public.posts post on post.id = request.post_id and post.organization_id = request.organization_id
      where request.id = approval_stages.approval_request_id
        and authz.has_department_permission(post.department_id, 'department.manage')
    )
  );

commit;
