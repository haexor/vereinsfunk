begin;

-- 2026081801 hat UPDATE auf media_assets fuer authenticated entzogen, INSERT aber stehen lassen
-- (Grant aus 202608030001 samt Policy media_assets_insert). Ein Mitglied mit post.create konnte
-- deshalb per direktem PostgREST-Aufruf eine Zeile mit upload_status='ready', scan_status='clean',
-- structural_validation_status='valid' und gesetztem people_reviewed_at anlegen und ueber die
-- Storage-Policy storage_upload_department die Bytes direkt in raw-media legen -- vorbei an
-- reserve_storage_upload() (Kontingent), der Byte-/Decode-Pruefung beim Abschluss und der
-- Personenpruefung. Kein Client schreibt so: Zeilen entstehen nur ueber reserve_storage_upload()
-- bzw. photo-layout-RPCs (Service Role), Bytes nur ueber signierte Upload-URLs, die Storage ohne
-- RLS-Insert-Policy annimmt.
revoke insert on public.media_assets from authenticated;
drop policy if exists media_assets_insert on public.media_assets;
drop policy if exists storage_upload_department on storage.objects;

commit;
