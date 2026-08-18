begin;

-- Plan 045, PR 0 Schritt 4: welches Foto an eine Textwerkstatt-Sitzung angehaengt ist. Bewusst
-- media_asset_id, nicht media_derivative_id -- welches Derivat am Ende tatsaechlich verwendet wird
-- (Pass-Through hier, ein gestyltes Rendering ab Plan 045 PR 2) wird erst beim Annehmen aufgeloest,
-- die Anhang-Identitaet selbst bleibt stabil. role/position sind fuer den jetzt bewusst einzelnen
-- Anhang hart auf 'primary'/0 fixiert (kein Karussell, siehe plans/045 "Nicht enthalten").
create table public.composition_session_post_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  composition_session_id uuid not null,
  media_asset_id uuid not null,
  role text not null default 'primary' check (role = 'primary'),
  position integer not null default 0 check (position = 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Hoechstens ein Anhang je Sitzung -- zusammen mit den obigen CHECKs ist ein vorhandener Eintrag
  -- damit immer genau 'primary' auf Position 0.
  unique (composition_session_id),
  foreign key (organization_id, composition_session_id) references public.composition_sessions(organization_id, id) on delete cascade,
  foreign key (organization_id, media_asset_id) references public.media_assets(organization_id, id) on delete restrict
);

alter table public.composition_session_post_media enable row level security;
alter table public.composition_session_post_media force row level security;

