begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

set local role postgres;

-- Ein Verein mit einer Abteilung, einer Verzeichnisperson und einer Einwilligung, plus ein
-- Fremdverein fuer die Mandantentrennung. Frischer UUID-Praefix (71000000...), analog zu den
-- anderen Testdateien.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-compliance.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'dept-admin@pgtap-compliance.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'editor@pgtap-compliance.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-compliance.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('71000000-1000-4000-8000-000000000001', 'PGTAP Compliance Verein', 'pgtap-compliance-verein'),
  ('71000000-1000-4000-8000-000000000002', 'PGTAP Compliance Fremdverein', 'pgtap-compliance-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('71000000-1100-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', 'Fußball', 'fussball');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('71000000-1000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('71000000-1000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'organization_viewer'),
  ('71000000-1000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000004', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'department_admin'),
  ('71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'editor');

insert into public.retention_settings (organization_id, updated_by) values
  ('71000000-1000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001');

-- 1-3: retention_settings -- Obergrenzen als CHECK, nicht als Annahme.
select throws_ok(
  $$update public.retention_settings set raw_media_days = 5 where organization_id = '71000000-1000-4000-8000-000000000001'$$,
  '23514', null, 'raw_media_days below 7 violates the CHECK constraint'
);
select throws_ok(
  $$update public.retention_settings set audit_event_days = 10 where organization_id = '71000000-1000-4000-8000-000000000001'$$,
  '23514', null, 'audit_event_days below 365 violates the CHECK constraint'
);
select is((select derivative_days from public.retention_settings where organization_id = '71000000-1000-4000-8000-000000000001'), null,
  'derivative_days defaults to null -- the rule is opt-in, not on by default');

-- 4-7: retention_settings/retention_deletions -- nur mit organization.manage lesbar, fremder
-- Verein unsichtbar.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.retention_settings where organization_id = '71000000-1000-4000-8000-000000000001'), 1,
  'the organization admin (organization.manage) sees the retention settings of their own club');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.retention_settings where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'an organization_viewer without organization.manage sees no retention settings');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.retention_settings where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s retention settings');
set local role postgres;
insert into public.retention_deletions (organization_id, entity_type, entity_count, rule_key, cutoff_date, dry_run, correlation_id) values
  ('71000000-1000-4000-8000-000000000001', 'media_assets', 3, 'raw_media', current_date, false, gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.retention_deletions where organization_id = '71000000-1000-4000-8000-000000000001'), 1,
  'the organization admin sees the retention deletion log of their own club');

-- 8-9: data_subject_requests -- due_at wird per Trigger aus received_at gesetzt, ein Kalendermonat,
-- auch am Monatsende (Postgres' date+interval normalisiert bereits korrekt auf den letzten
-- gueltigen Tag des Zielmonats -- getestet statt angenommen).
set local role postgres;
insert into public.data_subject_requests (id, organization_id, kind, subject_kind, subject_label, received_at, created_by, correlation_id) values
  ('71000000-1500-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', 'access', 'member', 'Testperson A', date '2026-03-10', '71000000-0000-4000-8000-000000000001', gen_random_uuid());
select is((select due_at from public.data_subject_requests where id = '71000000-1500-4000-8000-000000000001'), date '2026-04-10',
  'due_at is set to exactly one calendar month after received_at');
insert into public.data_subject_requests (id, organization_id, kind, subject_kind, subject_label, received_at, created_by, correlation_id) values
  ('71000000-1500-4000-8000-000000000002', '71000000-1000-4000-8000-000000000001', 'deletion', 'member', 'Testperson B', date '2026-01-31', '71000000-0000-4000-8000-000000000001', gen_random_uuid());
select is((select due_at from public.data_subject_requests where id = '71000000-1500-4000-8000-000000000002'), date '2026-02-28',
  'due_at received on 2026-01-31 clamps to the last day of February, not into March');

-- 10-12: data_subject_requests -- Verlaengerung nur mit Begruendung, Begruendung nur mit Datum,
-- beides nach due_at.
select throws_ok(
  format($$update public.data_subject_requests set extended_until = date '2026-04-01' where id = %L$$, '71000000-1500-4000-8000-000000000001'),
  '23514', null, 'extended_until before due_at violates the CHECK constraint'
);
select throws_ok(
  format($$update public.data_subject_requests set extension_reason = 'mehr Zeit noetig' where id = %L$$, '71000000-1500-4000-8000-000000000001'),
  '23514', null, 'an extension_reason without extended_until violates the CHECK constraint'
);
update public.data_subject_requests set extended_until = date '2026-05-10', extension_reason = 'komplexer Fall' where id = '71000000-1500-4000-8000-000000000001';
select ok(true, 'a reasoned extension of due_at can be recorded');

