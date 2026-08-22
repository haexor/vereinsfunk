begin;

-- CodeRabbit-Review PR #138: DELETE /v1/brand/assets/:id setzte status='deleted', ohne zu pruefen,
-- ob organization_/department_/team_brand_profiles (logo_asset_id/display_font_asset_id/
-- body_font_asset_id) oder image_style_presets (frame_brand_asset_id/logo_brand_asset_id) das
-- Asset noch referenzieren. authz.brand_asset_is_selectable() verlangt status='ready' -- ein
-- unveraendertes PUT .../brand auf ein Profil mit toter Referenz waere danach an der CHECK-
-- Bedingung der Profiltabelle gescheitert, ohne dass die Nutzerin die Ursache haette erkennen
-- koennen. Pruefung und Status-Aenderung muessen deshalb dieselbe Transaktion teilen (Muster wie
-- reserve_storage_upload() in 2026081303: security-definer-Funktion mit
-- pg_advisory_xact_lock statt getrennter TS-seitiger Pruefung vor einem ungesperrten Update).
create or replace function public.delete_brand_asset_if_unused(target_asset_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  deleted_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_asset_id::text, 3));

  if exists (
    select 1 from public.organization_brand_profiles
     where logo_asset_id = target_asset_id or display_font_asset_id = target_asset_id or body_font_asset_id = target_asset_id
    union all
    select 1 from public.department_brand_profiles
     where logo_asset_id = target_asset_id or display_font_asset_id = target_asset_id or body_font_asset_id = target_asset_id
    union all
    select 1 from public.team_brand_profiles
     where logo_asset_id = target_asset_id or display_font_asset_id = target_asset_id or body_font_asset_id = target_asset_id
    union all
    select 1 from public.image_style_presets
     where frame_brand_asset_id = target_asset_id or logo_brand_asset_id = target_asset_id
  ) then
    raise exception 'brand_asset_referenced';
  end if;

  -- status <> 'deleted' statt = 'ready': ein Font-Upload vor confirm-license (status='processing')
  -- oder ein abgelehntes/abgeloestes Asset (rejected/replaced) muss ebenfalls entfernbar bleiben --
  -- nur ein bereits gelöschtes Asset liefert einen sauberen "nicht gefunden" fuer den zweiten
  -- Loeschversuch.
  update public.brand_assets set status = 'deleted'
   where id = target_asset_id and status <> 'deleted'
   returning id into deleted_id;

  return deleted_id;
end;
$$;
revoke all on function public.delete_brand_asset_if_unused(uuid) from public;
grant execute on function public.delete_brand_asset_if_unused(uuid) to service_role;

commit;