-- Dieselbe Sichtbarkeit wie composition_session_media_select (2026081003).
create policy composition_session_post_media_select on public.composition_session_post_media for select to authenticated using (
  exists (select 1 from public.composition_sessions session where session.id = composition_session_id and session.organization_id = composition_session_post_media.organization_id and (
    session.created_by = auth.uid()
    or authz.has_department_permission(session.department_id, 'post.edit')
    or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
  ))
);
-- Schreiben verlangt zusaetzlich post.edit auf die Sitzung UND dass das referenzierte Asset
-- derselben Organisation und Abteilung wie die Sitzung angehoert -- die zusammengesetzten FKs oben
-- verhindern nur Cross-Tenant-Referenzen (andere Organisation), nicht Cross-Department innerhalb
-- derselben Organisation.
create policy composition_session_post_media_write on public.composition_session_post_media for all to authenticated using (
  exists (
    select 1 from public.composition_sessions session
    join public.media_assets asset on asset.organization_id = session.organization_id and asset.id = composition_session_post_media.media_asset_id
    where session.id = composition_session_post_media.composition_session_id
      and session.organization_id = composition_session_post_media.organization_id
      and asset.department_id = session.department_id
      and (
        authz.has_department_permission(session.department_id, 'post.edit')
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
      and asset.department_id = session.department_id
      and (
        authz.has_department_permission(session.department_id, 'post.edit')
        or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
      )
  )
);

grant select, insert, update, delete on public.composition_session_post_media to authenticated;
grant all privileges on public.composition_session_post_media to service_role;

-- accept_text_generation_candidate bekommt einen dritten Parameter mit Default -- CREATE OR REPLACE
-- allein wuerde die bestehende Zweiargument-Funktion NICHT ersetzen, sondern eine zweite,
-- ueberladene Variante daneben anlegen (Postgres identifiziert eine Funktion ueber Name UND
-- Parameterliste), siehe dieselbe Lehre bei count_publications_in_period (2026081302). Deshalb
-- zuerst die alte Signatur explizit droppen.
drop function if exists public.accept_text_generation_candidate(uuid, uuid);

-- p_media_derivative_id kommt aus apps/api/src/routes/content.ts (POST /v1/text-workshop/
-- candidates/:id/accept): die Route loest den Anhang der Sitzung ueber
-- composition_session_post_media zu einem 'ready'-Pass-Through-Derivat auf (ensurePassThroughDerivative,
-- Sharp/Storage-Zugriff, den eine reine SQL-Funktion nicht leisten kann) und uebergibt dessen ID
-- hierher. Nur service_role kann diese Funktion ueberhaupt aufrufen -- die Validierung unten ist
-- Tiefenverteidigung, keine Vertrauensgrenze zum Endnutzer.
create or replace function public.accept_text_generation_candidate(
  p_candidate_id uuid, p_actor_user_id uuid, p_media_derivative_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  candidate public.generation_candidates%rowtype;
  session_row public.composition_sessions%rowtype;
  post_row public.posts%rowtype;
  version_id uuid;
  -- Nicht "version_number": 2026081702 hat genau diesen Namenskonflikt mit der Spalte
  -- post_versions.version_number bereits behoben ("column reference is ambiguous" bei
  -- plpgsql.variable_conflict=error, dem Postgres-Standard). Beim Reproduzieren dieser Funktion
  -- fuer diese Migration zunaechst versehentlich von der AELTEREN Fassung (2026081105) statt der
  -- neuesten (2026081702) ausgegangen -- durch den eigenen pgTAP-Testlauf dieses Pakets gefunden.
  next_version_number integer;
begin
  select * into candidate from public.generation_candidates where id = p_candidate_id for update;
  if not found then raise exception 'generation_candidate_not_found'; end if;
  select * into session_row from public.composition_sessions where id = candidate.composition_session_id and organization_id = candidate.organization_id for update;
  if not found then raise exception 'composition_session_not_found'; end if;
  if not exists (
    select 1 from public.organization_memberships membership
      where membership.organization_id = candidate.organization_id and membership.user_id = p_actor_user_id and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.department_memberships membership
      where membership.department_id = session_row.department_id and membership.user_id = p_actor_user_id and (membership.expires_at is null or membership.expires_at > now())
    union all
    select 1 from public.team_memberships membership
      where membership.team_id = session_row.team_id and membership.user_id = p_actor_user_id and (membership.expires_at is null or membership.expires_at > now())
  ) then raise exception 'generation_candidate_forbidden'; end if;
  if candidate.status = 'accepted' then return jsonb_build_object('postVersionId', candidate.accepted_post_version_id, 'alreadyAccepted', true); end if;
  if candidate.status <> 'ready' or candidate.generated_content is null then raise exception 'generation_candidate_not_ready'; end if;
  if candidate.provider_configuration_id is null or candidate.provider_model_id is null or candidate.provider_parameter_hash is null or candidate.prompt_template_version is null then raise exception 'generation_candidate_missing_provenance'; end if;
  if p_media_derivative_id is not null and not exists (
    select 1 from public.media_derivatives where id = p_media_derivative_id and organization_id = candidate.organization_id and status = 'ready'
  ) then
    raise exception 'invalid_media_derivative';
  end if;

  if session_row.post_id is null then
    insert into public.posts (organization_id, department_id, team_id, status, created_by)
    values (session_row.organization_id, session_row.department_id, session_row.team_id, 'draft_ready', p_actor_user_id)
    returning * into post_row;
    update public.composition_sessions set post_id = post_row.id, updated_at = now() where id = session_row.id;
  else
    select * into post_row from public.posts where id = session_row.post_id and organization_id = session_row.organization_id for update;
    update public.approval_requests set invalidated_at = now(), updated_at = now()
      where post_id = post_row.id and organization_id = post_row.organization_id and invalidated_at is null;
  end if;
  select coalesce(max(version_number), 0) + 1 into next_version_number from public.post_versions where post_id = post_row.id;
  insert into public.post_versions (
    organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot,
    title, caption, call_to_action, hashtags, alt_text, safety_flags, created_by_type, created_by_user_id
  ) values (
    session_row.organization_id, post_row.id, next_version_number, session_row.source_material, session_row.effective_config_snapshot,
    coalesce(candidate.generated_content->>'headline', ''), coalesce(candidate.generated_content->>'caption', ''),
    coalesce(candidate.generated_content->>'callToAction', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(candidate.generated_content->'hashtags', '[]'::jsonb))), '{}'),
    coalesce(candidate.generated_content->>'altText', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(candidate.generated_content->'safetyFlags', '[]'::jsonb))), '{}'),
    'llm', p_actor_user_id
  ) returning id into version_id;
  update public.posts set current_version_id = version_id, status = 'draft_ready', updated_at = now() where id = post_row.id;
  -- ON CONFLICT DO NOTHING statt eines gewoehnlichen insert: der accepted-Kurzschluss oben greift
  -- nur bei einem WIEDERHOLTEN Aufruf desselben Kandidaten, schuetzt hier also nicht direkt --
  -- er sorgt aber dafuer, dass version_id bei einem Retry NIE neu entsteht, wodurch dieser insert
  -- bei einem echten Retry gar nicht erst erreicht wird. Der Conflict-Schutz selbst ist
  -- Tiefenverteidigung fuer den unwahrscheinlichen Fall, dass irgendein anderer Pfad bereits eine
  -- post_media-Zeile auf Position 0 dieser Version angelegt hat.
  if p_media_derivative_id is not null then
    insert into public.post_media (organization_id, post_version_id, media_derivative_id, position, role)
    values (session_row.organization_id, version_id, p_media_derivative_id, 0, 'primary')
    on conflict (post_version_id, position) do nothing;
  end if;
  insert into public.post_generation_provenance (
    organization_id, post_version_id, composition_session_id, generation_candidate_id, style_profile_snapshot,
    prompt_template_version, provider_model_id, provider_configuration_id, provider_parameter_hash, input_hash
  ) values (
    session_row.organization_id, version_id, session_row.id, candidate.id, session_row.style_profile_snapshot,
    candidate.prompt_template_version, candidate.provider_model_id, candidate.provider_configuration_id,
    candidate.provider_parameter_hash, session_row.input_hash
  );
  update public.generation_candidates set status = 'accepted', accepted_post_version_id = version_id, updated_at = now() where id = candidate.id;
  update public.composition_sessions set status = 'accepted', updated_at = now() where id = session_row.id;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (session_row.organization_id, p_actor_user_id, 'text_generation.candidate_accepted', 'post_version', version_id, gen_random_uuid(), jsonb_build_object('candidateId', candidate.id, 'sessionId', session_row.id));
  return jsonb_build_object('postId', post_row.id, 'postVersionId', version_id, 'alreadyAccepted', false);
end;
$$;

revoke all on function public.accept_text_generation_candidate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_text_generation_candidate(uuid, uuid, uuid) to service_role;

commit;
