begin;

-- Ersetzt die beiden dedizierten Organisations-Logo-Endpunkte (POST/DELETE .../brand/logo): ein
-- Asset wird jetzt ueber die generische DELETE /v1/brand/assets/:id-Route entfernt. Soft-Delete
-- statt DELETE FROM, da brand_assets von nicht-kaskadierenden Fremdschluesseln aus
-- organization_/department_/team_brand_profiles sowie image_style_presets referenziert wird.
-- Exakter Constraint-Name per \d+ public.brand_assets gegen die lokale Instanz verifiziert.
alter table public.brand_assets drop constraint brand_assets_status_check;
alter table public.brand_assets add constraint brand_assets_status_check
  check (status = any (array['processing', 'ready', 'rejected', 'replaced', 'deleted'])) not valid;
alter table public.brand_assets validate constraint brand_assets_status_check;

commit;
