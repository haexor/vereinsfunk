begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

set local role postgres;

-- Ein Verein mit einer Abteilung, einer minderjaehrigen und einer erwachsenen Person im
-- Verzeichnis, plus ein Fremdverein fuer die Mandantentrennung. Frischer UUID-Praefix (70000000...)
-- analog zu fixtures_and_events.test.sql (69000000...), damit beide Dateien kollisionsfrei
-- in derselben Datenbank laufen.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-consent.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'dept-admin@pgtap-consent.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'editor@pgtap-consent.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-consent.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('70000000-1000-4000-8000-000000000001', 'PGTAP Consent Verein', 'pgtap-consent-verein'),
  ('70000000-1000-4000-8000-000000000002', 'PGTAP Consent Fremdverein', 'pgtap-consent-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('70000000-1100-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('70000000-1100-4000-8000-000000000002', '70000000-1000-4000-8000-000000000002', 'Fremdabteilung', 'fremdabteilung');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('70000000-1000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('70000000-1000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000004', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'department_admin'),
  ('70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', 'editor');

insert into public.directory_people (id, organization_id, department_id, first_name, last_name, is_minor, status, guardian_email) values
  ('70000000-1300-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', 'Lisa', 'Meier', true, 'active', 'eltern@pgtap-consent.local'),
  ('70000000-1300-4000-8000-000000000002', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', 'Max', 'Schmidt', false, 'active', null);

-- 1-2: consent_records-Grundzustand -- guardian_confirmed=false bei signer_role='guardian'
-- verletzt den neuen CHECK (Plan 015, "Fachliches Modell").
select throws_ok(
  $$insert into public.consent_records (organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, evidence_path, created_by)
    values ('70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'Fotos fuer Social Media', 'guardian', false, 'organizations/x/consents/y/nachweis', '70000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'signer_role guardian without guardian_confirmed violates the new CHECK constraint'
);
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, scope_structured, signer_role, guardian_confirmed, signed_at, evidence_path, created_by) values
  ('70000000-1400-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'Fotos fuer Social Media, keine Namensnennung',
   jsonb_build_object('purposes', array['social_media'], 'platforms', null, 'mediaKinds', array['photo'], 'contexts', null, 'namingAllowed', false, 'departmentIds', null),
   'guardian', true, current_date, 'organizations/70000000-1000-4000-8000-000000000001/consents/70000000-1400-4000-8000-000000000001/nachweis', '70000000-0000-4000-8000-000000000002');
select ok(true, 'a guardian-signed consent with guardian_confirmed=true can be created');

-- 3: eine Einwilligung darf sich nicht selbst abloesen.
select throws_ok(
  format($$update public.consent_records set superseded_by = id where id = %L$$, '70000000-1400-4000-8000-000000000001'),
  '23514', null, 'a consent record cannot supersede itself'
);

-- 4-5: Ablosungskette -- zwei Nachfolger derselben Zeile sind unentscheidbar, welche Version gilt.
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, scope_structured, signer_role, guardian_confirmed, signed_at, evidence_path, created_by) values
  ('70000000-1400-4000-8000-000000000002', '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'engerer Umfang',
   jsonb_build_object('purposes', array['social_media'], 'platforms', array['instagram'], 'mediaKinds', array['photo'], 'contexts', null, 'namingAllowed', false, 'departmentIds', null),
   'guardian', true, current_date, 'organizations/70000000-1000-4000-8000-000000000001/consents/70000000-1400-4000-8000-000000000001/nachweis', '70000000-0000-4000-8000-000000000002');
update public.consent_records set superseded_by = '70000000-1400-4000-8000-000000000002' where id = '70000000-1400-4000-8000-000000000001';
select ok(true, 'a consent record can be superseded by exactly one successor');
-- Nicht "zeigt auf denselben Vorgaenger" (das waere unmoeglich, superseded_by ist eine Spalte pro
-- Zeile) -- sondern zwei VERSCHIEDENE Vorgaenger, die beide behaupten, vom selben Nachfolger
-- abgeloest worden zu sein. Das ist die eigentliche Mehrdeutigkeit, die der Index verhindert.
select throws_ok(
  $$insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, signed_at, evidence_path, superseded_by, created_by)
    values ('70000000-1400-4000-8000-000000000009', '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'zweiter Vorgaenger desselben Nachfolgers', 'guardian', true, current_date, 'x', '70000000-1400-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002')$$,
  '23505', null, 'a second, different row claiming to be superseded by the same successor violates the unique index'
);

-- 6: ein gesetztes source_id erzwingt origin='imported'. Nur diese Richtung -- origin='imported'
-- ohne source_id bleibt zulaessig, damit eine importierte Zeile ihre Herkunft behaelt, wenn die
-- Quelle spaeter geloescht wird und source_id per SET NULL entfaellt.
select throws_ok(
  format($$insert into public.consent_records (organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, signed_at, evidence_path, origin, source_id, created_by)
    values (%L, %L, %L, 'x', 'guardian', true, current_date, 'x', 'paper', gen_random_uuid(), '70000000-0000-4000-8000-000000000002')$$, '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001'),
  '23514', null, 'origin=paper with a source_id set violates the origin/source_id CHECK'
);

-- 7: revocation_token_hash ist nur bei origin='digital' zulaessig.
select throws_ok(
  format($$insert into public.consent_records (organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, signed_at, evidence_path, origin, revocation_token_hash, created_by)
    values (%L, %L, %L, 'x', 'guardian', true, current_date, 'x', 'paper', 'deadbeef', '70000000-0000-4000-8000-000000000002')$$, '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001'),
  '23514', null, 'a revocation_token_hash on an origin=paper record violates the digital-only CHECK'
);

-- 8: consent_records bleibt select-only fuer authenticated -- kein Schreibpfad ausserhalb der API
-- mit Service Role (dasselbe Muster wie directory_people/fixtures seit den Paketen 014/019).
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.consent_records (organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, signed_at, evidence_path, created_by)
    values ('70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'x', 'guardian', true, current_date, 'x', '70000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'authenticated cannot insert into consent_records even as department_admin -- writes go through the API with the service role'
);
set local role postgres;

-- 9-11: policy_settings-Vererbung fuer consent.manage -- department_admin hat sie, ein reiner
-- editor nicht, team_manager (hier nicht angelegt) bekaeme sie ebenfalls nicht (siehe TS-Gegenstueck).
select ok(
  (select authz.has_department_permission('70000000-1100-4000-8000-000000000001', 'consent.manage')
     from (select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000002', true)) _),
  'the department admin has consent.manage in their own department'
);
select ok(
  not (select authz.has_department_permission('70000000-1100-4000-8000-000000000001', 'consent.manage')
     from (select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000003', true)) _),
  'a plain editor does not have consent.manage'
);
select ok(
  (select authz.has_organization_permission('70000000-1000-4000-8000-000000000001', 'consent.manage')
     from (select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true)) _),
  'the organization admin has consent.manage via has_organization_permission (true for every permission except billing.manage)'
);

-- 12: consent_requests -- Fremdverein kann die offene Anfrage des anderen Vereins nicht sehen.
insert into public.consent_requests (id, organization_id, department_id, directory_person_id, recipient_email, recipient_role, requested_scope, text_version, token_hash, expires_at, created_by, correlation_id) values
  ('70000000-1500-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'eltern@pgtap-consent.local', 'guardian',
   jsonb_build_object('purposes', array['social_media'], 'platforms', null, 'mediaKinds', array['photo'], 'contexts', null, 'namingAllowed', false, 'departmentIds', null),
   'default-template', encode(digest('raw-token-1', 'sha256'), 'hex'), now() + interval '14 days', '70000000-0000-4000-8000-000000000002', gen_random_uuid());
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.consent_requests where id = '70000000-1500-4000-8000-000000000001'),
  0, 'a member of a different organization cannot see the consent request via RLS'
);
set local role postgres;

-- 13: der Unique-Index consent_requests_open_unique verhindert eine zweite offene Anfrage fuer
-- dieselbe Person und Adresse.
select throws_ok(
  $$insert into public.consent_requests (organization_id, department_id, directory_person_id, recipient_email, recipient_role, requested_scope, text_version, token_hash, expires_at, created_by, correlation_id)
    values ('70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'eltern@pgtap-consent.local', 'guardian',
     '{}'::jsonb, 'default-template', encode(digest('raw-token-2', 'sha256'), 'hex'), now() + interval '14 days', '70000000-0000-4000-8000-000000000002', gen_random_uuid())$$,
  '23505', null, 'a second open request for the same person and email address violates the unique index'
);

-- 14-15: die CHECK-Kopplungen zwischen status und den davon abhaengigen Spalten.
select throws_ok(
  $$update public.consent_requests set status = 'granted' where id = '70000000-1500-4000-8000-000000000001'$$,
  '23514', null, 'status=granted without a consent_record_id violates the CHECK constraint'
);
select throws_ok(
  $$update public.consent_requests set responded_at = now() where id = '70000000-1500-4000-8000-000000000001'$$,
  '23514', null, 'status=sent with responded_at set violates the CHECK constraint'
);

-- 16: organization_consent_texts -- vereinsweit lesbar, aber nie ueber ein UPDATE veraendert
-- (nur neue Zeilen). Zwei Zeilen fuer denselben Verein sind erlaubt und stellen die Versionierung dar.
-- now() ist innerhalb einer Transaktion konstant (stable, nicht volatile) -- die ganze Testdatei
-- laeuft in einer Transaktion, deshalb hier explizite, unterschiedliche Zeitstempel statt zweimal
-- desselben default now().
insert into public.organization_consent_texts (id, organization_id, body, created_by, created_at) values
  ('70000000-1600-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', 'Erste Fassung', '70000000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  ('70000000-1600-4000-8000-000000000002', '70000000-1000-4000-8000-000000000001', 'Zweite Fassung', '70000000-0000-4000-8000-000000000001', now());
select is(
  (select body from public.organization_consent_texts where organization_id = '70000000-1000-4000-8000-000000000001' order by created_at desc limit 1),
  'Zweite Fassung', 'the most recently created text version is the current one'
);

-- 17-18: RLS-Selectability von organization_consent_texts -- vereinsweit (jede Rolle), nicht auf
-- den Fremdverein.
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.organization_consent_texts where organization_id = '70000000-1000-4000-8000-000000000001'),
  2, 'any member of the organization (here: a plain editor) can read both consent text versions'
);
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::integer from public.organization_consent_texts where organization_id = '70000000-1000-4000-8000-000000000001'),
  0, 'a member of a different organization cannot read the consent texts via RLS'
);
set local role postgres;