-- 13: Loeschen der verknuepften Verzeichnisperson laesst die Betroffenenanfrage bestehen -- der
-- Nachweis der Bearbeitung darf nicht mit der Person verschwinden, die sie ausgeloest hat.
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status) values
  ('71000000-1300-4000-8000-000000000009', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'Wird', 'Geloescht', false, 'active');
update public.data_subject_requests set directory_person_id = '71000000-1300-4000-8000-000000000009' where id = '71000000-1500-4000-8000-000000000002';
delete from public.directory_people where id = '71000000-1300-4000-8000-000000000009';
select is((select row(subject_label, directory_person_id) from public.data_subject_requests where id = '71000000-1500-4000-8000-000000000002'),
  row('Testperson B'::text, null::uuid),
  'deleting the linked directory person nulls directory_person_id but keeps the request and its subject_label');

-- 14-15: data_subject_requests -- nur mit organization.manage lesbar.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.data_subject_requests where organization_id = '71000000-1000-4000-8000-000000000001'), 2,
  'the organization admin sees both data subject requests of their own club');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.data_subject_requests where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'a department admin without organization.manage sees no data subject requests');

-- 16-18: processing_records -- Drittlandtransfer verlangt eine Garantie, reviewed_at/reviewed_by
-- sind gepaart.
set local role postgres;
select throws_ok(
  $$insert into public.processing_records (organization_id, purpose, legal_basis, retention_note, third_country_transfer)
    values ('71000000-1000-4000-8000-000000000001', 'Test', 'Test', 'Test', true)$$,
  '23514', null, 'third_country_transfer=true without transfer_safeguard violates the CHECK constraint'
);
select throws_ok(
  $$insert into public.processing_records (organization_id, purpose, legal_basis, retention_note, reviewed_at)
    values ('71000000-1000-4000-8000-000000000001', 'Test', 'Test', 'Test', current_date)$$,
  '23514', null, 'reviewed_at without reviewed_by violates the paired CHECK constraint'
);
insert into public.processing_records (id, organization_id, purpose, legal_basis, retention_note) values
  ('71000000-1600-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', 'Beitragserstellung', 'Vertragserfuellung', 'Bis zur Loeschung');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.processing_records where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s processing records');

