begin;

-- Musik bleibt wie alle Rohmedien privat. Die erlaubten Typen sind bewusst eng; der API-Upload
-- prüft die Signatur erneut und übernimmt nie blind den MIME-Type des Browsers.
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/mp4']
where id = 'raw-media';

update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/mp4']
where id = 'rendered-media';

commit;
