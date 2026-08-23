-- Paket A PR 6: logo_asset_id (seit 2026082204) ist seit PR #138/#139 die einzige Logo-Referenz
-- der Vereinsebene, analog Abteilung/Mannschaft. logo_path/logo_dark_path werden von keinem Code
-- mehr gelesen oder geschrieben; die referenzierten brand_assets-Zeilen selbst bleiben unberuehrt.
alter table public.organization_brand_profiles drop column logo_path;
alter table public.organization_brand_profiles drop column logo_dark_path;