-- 19-20: processor_agreements -- document_bucket ist auf raw-media festgelegt, valid_until muss
-- nach signed_at liegen.
set local role postgres;
select throws_ok(
  $$insert into public.processor_agreements (organization_id, processor_name, purpose, document_bucket, created_by)
    values ('71000000-1000-4000-8000-000000000001', 'Supabase', 'Hosting', 'brand-assets', '71000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a document_bucket other than raw-media violates the CHECK constraint'
);
select throws_ok(
  $$insert into public.processor_agreements (organization_id, processor_name, purpose, signed_at, valid_until, created_by)
    values ('71000000-1000-4000-8000-000000000001', 'Supabase', 'Hosting', current_date, current_date - 1, '71000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'valid_until before signed_at violates the CHECK constraint'
);

-- 21-22: select_expired_raw_media -- ein Rohmedium ohne jedes Derivat gilt als Kandidat, eines mit
-- Derivat (unabhaengig vom Status) nicht.
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, upload_status, created_by, created_at) values
  ('71000000-1700-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/71000000-1000-4000-8000-000000000001/departments/71000000-1100-4000-8000-000000000001/submissions/x/ohne-derivat.jpg', 'image/jpeg', 1000, 'ready', '71000000-0000-4000-8000-000000000001', now() - interval '200 days'),
  ('71000000-1700-4000-8000-000000000002', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/71000000-1000-4000-8000-000000000001/departments/71000000-1100-4000-8000-000000000001/submissions/x/mit-derivat.jpg', 'image/jpeg', 1000, 'ready', '71000000-0000-4000-8000-000000000001', now() - interval '200 days'),
  ('71000000-1700-4000-8000-000000000003', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/71000000-1000-4000-8000-000000000001/departments/71000000-1100-4000-8000-000000000001/submissions/x/zu-jung.jpg', 'image/jpeg', 1000, 'ready', '71000000-0000-4000-8000-000000000001', now() - interval '10 days');
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('71000000-1800-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', '71000000-1700-4000-8000-000000000002', '{}'::jsonb, 'v1', 'organizations/71000000-1000-4000-8000-000000000001/departments/71000000-1100-4000-8000-000000000001/renders/mit-derivat.jpg', repeat('a', 64), 'image/jpeg', 500, 'processing');
select is(
  (select array_agg(media_asset_id order by media_asset_id) from public.select_expired_raw_media('71000000-1000-4000-8000-000000000001', now() - interval '90 days')),
  array['71000000-1700-4000-8000-000000000001'::uuid],
  'select_expired_raw_media returns only the asset without any derivative and older than the cutoff'
);
select is(
  (select count(*)::integer from public.select_expired_raw_media('71000000-1000-4000-8000-000000000001', now() - interval '90 days') where media_asset_id = '71000000-1700-4000-8000-000000000003'),
  0, 'select_expired_raw_media excludes an asset younger than the cutoff'
);

-- 22b: KRITISCHER FUND (adversariale Pruefung) -- media_assets.object_path ist freier Text ohne
-- CHECK gegen organization_id. Ein Mitglied mit post.create im EIGENEN Verein 001 kann eine Zeile
-- mit organization_id=001, aber object_path im Ordner eines FREMDEN Vereins 002 anlegen. Ohne den
-- Praefix-Filter in select_expired_raw_media hätte der naechste Retention-Lauf von Verein 001 ein
-- echtes Storage-Objekt von Verein 002 geloescht (Service-Role, keine RLS). Dieser Test simuliert
-- genau das Untergeschobene und belegt, dass es aus der Auswahl herausfaellt.
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, upload_status, created_by, created_at) values
  ('71000000-1700-4000-8000-000000000009', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/71000000-1000-4000-8000-000000000002/departments/x/submissions/x/untergeschoben.jpg', 'image/jpeg', 1000, 'ready', '71000000-0000-4000-8000-000000000001', now() - interval '200 days');
select is(
  (select count(*)::integer from public.select_expired_raw_media('71000000-1000-4000-8000-000000000001', now() - interval '90 days') where media_asset_id = '71000000-1700-4000-8000-000000000009'),
  0, 'select_expired_raw_media excludes a row whose object_path points into a foreign organization''s folder, even though organization_id matches the caller'
);

-- 23-24: select_expired_media_derivatives -- ein Derivat ohne post_media-Referenz gilt als
-- Kandidat, eines MIT Referenz nicht -- bewusst unabhaengig vom Veroeffentlichungsstatus des
-- referenzierenden Beitrags (post_media -> media_derivatives verweist mit on delete restrict;
-- eine Loeschung wuerde an jeder Referenz scheitern, nicht nur an veroeffentlichten).
update public.media_derivatives set created_at = now() - interval '400 days' where id = '71000000-1800-4000-8000-000000000001';
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status, created_at) values
  ('71000000-1800-4000-8000-000000000002', '71000000-1000-4000-8000-000000000001', '71000000-1700-4000-8000-000000000001', '{}'::jsonb, 'v1', 'organizations/71000000-1000-4000-8000-000000000001/departments/71000000-1100-4000-8000-000000000001/renders/verwaist.jpg', repeat('b', 64), 'image/jpeg', 500, 'ready', now() - interval '400 days');
insert into public.posts (id, organization_id, department_id, created_by) values
  ('71000000-1900-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type) values
  ('71000000-1910-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', '71000000-1900-4000-8000-000000000001', 1, '{}'::jsonb, '{}'::jsonb, 'system');
insert into public.post_media (organization_id, post_version_id, media_derivative_id, position, role) values
  ('71000000-1000-4000-8000-000000000001', '71000000-1910-4000-8000-000000000001', '71000000-1800-4000-8000-000000000001', 0, 'primary');
select is(
  (select array_agg(media_derivative_id order by media_derivative_id) from public.select_expired_media_derivatives('71000000-1000-4000-8000-000000000001', now() - interval '90 days')),
  array['71000000-1800-4000-8000-000000000002'::uuid],
  'select_expired_media_derivatives returns only the derivative without any post_media reference'
);
select is(
  (select count(*)::integer from public.select_expired_media_derivatives('71000000-1000-4000-8000-000000000001', now() - interval '90 days') where media_derivative_id = '71000000-1800-4000-8000-000000000001'),
  0, 'select_expired_media_derivatives excludes a derivative that still has a post_media reference'
);

-- 25-30: manipulationssicherer Audit-Trail -- Kette je Verein, Pruef- und Signaturfunktion.
set local role postgres;
insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id) values
  ('71000000-1000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'organization.created', 'organization', '71000000-1000-4000-8000-000000000001', gen_random_uuid());
insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id) values
  ('71000000-1000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'member.invite', 'invitations', null, gen_random_uuid());
-- order by chain_seq, nicht created_at: innerhalb dieser einen Testtransaktion ist now() fuer
-- beide Inserts identisch (Postgres liefert den Transaktionsstart) -- exakt der Fall, fuer den
-- chain_seq als Ordnungsspalte eingefuehrt wurde.
select isnt((select hash from public.audit_events where organization_id = '71000000-1000-4000-8000-000000000001' order by chain_seq limit 1), null,
  'the first audit event of a club gets a computed hash');
select is((select prev_hash from public.audit_events where organization_id = '71000000-1000-4000-8000-000000000001' order by chain_seq limit 1), null,
  'the first audit event of a club has no prev_hash -- nothing came before it');
select is(
  (select prev_hash from public.audit_events where organization_id = '71000000-1000-4000-8000-000000000001' order by chain_seq offset 1 limit 1),
  (select hash from public.audit_events where organization_id = '71000000-1000-4000-8000-000000000001' order by chain_seq limit 1),
  'the second audit event''s prev_hash equals the first event''s hash -- a real chain, not independent hashes'
);
select is(
  (select tampered_count from public.verify_audit_chain('71000000-1000-4000-8000-000000000001')),
  0::bigint, 'verify_audit_chain finds no tampering in a freshly written, untouched chain'
);
update public.audit_events set hash = 'deadbeef' where organization_id = '71000000-1000-4000-8000-000000000001' and action = 'member.invite';
select is(
  (select tampered_count from public.verify_audit_chain('71000000-1000-4000-8000-000000000001')),
  1::bigint, 'verify_audit_chain detects a row whose stored hash no longer matches its prev_hash and payload'
);
select is(
  (select checked_count from public.verify_audit_chain('71000000-1000-4000-8000-000000000001')),
  2::bigint, 'verify_audit_chain checks every audit event of the club, tampered or not'
);

-- 31-32: create_organization() saet Aufbewahrungs-Standardwerte und Verarbeitungsdokumentation.
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select public.create_organization('PGTAP Neuer Verein', 'Erste Abteilung') as new_org_id \gset
select isnt((select organization_id from public.retention_settings where organization_id = :'new_org_id'), null,
  'create_organization seeds a retention_settings row for the new club');
select is((select count(*)::integer from public.processing_records where organization_id = :'new_org_id'), 4,
  'create_organization seeds four draft processing records for the new club');

-- 33-38: Storage-Pfadpraefix-Rechte innerhalb von raw-media -- compliance/ nur mit
-- organization.manage, consents/ ueber consent.manage der verknuepften Abteilung, alles andere
-- (z. B. departments/... fuer Submissions) bleibt vereinsweit lesbar wie bisher.
set local role postgres;
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status) values
  ('71000000-1300-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'Team', 'Foto', false, 'active');
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, evidence_path, created_by) values
  ('71000000-1400-4000-8000-000000000001', '71000000-1000-4000-8000-000000000001', '71000000-1300-4000-8000-000000000001', '71000000-1300-4000-8000-000000000001', 'Team-Foto', 'organizations/71000000-1000-4000-8000-000000000001/consents/71000000-1400-4000-8000-000000000001/nachweis', '71000000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name) values
  ('raw-media', 'organizations/71000000-1000-4000-8000-000000000001/compliance/agreement-1/vertrag.pdf'),
  ('raw-media', 'organizations/71000000-1000-4000-8000-000000000001/consents/71000000-1400-4000-8000-000000000001/nachweis'),
  ('raw-media', 'organizations/71000000-1000-4000-8000-000000000001/departments/71000000-1100-4000-8000-000000000001/submissions/x/foto.jpg');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from storage.objects where name like '%/compliance/%'), 1,
  'the organization admin (organization.manage) can read a compliance/ object');
select is((select count(*)::integer from storage.objects where name like '%/consents/%'), 1,
  'the organization admin can read a consents/ object via the organization-level fallback in has_department_permission');

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from storage.objects where name like '%/compliance/%'), 0,
  'the department admin without organization.manage cannot read a compliance/ object');
