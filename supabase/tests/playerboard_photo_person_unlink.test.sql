begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- 2026101913: verschwindet eine Personenzuordnung eines geprueften Trainingsfotos (z. B. weil die
-- Verzeichnisperson geloescht wird), ist das Foto gesperrt und privat -- unabhaengig davon, ob der
-- Einwilligungs-Trigger auf consent_records ebenfalls greift. Die Einwilligung gehoert hier deshalb
-- bewusst einer anderen Person, damit nur die Kaskade auf die Zuordnung wirkt.
set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'trainer@pgtap-photo-unlink.local', '', '{}', '{}', now(), now());
insert into public.organizations (id, name, slug) values
  ('a4000000-1000-4000-8000-000000000001', 'PGTAP Foto Zuordnung', 'pgtap-foto-zuordnung');
insert into public.departments (id, organization_id, name, slug) values
  ('a4000000-1100-4000-8000-000000000001', 'a4000000-1000-4000-8000-000000000001', 'Fussball', 'fussball');
insert into public.teams (id, organization_id, department_id, name) values
  ('a4000000-1200-4000-8000-000000000001', 'a4000000-1000-4000-8000-000000000001', 'a4000000-1100-4000-8000-000000000001', 'U13');
insert into public.directory_people (id, organization_id, department_id, team_id, first_name, last_name, birth_year) values
  ('a4000000-2000-4000-8000-000000000001', 'a4000000-1000-4000-8000-000000000001', 'a4000000-1100-4000-8000-000000000001', 'a4000000-1200-4000-8000-000000000001', 'Mia', 'Keller', 2013),
  ('a4000000-2000-4000-8000-000000000002', 'a4000000-1000-4000-8000-000000000001', 'a4000000-1100-4000-8000-000000000001', 'a4000000-1200-4000-8000-000000000001', 'Jonas', 'Albers', 2013);
insert into public.consent_records (id, organization_id, directory_person_id, scope, scope_structured, origin, signer_role, created_by) values
  ('a4000000-6000-4000-8000-000000000001', 'a4000000-1000-4000-8000-000000000001', 'a4000000-2000-4000-8000-000000000002', 'Website Training',
   '{"purposes": ["website"], "platforms": null, "mediaKinds": ["photo"], "contexts": ["training"], "namingAllowed": false, "departmentIds": null}', 'paper', 'self', 'a4000000-0000-4000-8000-000000000001');
insert into public.playerboard_trainings (id, organization_id, department_id, team_id, training_date, title, status) values
  ('a4000000-5000-4000-8000-000000000001', 'a4000000-1000-4000-8000-000000000001', 'a4000000-1100-4000-8000-000000000001', 'a4000000-1200-4000-8000-000000000001', current_date - 1, 'Dienstag', 'saved');
insert into public.playerboard_training_photos (id, organization_id, training_id, storage_path, content_type, size_bytes, uploaded_by) values
  ('a4000000-7000-4000-8000-000000000001', 'a4000000-1000-4000-8000-000000000001', 'a4000000-5000-4000-8000-000000000001',
   'a4000000-1000-4000-8000-000000000001/a4000000-1200-4000-8000-000000000001/a4000000-5000-4000-8000-000000000001/p1.jpg', 'image/jpeg', 1000, 'a4000000-0000-4000-8000-000000000001');
update public.playerboard_training_photos
   set upload_completed_at = now(), consent_review_status = 'approved', all_recognizable_people_listed = true, public = true
 where id = 'a4000000-7000-4000-8000-000000000001';
insert into public.playerboard_training_photo_people (organization_id, photo_id, directory_person_id, consent_record_id) values
  ('a4000000-1000-4000-8000-000000000001', 'a4000000-7000-4000-8000-000000000001', 'a4000000-2000-4000-8000-000000000001', 'a4000000-6000-4000-8000-000000000001');

select is((select consent_review_status || '/' || public::text from public.playerboard_training_photos where id = 'a4000000-7000-4000-8000-000000000001'),
  'approved/true', 'the reviewed photo starts approved and public');

-- Betroffenenanfrage: die abgebildete Person wird geloescht, ihre Zuordnung kaskadiert weg.
delete from public.directory_people where id = 'a4000000-2000-4000-8000-000000000001';

select is((select count(*)::integer from public.playerboard_training_photo_people where photo_id = 'a4000000-7000-4000-8000-000000000001'), 0,
  'deleting the directory person removes the photo link');
select is((select consent_review_status || '/' || public::text from public.playerboard_training_photos where id = 'a4000000-7000-4000-8000-000000000001'),
  'blocked/false', 'the photo is blocked and private once a listed person disappears from it');

select * from finish();
rollback;