-- 19-20: Ein Einwilligungstext darf die Kaskade beim vollstaendigen Loeschen eines Vereins nicht
-- blockieren. Der Trigger macht Textversionen weiterhin per UPDATE unveraenderlich; DELETE
-- gehoert der organization_id-FK-Kaskade.
insert into public.organizations (id, name, slug) values
  ('70000000-1000-4000-8000-000000000003', 'PGTAP Consent Cascade Verein', 'pgtap-consent-cascade-verein');
insert into public.organization_consent_texts (id, organization_id, body, created_by) values
  ('70000000-1600-4000-8000-000000000003', '70000000-1000-4000-8000-000000000003', 'Fassung fuer die Loeschkaskade', '70000000-0000-4000-8000-000000000001');
select lives_ok(
  $$delete from public.organizations where id = '70000000-1000-4000-8000-000000000003'$$,
  'deleting an organization with an existing consent text cascades instead of being blocked by the immutability trigger'
);
select is(
  (select count(*)::integer from public.organization_consent_texts where id = '70000000-1600-4000-8000-000000000003'),
  0, 'the organization delete cascade removes the associated consent text'
);

-- 21-25: Widerrufskaskade -- die eigentliche Nutzprobe fuer den in diesem Paket behobenen Trigger.
-- Voller Beitragspfad direkt per SQL nachgestellt (keine Inhalts-Pipeline vorhanden, die das
-- end-to-end erzeugen wuerde -- dasselbe Vorgehen wie invalidate_approvals_for_media_change vorher
-- ungetestet war). post -> post_version -> media_asset -> media_derivative -> post_media
-- -> face_regions.consent_record_id -> consent_records.
insert into public.profiles (id, display_name) values ('70000000-0000-4000-8000-000000000002', 'Dept Admin') on conflict (id) do nothing;
insert into public.submissions (id, organization_id, department_id, content_type, created_by, preset_slug, communication_goal, requested_formats, source_material) values
  ('70000000-1700-4000-8000-000000000001', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', 'training', '70000000-0000-4000-8000-000000000002', 'training', 'inform', '["feed_image"]'::jsonb,
   '{"facts":{},"observations":[],"quotes":[],"forbiddenTopics":[]}'::jsonb);