select is((select count(*)::integer from storage.objects where name like '%/consents/%'), 1,
  'the department admin (consent.manage on their own department) can read the consents/ object');
select is((select count(*)::integer from storage.objects where name like '%/departments/%'), 1,
  'the department admin can still read a plain media object under departments/, as before this migration');

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from storage.objects where name like '%/consents/%'), 0,
  'a plain editor without consent.manage cannot read the consents/ object');

-- 39-40: ein Fremdverein-Admin sieht keines der drei Objekte -- Mandantentrennung bleibt entlang
-- aller drei Zweige der Storage-Policy gewahrt, nicht nur entlang des zuletzt geprueften.
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from storage.objects where name like '%/compliance/%' or name like '%/consents/%'), 0,
  'a foreign organization admin reaches neither the compliance/ nor the consents/ object of another club');
select is((select count(*)::integer from storage.objects where name like '%/departments/%'), 0,
  'a foreign organization admin does not reach a plain media object under departments/ of another club');

-- 41-42: processor_agreements/audit_chain_signatures/data_subject_requests -- Fremdverein-Sicht
-- fehlte bislang (adversariale Pruefung: AGENTS.md verlangt positive UND negative Isolationstests
-- fuer jede neu exponierte Tabelle).
set local role postgres;
insert into public.audit_chain_signatures (organization_id, event_count, head_hash, key_version, signature) values
  ('71000000-1000-4000-8000-000000000001', 2, 'deadbeef', 'v1', 'irrelevant-fuer-rls');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.processor_agreements where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s processor agreements');
