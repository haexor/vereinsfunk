begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '49500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-photo-layout-asset.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('49500000-1000-4000-8000-000000000001', 'PGTAP Bildkomposition Asset Verein', 'pgtap-bildkomposition-asset-verein');
insert into public.departments (id, organization_id, name, slug) values
  ('49500000-1100-4000-8000-000000000001', '49500000-1000-4000-8000-000000000001', 'Fußball', 'fussball');

-- Eine Person und eine gueltige Einwilligung, damit eine uebertragene face_regions-Zeile mit
-- decision='consented' die referenzielle Integritaet (consent_record_id) tatsaechlich erfuellt --
-- genau der Fall, den die neue Funktion fuer eine Bildkomposition ermoeglichen soll (Widerruf muss
-- weiterhin ueber die NEU angelegte Zeile wirken, siehe Migrationskommentar).
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status) values
  ('49500000-1300-4000-8000-000000000001', '49500000-1000-4000-8000-000000000001', '49500000-1100-4000-8000-000000000001', 'Max', 'Schmidt', false, 'active');
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, signed_at, evidence_path, created_by) values
  ('49500000-1400-4000-8000-000000000001', '49500000-1000-4000-8000-000000000001', '49500000-1300-4000-8000-000000000001', '49500000-1300-4000-8000-000000000001', 'Fotos fuer Social Media', 'self', false, current_date, 'organizations/49500000-1000-4000-8000-000000000001/consents/49500000-1400-4000-8000-000000000001/nachweis', '49500000-0000-4000-8000-000000000001');

-- 1: authenticated darf diese Funktion nicht direkt aufrufen -- Service-Role-only, wie apply_image_style_render.
set local role authenticated;
select set_config('request.jwt.claim.sub', '49500000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.create_photo_layout_media_asset('49500000-1000-4000-8000-000000000001', '49500000-1100-4000-8000-000000000001', '49500000-0000-4000-8000-000000000001', 'organizations/x/photo-layouts/1/a.jpg', repeat('a', 64), 'image/jpeg', 1000, 100, 100, '{"kind":"photo_layout_v1"}', '[]'::jsonb)$$,
  '42501', null, 'authenticated darf create_photo_layout_media_asset nicht direkt aufrufen'
);

set local role postgres;

-- 2-5: ein Aufruf mit einer nicht-leeren face_regions-Liste legt den media_asset-Datensatz UND die
-- uebertragene face_regions-Zeile an, und setzt people_reviewed_at trotz des
-- face_regions_invalidate_people_review-Triggers (2026081802), der bei jeder Aenderung an
-- face_regions der Zeile people_reviewed_at eigentlich zuruecksetzt.
select is(
  (select public.create_photo_layout_media_asset(
    '49500000-1000-4000-8000-000000000001', '49500000-1100-4000-8000-000000000001', '49500000-0000-4000-8000-000000000001',
    'organizations/x/photo-layouts/1/result.jpg', repeat('b', 64), 'image/jpeg', 2000, 1600, 1600,
    '{"kind":"photo_layout_v1"}',
    '[{"x":0.1,"y":0.2,"width":0.15,"height":0.1,"source":"automatic","confidence":0.92,"subjectKind":"adult","decision":"consented","consentRecordId":"49500000-1400-4000-8000-000000000001","obscuringStyle":null}]'::jsonb
  )) is not null,
  true,
  'the function returns a new media_asset id'
);
select is(
  (select (upload_status, scan_status, structural_validation_status, people_reviewed_at is not null)::text from public.media_assets where object_path = 'organizations/x/photo-layouts/1/result.jpg'),
  '(ready,clean,valid,t)', 'the composed media_asset is immediately ready/clean/valid and people_reviewed_at is set despite the face_regions insert'
);
select is(
  (select count(*)::integer from public.face_regions where media_asset_id = (select id from public.media_assets where object_path = 'organizations/x/photo-layouts/1/result.jpg')),
  1, 'exactly one transferred face_regions row was created for the composed asset'
);
select is(
  (select (decision, consent_record_id, subject_kind)::text from public.face_regions where media_asset_id = (select id from public.media_assets where object_path = 'organizations/x/photo-layouts/1/result.jpg')),
  ('(consented,49500000-1400-4000-8000-000000000001,adult)')::text,
  'the transferred face_regions row keeps decision and consent_record_id -- a later revocation of this consent still reaches the composed image'
);

