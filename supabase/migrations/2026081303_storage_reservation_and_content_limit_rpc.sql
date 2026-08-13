begin;

-- Plan 021, PR 2 Review-Fix: die urspruengliche Planung (plans/021-abomodelle-und-
-- speicherkontingent.md, "Durchsetzung beim Upload") verlangt bereits "Pruefung und Reservierung
-- laufen in einer Transaktion mit pg_advisory_xact_lock auf den Verein, wie die
-- Kontingentpruefung in Paket 011. Ohne Sperre lassen zwei parallele Uploads beide die Grenze
-- passieren." Die erste API-Umsetzung dieser PR hatte das als vier unabhaengige TS-seitige
-- Lesungen plus einen ungesperrten insert nachgebaut -- exakt die Race, vor der der Plantext warnt
-- (beim eigenen Review gefunden). Diese Funktion ist jetzt die alleinige Durchsetzungsgrenze,
-- nach demselben Muster wie schedule_publication(): eine security-definer-Funktion mit
-- pg_advisory_xact_lock, die prueft UND reserviert, in derselben Transaktion.
create or replace function public.reserve_storage_upload(
  target_organization uuid, target_department uuid, target_asset_id uuid,
  target_bucket_id text, target_object_path text, target_mime_type text,
  announced_bytes bigint, target_created_by uuid
) returns public.media_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  effective record;
  department_limit_bytes bigint;
  organization_used bigint;
  department_used bigint;
  result public.media_assets;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_organization::text, 2));

  -- Ohne jede organization_subscriptions-Zeile gilt weiterhin "keine Grenze aus diesem Paket"
  -- (siehe Migration 2026081302, Kommentar zu organization_subscriptions) -- dieselbe Ausnahme wie
  -- in enforce_structure_limit()/schedule_publication().
  if exists (select 1 from public.organization_subscriptions where organization_id = target_organization) then
    select storage_bytes into effective from public.effective_limits(target_organization);

    select storage_bytes into department_limit_bytes from public.storage_limits
     where organization_id = target_organization and scope = 'department' and department_id = target_department and team_id is null;

    -- Mannschaft vor Abteilung vor Verein, dieselbe Reihenfolge wie im Plandokument -- hier ohne
    -- Mannschaftsebene, weil media_assets keine team_id-Spalte hat (siehe Migration 2026081302,
    -- Kommentar zu storage_usage_bytes()).
    if department_limit_bytes is not null then
      department_used := public.storage_usage_bytes(target_organization, target_department, null);
      if department_used + announced_bytes > department_limit_bytes then
        raise exception 'storage_limit_reached: department/%/%', department_limit_bytes, department_used;
      end if;
    end if;

    organization_used := public.storage_usage_bytes(target_organization, null, null);
    if organization_used + announced_bytes > effective.storage_bytes then
      raise exception 'storage_limit_reached: organization/%/%', effective.storage_bytes, organization_used;
    end if;
  end if;

  -- Reservierung als echte media_assets-Zeile, damit storage_usage_bytes() sie ab jetzt
  -- mitzaehlt. Ist-Groessen-Abgleich bei /complete und Verfall unvollstaendiger Reservierungen
  -- bleiben offen, bis Paket 001/002 eine echte Upload-Pipeline liefert (siehe Plan 021, Kontext).
  insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, upload_status, created_by)
  values (target_asset_id, target_organization, target_department, target_bucket_id, target_object_path, target_mime_type, announced_bytes, 'initiated', target_created_by)
  returning * into result;

  return result;
end;
$$;
revoke all on function public.reserve_storage_upload(uuid, uuid, uuid, text, text, text, bigint, uuid) from public;
grant execute on function public.reserve_storage_upload(uuid, uuid, uuid, text, text, text, bigint, uuid) to service_role;

-- Ersetzt ein delete()+insert() ueber zwei getrennte PostgREST-Aufrufe (nicht atomar -- ein
-- fehlschlagender insert nach erfolgreichem delete liess einen Tarif ohne jedes Kontingent
-- zurueck, was fuer jede Organisation auf diesem Tarif jede Einplanung blockiert haette; beim
-- eigenen Review gefunden). target_limits ist ein jsonb-Array aus {"mediaOrigin","maxPerMonth",
-- "maxDurationSeconds"}-Objekten, exakt die vom Contract validierte Form.
create or replace function public.set_subscription_plan_content_limits(target_plan_key text, target_limits jsonb)
returns setof public.subscription_plan_content_limits
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.subscription_plan_content_limits where plan_key = target_plan_key;
  insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month, max_duration_seconds)
  select target_plan_key, entry->>'mediaOrigin', (entry->>'maxPerMonth')::integer, (entry->>'maxDurationSeconds')::integer
    from jsonb_array_elements(target_limits) entry;
  return query select * from public.subscription_plan_content_limits where plan_key = target_plan_key;
end;
$$;
revoke all on function public.set_subscription_plan_content_limits(text, jsonb) from public;
grant execute on function public.set_subscription_plan_content_limits(text, jsonb) to service_role;

-- Ersetzt drei separate PostgREST-Selects auf rohe byte_size-Zeilen, in JS aufsummiert und ohne
-- Paginierung -- ab 1000 Zeilen (supabase/config.toml max_rows) waere die Aufschluesselung still
-- zu niedrig gewesen, und der Mannschafts-Fall lieferte faelschlich vereinsweite Summen fuer
-- own_uploads/rendered_media zurueck, weil die beiden Helferfunktionen target_team gar nicht
-- kannten (beide beim eigenen Review gefunden). Spiegelt dieselben drei Teilsummen wie
-- storage_usage_bytes() oben, nur einzeln statt addiert.
create or replace function public.storage_usage_breakdown(
  target_organization uuid, target_department uuid default null, target_team uuid default null
) returns table (own_uploads bigint, rendered_media bigint, brand_assets bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce((
      select sum(asset.byte_size) from public.media_assets asset
       where asset.organization_id = target_organization
         and target_team is null
         and (target_department is null or asset.department_id = target_department)
         and asset.upload_status <> 'deleted'
    ), 0),
    coalesce((
      select sum(derivative.byte_size)
        from public.media_derivatives derivative
        join public.media_assets asset
          on asset.organization_id = derivative.organization_id and asset.id = derivative.media_asset_id
       where derivative.organization_id = target_organization
         and target_team is null
         and (target_department is null or asset.department_id = target_department)
         and asset.upload_status <> 'deleted'
    ), 0),
    coalesce((
      select sum(brand.byte_size) from public.brand_assets brand
       where brand.organization_id = target_organization
         and (target_department is null or brand.department_id = target_department)
         and (target_team is null or brand.team_id = target_team)
    ), 0);
$$;
revoke all on function public.storage_usage_breakdown(uuid, uuid, uuid) from public;
grant execute on function public.storage_usage_breakdown(uuid, uuid, uuid) to service_role;

commit;
