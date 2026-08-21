begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

set local role postgres;

-- Zwei Vereine mit je einer Abteilung, damit die Mandantentrennung und die
-- department_id-Herleitung (aelteste Abteilung des Vereins) beide geprueft werden koennen.
-- Verein 1 bekommt zusaetzlich eine zweite Abteilung fuer die Paket-049-Faelle (zwei
-- Abteilungs-Jobs muessen sich nicht gegenseitig blockieren, ein Abteilungs-Admin sieht nur den
-- Job der eigenen Abteilung).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'org-admin@pgtap-analysis.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'plain-member@pgtap-analysis.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'fremdverein-admin@pgtap-analysis.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '68000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'department-admin@pgtap-analysis.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('68000000-1000-4000-8000-000000000001', 'PGTAP Analysis Verein', 'pgtap-analysis-verein'),
  ('68000000-1000-4000-8000-000000000002', 'PGTAP Analysis Fremdverein', 'pgtap-analysis-fremdverein');
insert into public.departments (id, organization_id, name, slug) values
  ('68000000-1100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000001', 'Vorstand', 'vorstand'),
  ('68000000-1100-4000-8000-000000000002', '68000000-1000-4000-8000-000000000001', 'Jugend', 'jugend'),
  ('68000000-2100-4000-8000-000000000001', '68000000-1000-4000-8000-000000000002', 'Fremdabteilung', 'fremdabteilung');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', 'organization_admin'),
  ('68000000-1000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002', 'organization_viewer'),
  ('68000000-1000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000003', 'organization_admin');
insert into public.department_memberships (organization_id, department_id, user_id, role) values
  ('68000000-1000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000002', '68000000-0000-4000-8000-000000000004', 'department_admin');

-- 1: RLS ist erzwungen, auch fuer den Tabelleneigentuemer.
select is((select relforcerowsecurity from pg_class where oid = 'public.brand_website_analysis_jobs'::regclass), true,
  'brand_website_analysis_jobs has FORCE ROW LEVEL SECURITY enabled');

-- 2: requested_by muss Mitglied des Zielvereins sein -- ein Profil eines fremden Vereins wird
-- abgelehnt, statt die Analyse dieser Zeile zuzuordnen.
select throws_ok(
  $$select public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://verein.example.org', '68000000-0000-4000-8000-000000000003')$$,
  'P0001', 'requested_by_not_organization_member', 'a profile without membership in the target organization is rejected as requested_by'
);

