begin;

-- POST /v1/brand/assets/:id/confirm-license setzte jede andere 'ready'-Schrift derselben Familie,
-- Staerke und Lage auf 'replaced' -- auch wenn ein Markenprofil sie noch als display_/
-- body_font_asset_id auswaehlte. authz.brand_asset_is_selectable() verlangt status='ready', das
-- naechste unveraenderte PUT .../brand dieses Profils scheiterte danach. Ausserdem pruefte die
-- Route den Status des Ziel-Assets nicht: eine geloeschte oder abgeloeste Schrift kam per
-- Lizenzbestaetigung wieder auf 'ready'. Pruefung, Abloesung und Freigabe laufen deshalb hier in
-- einer Transaktion (Muster wie delete_brand_asset_if_unused, 2026082206).
create or replace function public.confirm_brand_font_license(
  p_organization_id uuid,
  p_asset_id uuid,
  p_license_holder text,
  p_license_note text,
  p_actor_user_id uuid
)
returns public.brand_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target public.brand_assets;
begin
  -- Ein Lock je Verein reiht zwei gleichzeitige Bestaetigungen derselben Schrift hintereinander:
  -- ohne ihn saehe keine der beiden die andere als 'ready', und beide blieben stehen.
  perform pg_advisory_xact_lock(hashtextextended('brand_font_license:' || p_organization_id::text, 0));

  select * into target from public.brand_assets
   where id = p_asset_id and organization_id = p_organization_id
   for update;
  if not found then raise exception 'brand_asset_not_found'; end if;
  if target.kind <> 'font' then raise exception 'not_a_font_asset'; end if;
  if target.status <> 'processing' then raise exception 'brand_asset_not_pending_license'; end if;

  -- Abgeloest wird nur eine Schrift, die kein Markenprofil mehr auswaehlt -- eine referenzierte
  -- bleibt 'ready', bis sie dort abgewaehlt ist.
  update public.brand_assets previous set status = 'replaced'
   where previous.organization_id = target.organization_id
     and previous.id <> target.id
     and previous.kind = 'font'
     and previous.status = 'ready'
     and previous.font_family = target.font_family
     and previous.font_weight = target.font_weight
     and previous.font_style = target.font_style
     and previous.department_id is not distinct from target.department_id
     and previous.team_id is not distinct from target.team_id
     and not exists (
       select 1 from public.organization_brand_profiles profile
        where profile.display_font_asset_id = previous.id or profile.body_font_asset_id = previous.id
       union all
       select 1 from public.department_brand_profiles profile
        where profile.display_font_asset_id = previous.id or profile.body_font_asset_id = previous.id
       union all
       select 1 from public.team_brand_profiles profile
        where profile.display_font_asset_id = previous.id or profile.body_font_asset_id = previous.id
     );

  update public.brand_assets
     set license_holder = p_license_holder,
         license_note = p_license_note,
         license_confirmed_at = now(),
         license_confirmed_by = p_actor_user_id,
         status = 'ready'
   where id = target.id
   returning * into target;

  return target;
end;
$$;
revoke all on function public.confirm_brand_font_license(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_brand_font_license(uuid, uuid, text, text, uuid) to service_role;

commit;
