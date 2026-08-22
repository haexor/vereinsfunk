begin;

-- Vereinsebene bekommt denselben echten logo_asset_id-Zeiger wie Abteilung/Mannschaft schon heute
-- (department_brand_profiles.logo_asset_id/team_brand_profiles.logo_asset_id, Migration
-- 2026080702). Bisher trug nur logo_path/logo_dark_path (Paket 009) einen denormalisierten
-- Objekt-Pfad; das Feld selbst stand schon vorbereitet in locked_fields' CHECK
-- (organization_brand_profiles_locked_fields_check erlaubt 'logoAssetId' seit 2026080702) und in
-- packages/domain/src/brand.ts (ORGANIZATION_FIELDS/BRAND_LOCKABLE_FIELDS), nur die Spalte fehlte.
alter table public.organization_brand_profiles
  add column logo_asset_id uuid;

alter table public.organization_brand_profiles
  add constraint organization_brand_profiles_logo_asset_fk
    foreign key (organization_id, logo_asset_id) references public.brand_assets(organization_id, id);

-- Backfill: logo_path zeigt schon heute denormalisiert auf genau die brand_assets-Zeile, die
-- logo_asset_id nun direkt referenziert (kind='logo_primary', vereinsweit, aktuell 'ready'). Der
-- Upload-Pfad (POST .../brand/logo) setzt die Vorgaengerzeile vor jedem Insert auf 'replaced',
-- deshalb liefert "order by created_at desc limit 1" defensiv die neueste, falls doch einmal mehr
-- als eine 'ready'-Zeile vorliegen sollte.
update public.organization_brand_profiles profile
set logo_asset_id = (
  select asset.id from public.brand_assets asset
  where asset.organization_id = profile.organization_id
    and asset.department_id is null and asset.team_id is null
    and asset.kind = 'logo_primary' and asset.status = 'ready'
  order by asset.created_at desc
  limit 1
)
where profile.logo_path is not null;

-- brand_profiles_update kannte bisher nur die Schrift-Referenzen (2026080702) -- ohne diese
-- Erweiterung koennte jemand mit organization.manage per direktem PostgREST-Zugriff ein
-- logo_asset_id einer fremden Abteilung/Organisation eintragen, genau die Luecke, die
-- authz.brand_asset_is_selectable fuer Schrift-Referenzen bereits schliesst.
drop policy brand_profiles_update on public.organization_brand_profiles;
create policy brand_profiles_update on public.organization_brand_profiles for update to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'))
  with check (
    authz.has_organization_permission(organization_id, 'organization.manage')
    and (logo_asset_id is null or authz.brand_asset_is_selectable(logo_asset_id, organization_id, null, null))
    and (display_font_asset_id is null or authz.brand_asset_is_selectable(display_font_asset_id, organization_id, null, null))
    and (body_font_asset_id is null or authz.brand_asset_is_selectable(body_font_asset_id, organization_id, null, null))
  );

commit;