-- 3: die RPC leitet die Abteilung her und legt Job + Outbox-Eintrag an.
select is(
  (public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://verein.example.org', '68000000-0000-4000-8000-000000000001') ->> 'jobId') is not null,
  true, 'start_brand_website_analysis returns a jobId'
);
select is((select status from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 'pending',
  'the created job starts in pending status');
select is((select revision from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 1,
  'the first analysis run has revision 1');
select is((select count(*)::integer from public.workflow_outbox where workflow_name = 'analyze-website-branding' and organization_id = '68000000-1000-4000-8000-000000000001'), 1,
  'exactly one workflow_outbox row is created for the analysis job');
select is((select department_id from public.workflow_outbox where workflow_name = 'analyze-website-branding' and organization_id = '68000000-1000-4000-8000-000000000001'),
  '68000000-1100-4000-8000-000000000001', 'the outbox row carries the organization''s (only) department as its technical carrier');

-- 4: ein zweiter, sequenzieller Aufruf, waehrend der Job noch laeuft, wird abgelehnt statt ihn zu
-- duplizieren. Das ist kein Test der Race selbst (zwei tatsaechlich ueberlappende Transaktionen
-- braeuchten dblink o.ae., ein Muster, das diese Suite bewusst vermeidet, siehe
-- text_workshop_foundation.test.sql beim Kommentar zu claim_stalled_generation_candidates) --
-- die schliesst stattdessen der Advisory-Lock in start_brand_website_analysis selbst.
select throws_ok(
  $$select public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://verein.example.org', '68000000-0000-4000-8000-000000000001')$$,
  'P0001', 'analysis_in_progress', 'a second trigger while the job is still pending is rejected'
);

-- 5: nach Abschluss ueberschreibt ein neuer Lauf denselben Job (keine Historie) und erhoeht die Revision.
update public.brand_website_analysis_jobs set status = 'succeeded' where organization_id = '68000000-1000-4000-8000-000000000001';
select public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://verein.example.org/neu', '68000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 1,
  'a repeated analysis overwrites the same row instead of creating a history');
select is((select revision from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 2,
  'the repeated analysis run increments the revision');
select is((select count(*)::integer from public.workflow_outbox where workflow_name = 'analyze-website-branding' and organization_id = '68000000-1000-4000-8000-000000000001'), 2,
  'the second run inserts its own outbox row (distinct source_revision keeps the unique constraint satisfied)');

-- 6-7: keine Schreibrechte fuer authenticated -- nur der Weg ueber die RPC/den Worker.
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into public.brand_website_analysis_jobs (organization_id, website_url, requested_by)
    values ('68000000-1000-4000-8000-000000000001', 'https://verein.example.org', '68000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot insert into brand_website_analysis_jobs directly, even with organization.manage'
);
select throws_ok(
  $$select public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://verein.example.org', '68000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated cannot call start_brand_website_analysis directly -- only service_role may'
);

-- 8-10: Sichtbarkeit -- nur wer organization.manage hat, sieht den Job; kein Fremdverein.
select is((select count(*)::integer from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 1,
  'the organization admin sees their own club''s analysis job');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'a plain organization member without organization.manage does not see the analysis job');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 0,
  'a member of another club reads no analysis job row of this club');

-- 11-20 (Paket 049): eigene Jobs pro Abteilung, unabhaengig vom Vereins-Job und von anderen
-- Abteilungen. Der Vereins-Job aus Test 5 steht zu diesem Zeitpunkt auf 'succeeded', revision 2.
set local role postgres;

select is(
  (public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://jugend.example.org', '68000000-0000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000002') ->> 'jobId') is not null,
  true, 'a department-scoped analysis returns a jobId'
);
select is((select status from public.brand_website_analysis_jobs where department_id = '68000000-1100-4000-8000-000000000002'), 'pending',
  'the department-scoped job starts in pending status');
select is(
  (select department_id from public.workflow_outbox where workflow_name = 'analyze-website-branding'
    and entity_id = (select id from public.brand_website_analysis_jobs where department_id = '68000000-1100-4000-8000-000000000002')),
  '68000000-1100-4000-8000-000000000002', 'the outbox row carries the REAL department_id, not the organization''s oldest-department fallback'
);
-- Revision statt Status: Test 5 hat den Vereins-Job zuvor selbst erneut gestartet (revision 2,
-- status wieder 'pending' -- ein neuer Lauf setzt das immer zurueck). Die Prüfung hier gilt der
-- Unabhaengigkeit von der Abteilung, nicht dem an anderer Stelle bereits getesteten Vereinslauf.
select is((select revision from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001' and department_id is null), 2,
  'the organization''s own job stays untouched by an independent department-scoped run');
select throws_ok(
  $$select public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://jugend.example.org', '68000000-0000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000002')$$,
  'P0001', 'analysis_in_progress', 'a second trigger for the same department while its job is still pending is rejected'
);
select is(
  (public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://vorstand.example.org', '68000000-0000-4000-8000-000000000001', '68000000-1100-4000-8000-000000000001') ->> 'jobId') is not null,
  true, 'a pending job in one department does not block starting an analysis for a sibling department'
);
select is((select count(*)::integer from public.brand_website_analysis_jobs where organization_id = '68000000-1000-4000-8000-000000000001'), 3,
  'the organization now has three independent job rows: its own, and one per department');
select throws_ok(
  $$select public.start_brand_website_analysis('68000000-1000-4000-8000-000000000001', 'https://fremd.example.org', '68000000-0000-4000-8000-000000000001', '68000000-2100-4000-8000-000000000001')$$,
  'P0001', 'department_not_in_organization', 'a department belonging to a different organization is rejected'
);

-- RLS: nur wer brand.manage in GENAU dieser Abteilung hat, sieht ihren Job -- nicht den
-- Vereins-Job und nicht den einer Schwesterabteilung.
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.brand_website_analysis_jobs), 1,
  'a department admin sees exactly one job -- their own department''s, not the organization''s or a sibling department''s');
select is((select department_id from public.brand_website_analysis_jobs limit 1), '68000000-1100-4000-8000-000000000002',
  'the one visible row belongs to the department admin''s own department');

select * from finish();
rollback;