select is((select count(*)::integer from public.audit_chain_signatures where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s audit chain signatures');
select is((select count(*)::integer from public.data_subject_requests where organization_id = '71000000-1000-4000-8000-000000000001'), 0,
  'a foreign organization admin sees none of this club''s data subject requests');
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.audit_chain_signatures where organization_id = '71000000-1000-4000-8000-000000000001'), 1,
  'the organization admin (organization.manage) sees the audit chain signature of their own club');

-- 43-45: select_expired_consent_evidence -- Ende der Gueltigkeit ist der Widerruf, wenn
-- vorhanden, sonst valid_until; eine unbefristete, nicht widerrufene Einwilligung ist nie ein
-- Kandidat, und eine erst kuerzlich widerrufene wird noch nicht als abgelaufen gezaehlt.
set local role postgres;
insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status) values
  ('71000000-1300-4000-8000-000000000002', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'Alt', 'Widerrufen', false, 'active'),
  ('71000000-1300-4000-8000-000000000003', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'Unbefristet', 'Gueltig', false, 'active'),
  ('71000000-1300-4000-8000-000000000004', '71000000-1000-4000-8000-000000000001', '71000000-1100-4000-8000-000000000001', 'Kuerzlich', 'Widerrufen', false, 'active');
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, evidence_path, revoked_at, created_by) values
  ('71000000-1400-4000-8000-000000000002', '71000000-1000-4000-8000-000000000001', '71000000-1300-4000-8000-000000000002', '71000000-1300-4000-8000-000000000002', 'Altfoto', 'organizations/71000000-1000-4000-8000-000000000001/consents/71000000-1400-4000-8000-000000000002/nachweis', now() - interval '10 years', '71000000-0000-4000-8000-000000000001');
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, evidence_path, created_by) values
  ('71000000-1400-4000-8000-000000000003', '71000000-1000-4000-8000-000000000001', '71000000-1300-4000-8000-000000000003', '71000000-1300-4000-8000-000000000003', 'Unbefristet', 'organizations/71000000-1000-4000-8000-000000000001/consents/71000000-1400-4000-8000-000000000003/nachweis', '71000000-0000-4000-8000-000000000001');
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, evidence_path, revoked_at, created_by) values
  ('71000000-1400-4000-8000-000000000004', '71000000-1000-4000-8000-000000000001', '71000000-1300-4000-8000-000000000004', '71000000-1300-4000-8000-000000000004', 'Kuerzlich', 'organizations/71000000-1000-4000-8000-000000000001/consents/71000000-1400-4000-8000-000000000004/nachweis', now() - interval '1 month', '71000000-0000-4000-8000-000000000001');
select is(
  (select array_agg(consent_record_id order by consent_record_id) from public.select_expired_consent_evidence('71000000-1000-4000-8000-000000000001', now() - interval '5 years')),
  array['71000000-1400-4000-8000-000000000002'::uuid],
  'select_expired_consent_evidence returns only the record revoked well before the cutoff -- not the unfettered one, not the recently revoked one'
);

-- 46: pseudonymous_subject_ref und signer_name sind nullbar, damit POST .../erase eine
-- identifizierende Verknuepfung tatsaechlich entfernen kann, statt sie stillschweigend zu behalten.
update public.consent_records set pseudonymous_subject_ref = null, signer_name = null where id = '71000000-1400-4000-8000-000000000002';
select ok(true, 'pseudonymous_subject_ref and signer_name can be cleared on an existing consent record');

select * from finish();
commit;
