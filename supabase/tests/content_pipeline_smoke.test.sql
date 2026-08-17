begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Smoke-Test fuer die volle Inhalts-Pipeline gegen echtes Postgres, nicht nur gemockte
-- HTTP-Routen (apps/api/src/content.routes.test.ts) oder isolierte RPC-Faelle (die uebrigen
-- Dateien in diesem Verzeichnis). Bis PR #96 gab es keinen einzigen Testlauf, der
-- create_text_generation_session -> accept_text_generation_candidate -> request_approval ->
-- decide_approval_stage als EINE zusammenhaengende Geschichte durchspielt -- genau die Kette, die
-- die Beitraege-Liste/Textwerkstatt jetzt wirklich ausloest. decide_approval_stage('rejected', ...)
-- hatte laut Kommentar in 2026081002_review_route_reresolution.sql sogar schon einmal einen
-- SQL-Typfehler, der nur deshalb unbemerkt blieb, weil kein Test ihn gegen echtes Postgres ausfuehrte.

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'autor@pgtap-pipeline.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pruefer@pgtap-pipeline.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('90000000-1000-4000-8000-000000000001', 'PGTAP Pipeline Verein', 'pgtap-pipeline-verein');
-- Zwei Abteilungen statt einer: eine ohne Freigabe-Richtlinie (Szenario A, direkt veroeffentlichen)
-- und eine mit benannter Pruefperson (Szenario B/C) -- policy_settings erlaubt je Abteilung nur
-- eine Zeile, ein Umschalten mitten im Test waere fragiler als zwei feste Abteilungen.
insert into public.departments (id, organization_id, name, slug) values
  ('90000000-1100-4000-8000-000000000001', '90000000-1000-4000-8000-000000000001', 'Ohne Freigabepflicht', 'ohne-freigabepflicht'),
  ('90000000-1100-4000-8000-000000000002', '90000000-1000-4000-8000-000000000001', 'Mit Freigabepflicht', 'mit-freigabepflicht');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('90000000-1000-4000-8000-000000000001', '90000000-1100-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'editor'),
  ('90000000-1000-4000-8000-000000000001', '90000000-1100-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'editor'),
  ('90000000-1000-4000-8000-000000000001', '90000000-1100-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'approver');

insert into public.llm_provider_configurations (id, label, protocol, base_url, model) values
  ('90000000-4000-4000-8000-000000000001', 'Pipeline Smoke Provider', 'openai', 'https://provider.example.test', 'smoke-test-model');

-- Kein policy_settings-Eintrag fuer die erste Abteilung: ohne jede konfigurierte Regel ist
-- any_review_required=false und resolve_review_route liefert null Stufen (Plan 011 Standard:
-- keine Richtlinie -> keine Pflichtpruefung). Die zweite Abteilung verlangt eine benannte Stufe,
-- exakt das Muster aus supabase/tests/review_route_reresolution.test.sql.
insert into public.policy_settings (organization_id, scope, department_id, review_required, review_mode, review_stage_label, updated_by) values
  ('90000000-1000-4000-8000-000000000001', 'department', '90000000-1100-4000-8000-000000000002', true, 'named', 'Pruefung', '90000000-0000-4000-8000-000000000001');
insert into public.policy_reviewers (organization_id, policy_settings_id, kind, user_id, created_by) values
  ('90000000-1000-4000-8000-000000000001',
   (select id from public.policy_settings where organization_id = '90000000-1000-4000-8000-000000000001' and department_id = '90000000-1100-4000-8000-000000000002'),
   'user', '90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001');

-- accept_text_generation_candidate liest nur headline/caption/callToAction/hashtags/altText/
-- safetyFlags aus generated_content, mehr braucht die DB-Seite nicht (das vollstaendigere
-- GeneratedPostSchema gilt erst an der API-Antwort, siehe content.routes.test.ts) -- dasselbe
-- Objekt fuer alle drei Szenarien.

-- ===========================================================================================
-- Szenario A: Beitrag erstellen und OHNE Pruefperson direkt veroeffentlichen.
-- ===========================================================================================
select lives_ok(
  $$select public.create_text_generation_session(
    '90000000-1000-4000-8000-000000000001', '90000000-1100-4000-8000-000000000001', null,
    'training-update', 'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Training A"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{"name":"System","description":"","styleRules":{"toneTags":["klar"],"catchphrases":[],"examples":[],"additionalInstructions":""},"avoidRules":[],"doRules":[]}'::jsonb,
    '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('pipeline-smoke-a'::bytea), 'hex'), encode(sha256('pipeline-smoke-a-candidate'::bytea), 'hex'), 'initial', null,
    '90000000-0000-4000-8000-000000000001', gen_random_uuid(), 'pipeline-smoke-a'
  )$$,
  'creating a text-workshop session for a post without a review policy succeeds'
);
select id as session_a_id from public.composition_sessions where input_hash = encode(sha256('pipeline-smoke-a'::bytea), 'hex') \gset
select id as candidate_a_id from public.generation_candidates where composition_session_id = :'session_a_id' \gset

-- Der Worker ist hier kein Teilnehmer (kein LLM-Provider lokal konfiguriert): direktes Setzen auf
-- 'ready' simuliert genau das, was mark_generation_candidate_ready sonst am Ende der Lease
-- schreibt (dessen Fencing-Mechanik ist bereits in text_workshop_foundation.test.sql abgedeckt).
update public.generation_candidates set
  status = 'ready',
  generated_content = '{"headline":"Training","caption":"Heute stand Passtraining auf dem Programm.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Trainingsfoto","safetyFlags":[]}'::jsonb,
  provider_configuration_id = '90000000-4000-4000-8000-000000000001', provider_model_id = 'smoke-test-model',
  provider_parameter_hash = encode(sha256('pipeline-smoke-params'::bytea), 'hex'), prompt_template_version = 'v1'
where id = :'candidate_a_id';

select result->>'postId' as post_a_id, result->>'postVersionId' as version_a_id
from (select public.accept_text_generation_candidate(:'candidate_a_id', '90000000-0000-4000-8000-000000000001') as result) rpc \gset
select is(
  (select status::text from public.posts where id = :'post_a_id'),
  'draft_ready', 'accepting the candidate creates the post as draft_ready, exactly like erstellen.vue''s acceptCandidate() step'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);
select is(
  (select rpc.result->>'status' from (select public.request_approval(:'version_a_id') as result) rpc),
  'approved', 'request_approval publishes immediately when no department/organization requires review'
);
set local role postgres;
select is(
  (select status::text from public.posts where id = :'post_a_id'),
  'approved', 'the post itself is approved without any approval_requests row'
);
select is(
  (select count(*)::integer from public.approval_requests where post_id = :'post_a_id'),
  0, 'no approval_requests row was created for the auto-approved post'
);

-- ===========================================================================================
-- Szenario B: Beitrag erstellen, zur Freigabe einreichen, Pruefperson nimmt an.
-- ===========================================================================================
set local role postgres;
select lives_ok(
  $$select public.create_text_generation_session(
    '90000000-1000-4000-8000-000000000001', '90000000-1100-4000-8000-000000000002', null,
    'training-update', 'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Training B"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{"name":"System","description":"","styleRules":{"toneTags":["klar"],"catchphrases":[],"examples":[],"additionalInstructions":""},"avoidRules":[],"doRules":[]}'::jsonb,
    '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('pipeline-smoke-b'::bytea), 'hex'), encode(sha256('pipeline-smoke-b-candidate'::bytea), 'hex'), 'initial', null,
    '90000000-0000-4000-8000-000000000001', gen_random_uuid(), 'pipeline-smoke-b'
  )$$,
  'creating a text-workshop session for a post with a review policy succeeds'
);
select id as session_b_id from public.composition_sessions where input_hash = encode(sha256('pipeline-smoke-b'::bytea), 'hex') \gset
select id as candidate_b_id from public.generation_candidates where composition_session_id = :'session_b_id' \gset
update public.generation_candidates set
  status = 'ready',
  generated_content = '{"headline":"Training","caption":"Heute stand Passtraining auf dem Programm.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Trainingsfoto","safetyFlags":[]}'::jsonb,
  provider_configuration_id = '90000000-4000-4000-8000-000000000001', provider_model_id = 'smoke-test-model',
  provider_parameter_hash = encode(sha256('pipeline-smoke-params'::bytea), 'hex'), prompt_template_version = 'v1'
where id = :'candidate_b_id';
select result->>'postId' as post_b_id, result->>'postVersionId' as version_b_id
from (select public.accept_text_generation_candidate(:'candidate_b_id', '90000000-0000-4000-8000-000000000001') as result) rpc \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);
select is(
  (select rpc.result->>'status' from (select public.request_approval(:'version_b_id') as result) rpc),
  'awaiting_approval', 'request_approval submits the post for review when the department requires it'
);
set local role postgres;
select is(
  (select (reviewer_snapshot->0->>'userId')::uuid from public.approval_stages
    where approval_request_id = (select id from public.approval_requests where post_version_id = :'version_b_id')),
  '90000000-0000-4000-8000-000000000002'::uuid,
  'the created stage names exactly the configured reviewer'
);
select id as stage_b_id from public.approval_stages
  where approval_request_id = (select id from public.approval_requests where post_version_id = :'version_b_id') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
select public.decide_approval_stage(:'stage_b_id', 'approved', null);
set local role postgres;
select is(
  (select status::text from public.posts where id = :'post_b_id'),
  'approved', 'the post is approved once its single required stage is decided'
);
select is(
  (select decision::text from public.approval_decisions where approval_stage_id = :'stage_b_id'),
  'approved', 'the approval decision is recorded as approved'
);

-- ===========================================================================================
-- Szenario C: Beitrag erstellen, zur Freigabe einreichen, Pruefperson lehnt ab.
-- ===========================================================================================
set local role postgres;
select lives_ok(
  $$select public.create_text_generation_session(
    '90000000-1000-4000-8000-000000000001', '90000000-1100-4000-8000-000000000002', null,
    'training-update', 'inform', '["text_post"]'::jsonb,
    '{"facts":{"title":"Training C"},"observations":[],"quotes":[],"doNotMention":[]}'::jsonb,
    null, '{"name":"System","description":"","styleRules":{"toneTags":["klar"],"catchphrases":[],"examples":[],"additionalInstructions":""},"avoidRules":[],"doRules":[]}'::jsonb,
    '{}'::jsonb, array['instagram']::text[], 2200, 0.6, 1,
    encode(sha256('pipeline-smoke-c'::bytea), 'hex'), encode(sha256('pipeline-smoke-c-candidate'::bytea), 'hex'), 'initial', null,
    '90000000-0000-4000-8000-000000000001', gen_random_uuid(), 'pipeline-smoke-c'
  )$$,
  'creating a third text-workshop session for the rejection scenario succeeds'
);
select id as session_c_id from public.composition_sessions where input_hash = encode(sha256('pipeline-smoke-c'::bytea), 'hex') \gset
select id as candidate_c_id from public.generation_candidates where composition_session_id = :'session_c_id' \gset
update public.generation_candidates set
  status = 'ready',
  generated_content = '{"headline":"Training","caption":"Heute stand Passtraining auf dem Programm.","callToAction":"Kommt vorbei","hashtags":["#training"],"altText":"Trainingsfoto","safetyFlags":[]}'::jsonb,
  provider_configuration_id = '90000000-4000-4000-8000-000000000001', provider_model_id = 'smoke-test-model',
  provider_parameter_hash = encode(sha256('pipeline-smoke-params'::bytea), 'hex'), prompt_template_version = 'v1'
where id = :'candidate_c_id';
select result->>'postId' as post_c_id, result->>'postVersionId' as version_c_id
from (select public.accept_text_generation_candidate(:'candidate_c_id', '90000000-0000-4000-8000-000000000001') as result) rpc \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);
select public.request_approval(:'version_c_id');
select id as stage_c_id from public.approval_stages
  where approval_request_id = (select id from public.approval_requests where post_version_id = :'version_c_id') \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', true);
select public.decide_approval_stage(:'stage_c_id', 'rejected', 'Bitte die Angaben belegen.');
set local role postgres;
-- Regression: 2026081002_review_route_reresolution.sql dokumentiert einen SQL-Typfehler, der jede
-- Ablehnung/Aenderungsanfrage seit Paket 011 unbemerkt scheitern liess, weil kein Test
-- decide_approval_stage('rejected', ...) gegen echtes Postgres ausfuehrte -- dieser Fall hier tut das.
select is(
  (select status::text from public.posts where id = :'post_c_id'),
  'cancelled', 'a rejected single-stage post ends up cancelled, not stuck awaiting_approval'
);
select is(
  (select status::text from public.approval_stages where id = :'stage_c_id'),
  'rejected', 'the decided stage itself is marked rejected'
);
select is(
  (select decision::text from public.approval_decisions where approval_stage_id = :'stage_c_id'),
  'rejected', 'the rejection decision is recorded with its reason'
);

select * from finish();
rollback;