insert into public.posts (id, organization_id, department_id, submission_id, status, created_by) values
  ('70000000-1700-4000-8000-000000000002', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', '70000000-1700-4000-8000-000000000001', 'awaiting_approval', '70000000-0000-4000-8000-000000000002');
insert into public.post_versions (id, organization_id, post_id, version_number, source_facts_snapshot, effective_config_snapshot, created_by_type) values
  ('70000000-1700-4000-8000-000000000003', '70000000-1000-4000-8000-000000000001', '70000000-1700-4000-8000-000000000002', 1, '{}'::jsonb, '{}'::jsonb, 'user');
update public.posts set current_version_id = '70000000-1700-4000-8000-000000000003' where id = '70000000-1700-4000-8000-000000000002';
insert into public.media_assets (id, organization_id, department_id, bucket_id, object_path, mime_type, byte_size, upload_status, scan_status, created_by) values
  ('70000000-1700-4000-8000-000000000004', '70000000-1000-4000-8000-000000000001', '70000000-1100-4000-8000-000000000001', 'raw-media', 'organizations/x/asset.jpg', 'image/jpeg', 1024, 'ready', 'clean', '70000000-0000-4000-8000-000000000002');
insert into public.face_regions (id, organization_id, media_asset_id, x, y, width, height, source, subject_kind, decision, consent_record_id) values
  ('70000000-1700-4000-8000-000000000005', '70000000-1000-4000-8000-000000000001', '70000000-1700-4000-8000-000000000004', 0.1, 0.1, 0.2, 0.2, 'manual', 'minor', 'consented', '70000000-1400-4000-8000-000000000002');
-- status='processing', nicht 'ready': media_derivative_immutable (bestehender Trigger seit
-- 202608030001) verbietet jedes Update, sobald eine Zeile einmal 'ready' war -- der Uebergang
-- unten (Test 21) muss deshalb selbst NACH 'ready' wechseln, nicht eine bereits fertige Zeile
-- anfassen.
insert into public.media_derivatives (id, organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, status) values
  ('70000000-1700-4000-8000-000000000006', '70000000-1000-4000-8000-000000000001', '70000000-1700-4000-8000-000000000004', '{}'::jsonb, 'v1', 'organizations/x/derivative.jpg', repeat('a', 64), 'image/jpeg', 512, 'processing');
insert into public.post_media (id, organization_id, post_version_id, media_derivative_id, position, role) values
  ('70000000-1700-4000-8000-000000000007', '70000000-1000-4000-8000-000000000001', '70000000-1700-4000-8000-000000000003', '70000000-1700-4000-8000-000000000006', 0, 'primary');
insert into public.approval_requests (id, organization_id, post_id, post_version_id) values
  ('70000000-1700-4000-8000-000000000008', '70000000-1000-4000-8000-000000000001', '70000000-1700-4000-8000-000000000002', '70000000-1700-4000-8000-000000000003');
insert into public.social_connections (id, organization_id, platform, external_account_id, display_name) values
  ('70000000-1700-4000-8000-000000000009', '70000000-1000-4000-8000-000000000001', 'instagram', 'ext-1', 'Verein-Account');
insert into public.publications (id, organization_id, post_version_id, social_connection_id, platform, status, idempotency_key) values
  ('70000000-1700-4000-8000-00000000000a', '70000000-1000-4000-8000-000000000001', '70000000-1700-4000-8000-000000000003', '70000000-1700-4000-8000-000000000009', 'instagram', 'queued', 'publish:test:1');

-- 21: der zuvor kaputte Bugfix-Trigger laeuft jetzt ohne Fehler durch (Uebergang auf 'ready'),
-- statt mit "record 'new' has no field 'media_derivative_id'" abzubrechen.
update public.media_derivatives set status = 'ready', ready_at = now() where id = '70000000-1700-4000-8000-000000000006';
select ok(true, 'transitioning a media derivative to ready no longer crashes the pre-existing invalidate_approvals_for_media_change trigger (bugfix)');
select isnt(
  (select invalidated_at from public.approval_requests where id = '70000000-1700-4000-8000-000000000008'),
  null, 'the fixed trigger actually invalidates the approval request tied to the changed derivative'
);

-- Zuruecksetzen, damit die eigentliche Widerrufskaskade unten unabhaengig geprueft werden kann.
update public.approval_requests set invalidated_at = null where id = '70000000-1700-4000-8000-000000000008';

-- 22-25: Widerruf der ueber face_regions verknuepften Einwilligung loest die volle Kaskade aus:
-- approval_requests invalidiert, posts auf changes_requested, publications auf cancelled.
update public.consent_records set revoked_at = now(), revoked_by = 'organization' where id = '70000000-1400-4000-8000-000000000002';
select isnt(
  (select invalidated_at from public.approval_requests where id = '70000000-1700-4000-8000-000000000008'),
  null, 'revoking the linked consent invalidates the open approval request'
);
select is(
  (select status::text from public.posts where id = '70000000-1700-4000-8000-000000000002'),
  'changes_requested', 'revoking the linked consent moves the awaiting_approval post to changes_requested'
);
select is(
  (select status from public.publications where id = '70000000-1700-4000-8000-00000000000a'),
  'cancelled', 'revoking the linked consent cancels the queued publication'
);
select is(
  (select revoked_at from public.consent_records where id = '70000000-1400-4000-8000-000000000001'),
  null, 'the already-superseded predecessor is untouched by revoking its successor -- the cascade only follows face_regions, not the supersession chain'
);

-- 26: ein zweiter Widerruf derselben Zeile (revoked_at bereits gesetzt) loest den Trigger nicht
-- erneut aus (WHEN-Klausel: old.revoked_at is distinct from new.revoked_at).
update public.publications set status = 'queued' where id = '70000000-1700-4000-8000-00000000000a';
update public.approval_requests set invalidated_at = null where id = '70000000-1700-4000-8000-000000000008';
update public.consent_records set revocation_reason = 'erneute Aktualisierung' where id = '70000000-1400-4000-8000-000000000002';
select is(
  (select invalidated_at from public.approval_requests where id = '70000000-1700-4000-8000-000000000008'),
  null, 'updating an already-revoked consent record without changing revoked_at does not re-trigger the cascade'
);

set local role postgres;

-- 27-28: Loeschverhalten der Ablosungskette -- eigene, frische Zeilen statt der oben schon in
-- die Widerrufskaskade verwickelten ...0001/...0002 (die haengt inzwischen an face_regions und
-- ist nicht mehr loeschbar, ohne diese erst zu entfernen).
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, signer_role, guardian_confirmed, signed_at, evidence_path, created_by) values
  ('70000000-1400-4000-8000-000000000004', '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000002', '70000000-1300-4000-8000-000000000002', 'Vorgaenger fuer den Loeschtest', 'self', false, current_date, 'x', '70000000-0000-4000-8000-000000000002'),
  ('70000000-1400-4000-8000-000000000005', '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000002', '70000000-1300-4000-8000-000000000002', 'Nachfolger fuer den Loeschtest', 'self', false, current_date, 'x', '70000000-0000-4000-8000-000000000002');
