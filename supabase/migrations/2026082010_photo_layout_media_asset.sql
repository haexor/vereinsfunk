begin;

-- Plan 047, PR 1: schreibt das Ergebnis der Sharp-Layout-Kompositierung atomar fest -- anders als
-- apply_image_style_render (2026081918) entsteht hier kein neues Derivat eines bestehenden Fotos,
-- sondern ein ganz neuer media_assets-Datensatz: eine Bildkomposition verdichtet N Quellfotos auf
-- eines, das keinem der Quellfotos mehr eindeutig entspricht.
--
-- Genau das reisst eine bestehende Kette auf: media_derivatives.media_asset_id (und damit jede
-- face_regions-Zeile) zeigt bislang IMMER auf dasselbe, einzeln geprueften Foto, das am Ende in
-- einem Beitrag haengt -- schedule_publication() (2026081802) prueft Widerruf/offene Personen
-- ausschliesslich ueber face_regions dieses einen media_asset_id. Ein neu erzeugter, komponierter
-- Datensatz haette dort ZERO face_regions-Zeilen, und "keine Zeilen" ist in dieser Pruefung kein
-- Blocker (dieselbe Luecke, die 2026081802 fuer face_pending/consent_invalid explizit beschreibt).
-- Ohne Gegenmassnahme wuerde ein spaeterer Widerruf einer Einwilligung an einem Quellfoto ein
-- daraus komponiertes Bild nicht mehr blockieren. Die Route (apps/api/src/photoLayout.ts)
-- rechnet deshalb die face_regions jedes Quellfotos in die Koordinaten des komponierten Bildes um
-- (Zuschnitt je Kachel, bei diagonal_split zusaetzlich die Diagonal-Halbebene) und uebergibt sie
-- hier als p_face_regions -- Entscheidung/consent_record_id bleiben dabei unveraendert erhalten,
-- nur x/y/width/height werden neu berechnet.
create or replace function public.create_photo_layout_media_asset(
  p_organization_id uuid,
  p_department_id uuid,
  p_actor_user_id uuid,
  p_object_path text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_recipe jsonb,
  p_face_regions jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_asset_id uuid;
  region jsonb;
begin
  -- on conflict do nothing statt eines gewoehnlichen insert: object_path traegt den Hash des
  -- Kompositionsergebnisses (Quellfotos + Preset sind fuer Sharp deterministisch), ein Retry nach
  -- einem Netzwerkfehler erzeugt also denselben Pfad. upload_status='ready'/scan_status='clean'
  -- sofort bei Anlage: die Bytes sind das eigene, gerade erst per Sharp erzeugte
  -- Kodierungsergebnis, keine ungeprueften Nutzer-Uploads (dieselbe Begruendung wie
  -- 2026081801 fuer den regulaeren Upload-Abschluss, hier sogar staerker -- kein fremder Inhalt).
  insert into public.media_assets (
    organization_id, department_id, bucket_id, object_path, mime_type, byte_size, sha256, width, height,
    upload_status, scan_status, structural_validation_status, created_by
  ) values (
    p_organization_id, p_department_id, 'rendered-media', p_object_path, p_mime_type, p_byte_size, p_sha256, p_width, p_height,
    'ready', 'clean', 'valid', p_actor_user_id
  )
  on conflict (bucket_id, object_path) do nothing
  returning id into new_asset_id;

  -- Ein Treffer auf den Conflict bedeutet: ein frueherer Aufruf mit identischen Bytes hat bereits
  -- vollstaendig committet (diese Funktion laeuft in einer Transaktion, ein Abbruch dazwischen
  -- haette die Zeile nie sichtbar gemacht) -- face_regions/people_reviewed_at also bereits gesetzt,
  -- ein zweiter Durchlauf wuerde sie nur doppeln.
  if new_asset_id is null then
    select id into new_asset_id from public.media_assets
      where bucket_id = 'rendered-media' and object_path = p_object_path and organization_id = p_organization_id;
    return new_asset_id;
  end if;

  for region in select * from jsonb_array_elements(p_face_regions)
  loop
    insert into public.face_regions (
      organization_id, media_asset_id, x, y, width, height, source, confidence, subject_kind, decision, consent_record_id, obscuring_style, revision, created_by
    ) values (
      p_organization_id, new_asset_id,
      (region->>'x')::numeric, (region->>'y')::numeric, (region->>'width')::numeric, (region->>'height')::numeric,
      region->>'source', (region->>'confidence')::numeric, region->>'subjectKind', region->>'decision',
      (region->>'consentRecordId')::uuid, region->>'obscuringStyle', 1, p_actor_user_id
    );
  end loop;

  -- Erst NACH den face_regions-Inserts setzen: face_regions_invalidate_people_review
  -- (2026081802) nullt people_reviewed_at bei jeder Aenderung an face_regions der Zeile --
  -- vorher gesetzt, waere es durch die Inserts oben sofort wieder zurueckgesetzt worden. Ein neu
  -- komponiertes Bild braucht keinen eigenen Durchlauf durch die Markier-UI: es zeigt ausschliesslich
  -- bereits geprueften Bildinhalt der Quellfotos, hier nur geometrisch neu zusammengesetzt.
  update public.media_assets set people_reviewed_at = now(), people_reviewed_by = p_actor_user_id where id = new_asset_id;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (p_organization_id, p_actor_user_id, 'media_asset.photo_layout_composed', 'media_asset', new_asset_id, gen_random_uuid(), p_recipe);

  return new_asset_id;
end;
$$;

revoke all on function public.create_photo_layout_media_asset(uuid, uuid, uuid, text, text, text, bigint, integer, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_photo_layout_media_asset(uuid, uuid, uuid, text, text, text, bigint, integer, integer, jsonb, jsonb) to service_role;

commit;