-- 6: ein Retry mit demselben object_path (deterministisches Sharp-Ergebnis) liefert dieselbe
-- media_asset-ID zurueck statt die face_regions-Zeile ein zweites Mal anzulegen.
select is(
  (select public.create_photo_layout_media_asset(
    '49500000-1000-4000-8000-000000000001', '49500000-1100-4000-8000-000000000001', '49500000-0000-4000-8000-000000000001',
    'organizations/x/photo-layouts/1/result.jpg', repeat('b', 64), 'image/jpeg', 2000, 1600, 1600,
    '{"kind":"photo_layout_v1"}',
    '[{"x":0.1,"y":0.2,"width":0.15,"height":0.1,"source":"automatic","confidence":0.92,"subjectKind":"adult","decision":"consented","consentRecordId":"49500000-1400-4000-8000-000000000001","obscuringStyle":null}]'::jsonb
  )),
  (select id from public.media_assets where object_path = 'organizations/x/photo-layouts/1/result.jpg'),
  'a retry with the same object_path returns the same media_asset id instead of writing a second row'
);
select is(
  (select count(*)::integer from public.face_regions where media_asset_id = (select id from public.media_assets where object_path = 'organizations/x/photo-layouts/1/result.jpg')),
  1, 'the retry did not duplicate the transferred face_regions row'
);

-- 7: ein Aufruf ohne jede Gesichtsregion (leeres Array) legt den Datensatz trotzdem mit sofort
-- gesetztem people_reviewed_at an -- der haeufigste Fall (keine der Quellfotos zeigt Personen).
-- Die neue ID wird per \gset in einer EIGENEN Anweisung abgegriffen, statt sie im selben SELECT
-- zu verwenden, das media_assets gleich wieder liest: ein FROM-Scan derselben Tabelle innerhalb
-- DERSELBEN Anweisung sieht den Schreibzugriff einer datenveraendernden Funktion aus der
-- WHERE-Klausel nicht zuverlaessig (dasselbe Snapshot-Verhalten, das PostgreSQL fuer volatile
-- Funktionen in Unterabfragen dokumentiert) -- beim Bauen dieses Tests real als Phantom-Fehlschlag
-- ("have: NULL") aufgefallen, nicht nur eine theoretische Sorge.
select public.create_photo_layout_media_asset(
  '49500000-1000-4000-8000-000000000001', '49500000-1100-4000-8000-000000000001', '49500000-0000-4000-8000-000000000001',
  'organizations/x/photo-layouts/2/result.jpg', repeat('c', 64), 'image/png', 3000, 1600, 1600,
  '{"kind":"photo_layout_v1"}', '[]'::jsonb
) as empty_face_regions_asset_id \gset
select is(
  (select (upload_status, people_reviewed_at is not null)::text from public.media_assets where id = :'empty_face_regions_asset_id'),
  '(ready,t)', 'a call with an empty face_regions array still marks the asset ready and reviewed'
);

-- 8: department_id der neuen Zeile stimmt mit dem uebergebenen Parameter -- nicht mit irgendeiner
-- Abteilung der Quellfotos (die Route uebergibt die departmentId der aufrufenden Anfrage).
select is(
  (select department_id from public.media_assets where object_path = 'organizations/x/photo-layouts/2/result.jpg'),
  '49500000-1100-4000-8000-000000000001'::uuid, 'the composed asset carries the department_id passed by the route'
);

-- 9-10: ein audit_events-Eintrag entsteht je Aufruf, mit dem uebergebenen Rezept als Metadaten.
select is(
  (select count(*)::integer from public.audit_events where action = 'media_asset.photo_layout_composed' and entity_id = (select id from public.media_assets where object_path = 'organizations/x/photo-layouts/1/result.jpg')),
  1, 'an audit_events row was recorded for the composed asset'
);
select is(
  (select metadata from public.audit_events where action = 'media_asset.photo_layout_composed' and entity_id = (select id from public.media_assets where object_path = 'organizations/x/photo-layouts/2/result.jpg')),
  '{"kind":"photo_layout_v1"}'::jsonb, 'the audit metadata carries the recipe passed into the function'
);

select * from finish();
rollback;
