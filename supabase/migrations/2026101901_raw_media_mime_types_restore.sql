begin;

-- 2026082503_audio_uploads.sql hat die Liste von raw-media ueberschrieben statt ergaenzt und damit
-- die Typen entfernt, die fruehere Migrationen bewusst hinzugefuegt hatten: die Schrift-Originale
-- (2026080702), Einwilligungsnachweise als PDF (2026080801) sowie Vertragsdokumente und
-- Auskunftsexporte (2026080901). Seitdem lehnte Storage jeden dieser Uploads mit
-- invalid_mime_type ab (Schrift-Upload, Nachweis, AV-Vertrag, Datenauskunft). Wie in 2026080801
-- vereinigt diese Migration mit dem Bestand, statt ihn zu ersetzen.
update storage.buckets
set allowed_mime_types = array(select distinct unnest(
  allowed_mime_types || array[
    'font/woff2', 'font/ttf', 'font/otf',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/json'
  ]
))
where id = 'raw-media';

commit;
