begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

set local role postgres;

-- 2026082503 hatte die Liste ueberschrieben; Schrift-, Nachweis-, Vertrags- und Exportuploads
-- scheiterten danach an invalid_mime_type.
select ok(
  (select allowed_mime_types @> array[
    'font/woff2', 'font/ttf', 'font/otf', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/json'
  ] from storage.buckets where id = 'raw-media'),
  'raw-media accepts font originals, consent evidence, contract documents and data exports'
);

select ok(
  (select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/mp4']
   from storage.buckets where id = 'raw-media'),
  'raw-media keeps the media types'
);

select * from finish();
rollback;
