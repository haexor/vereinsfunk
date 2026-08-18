begin;

-- Plan 045, PR 0 Schritt 2: "wurde dieses Foto ueberhaupt schon auf abgebildete Personen
-- gesichtet" ist bislang gar nicht modelliert -- mediaGate.ts:42/130 liest stattdessen die
-- hartcodierte Konstante true (facesConfirmedComplete), und der SQL-Gate in
-- schedule_publication() prueft ausschliesslich, ob eine face_regions-Zeile mit decision='pending'
-- existiert. Bei null Zeilen (weil niemand je eine Box markiert) ist diese Pruefung leer, also
-- kein Blocker -- ein Foto mit einer nicht gesichteten Person waere damit strukturell
-- veroeffentlichbar, sobald post_media/media_derivatives ueberhaupt erstmals befuellt werden
-- (Plan 045 PR 0 Schritt 4).
alter table public.media_assets
  add column people_reviewed_at timestamptz,
  add column people_reviewed_by uuid references public.profiles(id);

-- people_reviewed_at/people_reviewed_by sind keine normalen Browser-editierbaren Metadaten (die
-- 2026081801-Migration hat den pauschalen UPDATE-Grant auf media_assets bereits entzogen) -- der
-- Browser kann das Pruefsignal ausschliesslich ueber diese SECURITY DEFINER-Funktion setzen.
-- auth.uid() wird vor dem Update auf einen nicht-null Aufrufer geprueft und ist die alleinige
-- Quelle fuer people_reviewed_by; ein frei uebergebener Akteur existiert nicht.
create or replace function public.confirm_media_people_review(
  target_asset_id uuid, faces_present boolean
) returns public.media_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  asset public.media_assets;
  region_count integer;
  pending_count integer;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into asset from public.media_assets where id = target_asset_id for update;
  if not found then raise exception 'not_found'; end if;
  if not authz.has_department_permission(asset.department_id, 'post.edit') then
    raise exception 'insufficient_permission';
  end if;
  select count(*), count(*) filter (where decision = 'pending')
    into region_count, pending_count
    from public.face_regions where media_asset_id = target_asset_id;
  -- "keine Personen" widerspricht real markierten Gesichtern; "Personen vorhanden" verlangt
  -- mindestens eine Zeile UND dass keine davon noch unentschieden ist -- sonst waere dies der
  -- Rubberstamp, den mediaGate.ts:42/130 heute schon ist (facesConfirmedComplete hartcodiert true).
  if not faces_present and region_count > 0 then raise exception 'faces_present_mismatch'; end if;
  if faces_present and (region_count = 0 or pending_count > 0) then raise exception 'faces_incomplete'; end if;
  update public.media_assets set people_reviewed_at = now(), people_reviewed_by = auth.uid()
    where id = target_asset_id returning * into asset;
  return asset;
end; $$;
revoke all on function public.confirm_media_people_review(uuid, boolean) from public;
grant execute on function public.confirm_media_people_review(uuid, boolean) to authenticated;

-- Weder eine nachtraeglich markierte Person noch ein anderer Dateiinhalt darf eine fruehere
-- Sichtung weiterverwenden. face_regions_write-RLS (202608030001) bleibt fuer die Markier-UI
-- erhalten; sie bekommt hierueber keine Schreibrechte auf das Pruefsignal selbst.
create or replace function public.invalidate_people_review_on_face_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.media_assets set people_reviewed_at = null, people_reviewed_by = null
    where id = coalesce(new.media_asset_id, old.media_asset_id);
  return coalesce(new, old);
end; $$;
create trigger face_regions_invalidate_people_review
  after insert or update or delete on public.face_regions
  for each row execute function public.invalidate_people_review_on_face_change();

create or replace function public.invalidate_people_review_on_content_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.people_reviewed_at := null;
  new.people_reviewed_by := null;
  return new;
end; $$;
create trigger media_assets_invalidate_people_review
  before update of object_path, sha256, mime_type, byte_size, width, height, duration_ms, upload_status
  on public.media_assets
  for each row execute function public.invalidate_people_review_on_content_change();

-- schedule_publication (zuletzt 2026081302): unveraendert bis auf einen neuen fuenften
-- media_blockers-Zweig nach demselben Muster wie die vier bestehenden, direkt nach scan_pending.
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
    join public.media_assets ma on ma.organization_id = md.organization_id and ma.id = md.media_asset_id
    where pm.organization_id = post.organization_id and pm.post_version_id = target_post_version_id
      and ma.people_reviewed_at is null
  ) then
    media_blockers := array_append(media_blockers, 'people_review_pending');
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
