begin;

-- Bildstil-Nachbesserung: logo_brand_asset_id war ueber die generierte Spalte
-- logo_brand_asset_kind hart auf kind='watermark' gepinnt. Das Hauptlogo (hell/dunkel) landet
-- beim Hochladen ueber POST /v1/organizations/:id/brand/logo aber mit kind='logo_primary'/
-- 'logo_dark' in brand_assets (Plan 013) -- genau dieselben Zeilen, die department_brand_profiles/
-- team_brand_profiles.logo_asset_id schon laenger referenzieren duerfen (2026080702), nur hier
-- bisher nicht. Der Fremdschluessel wird auf dasselbe einfache Muster umgestellt; welche kind-Werte
-- als "Logo" gelten, entscheidet ab jetzt allein die Anwendung (LOGO_ASSET_KINDS in
-- apps/api/src/routes/brand.ts), nicht mehr das Schema. frame_brand_asset_id/-_kind bleiben
-- unangetastet -- nur der Logo-Fall wird geoeffnet.
alter table public.image_style_presets
  drop constraint image_style_presets_organization_id_logo_brand_asset_id_lo_fkey;

alter table public.image_style_presets drop column logo_brand_asset_kind;

alter table public.image_style_presets
  add constraint image_style_presets_logo_brand_asset_id_fkey
  foreign key (organization_id, logo_brand_asset_id) references public.brand_assets(organization_id, id);

commit;
