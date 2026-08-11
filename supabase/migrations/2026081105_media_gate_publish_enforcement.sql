begin;

-- Paket 002: evaluateMediaGate/assertApprovalSnapshot (packages/domain) existieren seit
-- 202608030001, wurden aber nie als echter Blocker verdrahtet -- GET /v1/approval-stages/mine
-- zeigt computeMediaGateBlockersForPostVersion() nur informativ an (apps/api/src/routes/policies.ts).
-- schedule_publication() ist laut eigenem Kommentar (2026080701, "Kanalstatus durchsetzen") die
-- tatsaechliche Durchsetzungsgrenze fuer Freigabe-/Kanalregeln: die Funktion ist per Grant direkt
-- erreichbar (jeder authentifizierte Nutzer koennte sie ueber PostgREST am Fastify-Server vorbei
-- aufrufen), ein TS-Vorabcheck ersetzt das nicht. Dasselbe Muster gilt fuer den Medien-Gate.
--
-- Bewusst konservativer Kern: nur objektiv eindeutige Verletzungen blockieren hart --
-- scan_pending, face_pending, consent_invalid (widerrufen/abgeloest/ausserhalb Gueltigkeit/
-- Minderjaehrige ohne Guardian) und derivative_stale. Bewusst NICHT hart blockiert:
-- - minor_review_required: minorReviewConfirmed ist in computeMediaGateBlockersForPostVersion
--   dauerhaft hartkodiert false (apps/api/src/routes/policies.ts) -- der eigentliche
--   Minderjaehrigenschutz laeuft ueber die is_minor_stage-Freigabestufe (Paket 011/024). Ein harter
--   Block waere fuer jeden Beitrag mit einer minderjaehrigen Person dauerhaft unerfuellbar.
-- - consent_scope_mismatch, naming_not_allowed, sensitive_text_data: haengen an evaluateConsent()
--   und scanTextForSensitiveData() (packages/domain/src/consent.ts), rund 150 Zeilen
--   Unicode-Regex- und Scope-Abgleichslogik. Diese hier in plpgsql zu duplizieren wuerde dieselbe
--   Rechtslogik dauerhaft in zwei Sprachen synchron halten muessen -- dokumentierte Restluecke,
--   bleibt informativ ueber GET /v1/approval-stages/mine und die TS-Tiefenverteidigung in
--   POST /v1/publications/:id/execute (HARD_PUBLISH_BLOCKERS, apps/api/src/routes/policies.ts).
--
-- Ein Beitrag ohne jedes Medium (Text-only-Pilot, Plan 033) hat keine post_media-Zeilen -- jeder
-- exists()-Check unten ist dann leer, das Gate blockiert nichts.
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

  -- face_regions erzwingt per CHECK, dass decision='consented' immer einen consent_record_id
  -- traegt (202608030001) -- cr.id is null ist defensiv, sollte in der Praxis nie eintreten.
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

commit;
