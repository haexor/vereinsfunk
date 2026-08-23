begin;

-- Die URL gehoert zur Marke (und nicht zu den Impressumsdaten): sie ist die dauerhaft
-- wiederverwendete Quelle fuer die Homepage-Analyse. Abteilungen bekommen dieselbe Möglichkeit.
alter table public.organization_brand_profiles
  add column website_url text check (website_url is null or (website_url ~ '^https://[^[:space:]]+$' and length(website_url) <= 2048));
alter table public.department_brand_profiles
  add column website_url text check (website_url is null or (website_url ~ '^https://[^[:space:]]+$' and length(website_url) <= 2048));

-- Bestehende Vereins-URLs waren bislang nur im Impressumsprofil hinterlegt. Eine sichere HTTPS-
-- Adresse wird einmalig übernommen; ab jetzt ist die Marken-URL unabhängig vom Impressum pflegbar.
update public.organization_brand_profiles brand
set website_url = profile.website_url
from public.organization_profiles profile
where profile.organization_id = brand.organization_id
  and brand.website_url is null
  and profile.website_url ~ '^https://[^[:space:]]+$'
  and length(profile.website_url) <= 2048;

-- Diese drei Rollen werden nicht mehr als Vereinsfarben gepflegt. Einheitliche Systemwerte
-- machen die Oberfläche und die Vererbung auf allen Ebenen auf Primär- und Akzentfarbe klarer.
update public.organization_brand_profiles
set background_color = '#f6f4ec', text_color = '#122820', on_primary_color = '#ffffff';

-- Die technischen Altwerte bleiben im Enum, damit historische Backups weiterhin einspielbar
-- sind. Im Produkt gibt es jedoch nur noch ein Logo: vorhandene Varianten werden vereinheitlicht,
-- neue Uploads verwenden ebenfalls logo_primary als kanonischen Speicherwert.
update public.brand_assets
set kind = 'logo_primary'
where kind in ('logo_light', 'logo_dark', 'logo_mark', 'wordmark', 'watermark');

commit;
