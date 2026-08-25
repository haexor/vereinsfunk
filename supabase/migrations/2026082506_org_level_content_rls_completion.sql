begin;

-- Nachtrag zu 2026082504/2026082505, Regel: was auf Abteilungsebene geht, muss auch auf
-- Vereinsebene gehen -- nie umgekehrt. Der RLS-/RPC-Sweep von 2026082504 hat vier Stellen des
-- Beitrags- und Medienpfads ausgelassen, die ihre Berechtigung ausschliesslich an der Abteilung
-- festmachen. authz.is_department_member(null) und authz.has_department_permission(null, ...) sind
-- beide false, jede dieser Stellen faellt fuer eine Zeile ohne Abteilung also auf "niemand".
-- Jeder Zweig unten hat exakt dieselbe Berechtigungsstufe wie der Abteilungszweig daneben.

-- 1. composition_session_post_media: die Anhaenge einer Textwerkstatt-Sitzung. _select sah auf
--    Vereinsebene nur noch die verfassende Person (created_by), nicht mehr jede weitere Person mit
--    post.edit -- anders als composition_session_media_select, das denselben Zweig in 2026082504
--    schon bekommen hat. In _write kommt zum fehlenden Zweig ein zweites Problem: der Abgleich
--    "Asset und Sitzung liegen in derselben Abteilung" war ein blosses `=` und damit fuer zwei
--    NULLs weder wahr noch falsch, sondern NULL -- also gesperrt. `is not distinct from` sagt
--    genau das, was gemeint ist: gleiche Abteilung ODER beide ohne.
alter policy composition_session_post_media_select on public.composition_session_post_media using (
  exists (select 1 from public.composition_sessions session where session.id = composition_session_id and session.organization_id = composition_session_post_media.organization_id and (
    session.created_by = auth.uid()
    or authz.has_department_permission(session.department_id, 'post.edit')
    or (session.department_id is null and authz.has_organization_permission(session.organization_id, 'post.edit'))
    or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
  ))
);

alter policy composition_session_post_media_write on public.composition_session_post_media using (
  exists (
    select 1 from public.composition_sessions session
    join public.media_assets asset on asset.organization_id = session.organization_id and asset.id = composition_session_post_media.media_asset_id
    where session.id = composition_session_post_media.composition_session_id
      and session.organization_id = composition_session_post_media.organization_id
      and asset.department_id is not distinct from session.department_id
      and (
        authz.has_department_permission(session.department_id, 'post.edit')
        or (session.department_id is null and authz.has_organization_permission(session.organization_id, 'post.edit'))
        or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
      )
  )
) with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.composition_sessions session
    join public.media_assets asset on asset.organization_id = session.organization_id and asset.id = composition_session_post_media.media_asset_id
    where session.id = composition_session_post_media.composition_session_id
      and session.organization_id = composition_session_post_media.organization_id
      and asset.department_id is not distinct from session.department_id
      and (
        authz.has_department_permission(session.department_id, 'post.edit')
        or (session.department_id is null and authz.has_organization_permission(session.organization_id, 'post.edit'))
        or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
      )
  )
);

-- 2. post_status_events: die Statushistorie eines Beitrags. department_id ist seit 2026082504
--    nullable (der Trigger uebernimmt sie aus posts), die Policy blieb rein abteilungsgebunden --
--    die Historie eines Vereinsbeitrags war damit fuer niemanden lesbar.
alter policy post_status_events_select on public.post_status_events using (
  authz.has_department_permission(department_id, 'analytics.view')
  or (department_id is null and authz.has_organization_permission(organization_id, 'analytics.view'))
);

-- 3. post_generation_provenance: Herkunft einer generierten Version. Derselbe Zweig wie
--    posts_select/post_versions_select in 2026082504 -- ohne ihn sieht bei einem Vereinsbeitrag vor
--    der Veroeffentlichung niemand die Provenienz, auch die verfassende Person nicht.
alter policy post_generation_provenance_select on public.post_generation_provenance using (
  exists (
    select 1 from public.post_versions version
    join public.posts post on post.id = version.post_id and post.organization_id = version.organization_id
    where version.id = post_generation_provenance.post_version_id
      and version.organization_id = post_generation_provenance.organization_id
      and (
        (post.status in ('published', 'scheduled') and authz.is_any_member_of_organization(post.organization_id))
        or authz.is_department_member(post.department_id)
        or (post.department_id is null and authz.is_any_member_of_organization(post.organization_id))
        or (post.team_id is not null and authz.has_team_membership(post.team_id))
      )
  )
);

-- 4. reresolve_approval_route: unveraendert gegenueber 2026081601 bis auf den Berechtigungszweig.
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
  author_is_minor boolean;
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
  -- Org-Zweig wie in request_approval/schedule_publication (2026082504): posts.department_id darf
  -- null sein, und authz.has_department_permission(null, ...) ist false -- ohne diesen Zweig waere
  -- die Neuaufloesung als einzige Stufe des Freigabewegs auf Vereinsebene fuer NIEMANDEN erreichbar.
  if not (
    authz.has_department_permission(post.department_id, 'department.manage')
    or (post.department_id is null and authz.has_organization_permission(post.organization_id, 'department.manage'))
  ) then
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
  author_is_minor := authz.is_profile_minor(post.organization_id, version.created_by_user_id);

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
    post.organization_id, version.created_by_user_id, contains_minors, author_is_minor, any_review_required,
    effective_self_approval_allowed, new_stages
  );

  -- Ab hier werden mehrere Positionen derselben Anfrage verschoben -- Eindeutigkeitspruefung bis
  -- zum Ende dieser Transaktion (Funktionsaufruf) verschieben, siehe Kommentar oben der Funktion.
  set constraints public.approval_stages_approval_request_id_position_key deferred;

  -- Jede neue Stufe gegen eine noch bestehende Stufe DESSELBEN Schluessels (scope,
  -- scope_department_id, scope_team_id, is_minor_stage) zuordnen -- "position" ist dafuer bewusst
  -- NICHT der Schluessel (Plan, "Fachliches Modell": "Die Zuordnung alt zu neu laeuft nicht ueber
  -- position"). Seit dieser Migration koennen zwei is_minor_stage=true-Kandidaten GLEICHZEITIG
  -- existieren (Medien-Minderjaehrigenschutz UND Minderjaehrige-Verfasser:in-Stufe, beide
  -- scope='organization', scope_department_id/scope_team_id null) -- ohne weiteres Merkmal waere der
  -- Schluessel fuer beide identisch. label unterscheidet sie zuverlaessig: fuer beide Minderjaehrigen-
  -- stufen ist es ein fest verdrahtetes Literal (nicht wie bei regulaeren Stufen aus
  -- policy_settings.review_stage_label konfigurierbar), fuer regulaere Stufen aendert die
  -- Zusatzbedingung (not s.is_minor_stage or ...) nichts am bisherigen Verhalten.
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
        and (not s.is_minor_stage or s.label = stage->>'label')
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
      and (not s.is_minor_stage or s.label = stage->>'label')
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
        and (not s.is_minor_stage or (ns->>'label') = s.label)
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

commit;