update public.consent_records set superseded_by = '70000000-1400-4000-8000-000000000005' where id = '70000000-1400-4000-8000-000000000004';
delete from public.consent_records where id = '70000000-1400-4000-8000-000000000005';
select is(
  (select row(superseded_by, organization_id) from public.consent_records where id = '70000000-1400-4000-8000-000000000004'),
  row(null::uuid, '70000000-1000-4000-8000-000000000001'::uuid),
  'deleting the successor sets superseded_by to null on the predecessor -- organization_id survives'
);

-- 29: eine Einwilligung mit erteilter Anfrage ist nicht loeschbar (restrict).
insert into public.consent_records (id, organization_id, directory_person_id, pseudonymous_subject_ref, scope, scope_structured, origin, signer_role, guardian_confirmed, signed_at, evidence_path, revocation_token_hash, created_by) values
  ('70000000-1400-4000-8000-000000000003', '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', '70000000-1300-4000-8000-000000000001', 'digital erteilt',
   jsonb_build_object('purposes', array['social_media'], 'platforms', null, 'mediaKinds', array['photo'], 'contexts', null, 'namingAllowed', false, 'departmentIds', null),
   'digital', 'guardian', true, current_date, 'digital-consent-requests/x', encode(digest('revocation-raw', 'sha256'), 'hex'), '70000000-0000-4000-8000-000000000002');
update public.consent_requests set status = 'granted', responded_at = now(), consent_record_id = '70000000-1400-4000-8000-000000000003' where id = '70000000-1500-4000-8000-000000000001';
select throws_ok(
  $$delete from public.consent_records where id = '70000000-1400-4000-8000-000000000003'$$,
  '23503', null, 'a consent record referenced by a granted consent request cannot be deleted (restrict)'
);

-- 30: revocation_token_hash ist eindeutig ueber die ganze Tabelle.
select throws_ok(
  format($$insert into public.consent_records (organization_id, directory_person_id, pseudonymous_subject_ref, scope, origin, signer_role, guardian_confirmed, signed_at, evidence_path, revocation_token_hash, created_by)
    values (%L, %L, %L, 'x', 'digital', 'guardian', true, current_date, 'x', %L, '70000000-0000-4000-8000-000000000002')$$,
    '70000000-1000-4000-8000-000000000001', '70000000-1300-4000-8000-000000000002', '70000000-1300-4000-8000-000000000002', encode(digest('revocation-raw', 'sha256'), 'hex')),
  '23505', null, 'revocation_token_hash must be unique across the whole table'
);

select * from finish();
rollback;
