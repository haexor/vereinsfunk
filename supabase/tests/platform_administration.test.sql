begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

set local role postgres;

-- Test personas. handle_new_user() (2026080401_auth_bootstrap.sql) mirrors each auth.users
-- row into public.profiles automatically -- platform_admins.user_id references profiles(id),
-- so no separate profiles insert is needed here.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'defaultadmin@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'secondadmin@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'quotaowner@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'operator@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'clubmember@pgtap-platform.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'deptadmin@pgtap-platform.local', '', '{}', '{}', now(), now());

-- 1-2: authenticated has no privilege at all on platform_admins -- denied before RLS is even
-- evaluated (no GRANT was issued to authenticated/anon anywhere in the migration).
set local role authenticated;
select throws_ok(
  $$select * from public.platform_admins$$,
  '42501', null, 'authenticated cannot select from platform_admins'
);
select throws_ok(
  $$insert into public.platform_admins (user_id) values ('50000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'authenticated cannot insert into platform_admins'
);
set local role postgres;

-- 3-4: bootstrap_platform_admin
select throws_ok(
  $$select public.bootstrap_platform_admin('unknown@pgtap-platform.local')$$,
  'P0001', null, 'bootstrap_platform_admin rejects an unknown email'
);
select lives_ok(
  $$select public.bootstrap_platform_admin('defaultadmin@pgtap-platform.local')$$,
  'bootstrap_platform_admin succeeds for a known email'
);

-- 5: the created row is actually the default admin.
select is(
  (select is_default_admin from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000001'),
  true, 'the bootstrapped admin is the default admin'
);

-- 6: calling bootstrap again is a no-op (idempotent) -- still exactly one default admin.
select lives_ok(
  $$select public.bootstrap_platform_admin('secondadmin@pgtap-platform.local')$$,
  'a second bootstrap call does not raise'
);
select is(
  (select count(*)::integer from public.platform_admins where is_default_admin),
  1, 'still exactly one default admin after a second bootstrap call'
);
select is(
  (select count(*)::integer from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'),
  0, 'the second bootstrap call did not add secondadmin as a (non-default) admin either'
);

-- 7: the partial unique index rejects a second default admin, even inserted directly.
select throws_ok(
  $$insert into public.platform_admins (user_id, is_default_admin) values ('50000000-0000-4000-8000-000000000002', true)$$,
  '23505', null, 'a second default admin violates the partial unique index'
);

-- 8-10: add_platform_admin
select throws_ok(
  $$select public.add_platform_admin('unknown@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'P0001', null, 'add_platform_admin rejects an unknown email'
);
select lives_ok(
  $$select public.add_platform_admin('secondadmin@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'add_platform_admin succeeds for a known email'
);
select is(
  (select created_by from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'),
  '50000000-0000-4000-8000-000000000001', 'the new admin records who added it'
);
select lives_ok(
  $$select public.add_platform_admin('secondadmin@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'calling add_platform_admin again for the same email does not raise (on conflict do nothing)'
);
select is(
  (select count(*)::integer from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'),
  1, 'still exactly one row for the same admin after the repeated call'
);

-- 11-12: the default admin cannot be deleted, a non-default admin can.
select throws_ok(
  $$delete from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'deleting the default admin is rejected'
);
select lives_ok(
  $$delete from public.platform_admins where user_id = '50000000-0000-4000-8000-000000000002'$$,
  'deleting a non-default admin succeeds'
);

-- 13: platform_settings has no privilege for authenticated either.
set local role authenticated;
select throws_ok(
  $$select * from public.platform_settings$$,
  '42501', null, 'authenticated cannot select from platform_settings'
);
set local role postgres;

-- 14: the seeded default limit is present.
select is(
  (select (value::text)::integer from public.platform_settings where key = 'max_organizations_per_owner'),
  3, 'the seeded max_organizations_per_owner default is 3'
);

-- 15-16: create_organization() actually reads platform_settings, not a hardcoded constant --
-- lowering the limit to 1 blocks a second organization for a fresh owner.
update public.platform_settings set value = '1'::jsonb where key = 'max_organizations_per_owner';
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000003', true);
select isnt(
  public.create_organization('PGTAP Platform Quota Org A', 'Abteilung'),
  null, 'the first organization succeeds under a lowered limit of 1'
);
select throws_ok(
  $$select public.create_organization('PGTAP Platform Quota Org B', 'Abteilung')$$,
  'P0001', null, 'a second organization fails once platform_settings lowers the limit to 1'
);
set local role postgres;
update public.platform_settings set value = '3'::jsonb where key = 'max_organizations_per_owner';

-- 17-18: llm_provider_configurations / llm_provider_secrets have no privilege for authenticated.
set local role authenticated;
select throws_ok(
  $$select * from public.llm_provider_configurations$$,
  '42501', null, 'authenticated cannot select from llm_provider_configurations'
);
select throws_ok(
  $$select * from public.llm_provider_secrets$$,
  '42501', null, 'authenticated cannot select from llm_provider_secrets'
);
set local role postgres;

-- 19: llm_provider_secrets actually has FORCE ROW LEVEL SECURITY set (structural regression
-- guard -- in this local, superuser-owned test harness FORCE cannot be demonstrated
-- behaviorally, since superusers always bypass RLS regardless; see plan document).
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.llm_provider_secrets'::regclass),
  'llm_provider_secrets has FORCE ROW LEVEL SECURITY enabled'
);

-- 20: postgres CRUD smoke on llm_provider_configurations + llm_provider_secrets.
select lives_ok(
  $$with cfg as (
      insert into public.llm_provider_configurations (label, protocol, base_url, model)
                  values ('PGTAP Test Provider', 'openai', 'https://example.invalid', 'openai-test')
      returning id
    )
    insert into public.llm_provider_secrets (llm_provider_configuration_id, api_key_ciphertext, key_version)
    select id, '\x00', 'v1' from cfg$$,
  'postgres can insert an llm provider configuration with its secret row'
);

-- 21-26: Betreiber und Vereinsmitglied schliessen sich gegenseitig aus
-- (2026080602_platform_admin_separation.sql). Eigene Fixtur statt der Quota-Organisation
-- oben, damit diese Gruppe unabhaengig von der Reihenfolge der Tests davor bleibt.
insert into public.organizations (id, name, slug)
  values ('50000000-1000-4000-8000-000000000001', 'PGTAP Separation Org', 'pgtap-separation-org');
insert into public.departments (id, organization_id, name, slug)
  values ('50000000-1100-4000-8000-000000000001', '50000000-1000-4000-8000-000000000001', 'Abteilung', 'abteilung');
insert into public.teams (id, organization_id, department_id, name)
  values ('50000000-1200-4000-8000-000000000001', '50000000-1000-4000-8000-000000000001', '50000000-1100-4000-8000-000000000001', 'Mannschaft');

select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role)
    values ('50000000-1000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'organization_viewer')$$,
  'P0001', 'platform_admin_cannot_hold_membership', 'a platform admin cannot become an organization member'
);
select throws_ok(
  $$insert into public.department_memberships (organization_id, department_id, user_id, role)
    values ('50000000-1000-4000-8000-000000000001', '50000000-1100-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'viewer')$$,
  'P0001', 'platform_admin_cannot_hold_membership', 'a platform admin cannot become a department member'
);
select throws_ok(
  $$insert into public.team_memberships (organization_id, department_id, team_id, user_id, role)
    values ('50000000-1000-4000-8000-000000000001', '50000000-1100-4000-8000-000000000001', '50000000-1200-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'viewer')$$,
  'P0001', 'platform_admin_cannot_hold_membership', 'a platform admin cannot become a team member'
);

-- Gegenrichtung: quotaowner besitzt seit Test 15 eine Vereinsmitgliedschaft.
select throws_ok(
  $$select public.add_platform_admin('quotaowner@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'member_cannot_become_platform_admin', 'an organization member cannot be made a platform admin'
);

-- Kontrollen, damit die Trigger nicht pauschal blockieren.
select lives_ok(
  $$select public.add_platform_admin('operator@pgtap-platform.local', '50000000-0000-4000-8000-000000000001')$$,
  'a user without any membership can still be made a platform admin'
);
select lives_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role)
    values ('50000000-1000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', 'organization_viewer')$$,
  'a user who is not a platform admin can still become an organization member'
);

-- 27-28: derselbe Trigger auf dem Weg, den die App tatsaechlich nimmt. POST /v1/memberships
-- schreibt mit dem Nutzer-Client direkt in die Tabelle (Policy department_memberships_insert),
-- also als Rolle authenticated -- und die hat auf platform_admins bewusst kein Privileg. Ohne
-- security definer scheitert dort JEDER Mitgliedschafts-Insert an 42501, unabhaengig davon, wer
-- eingetragen wird; die Tests oben laufen als postgres und sehen das nicht.
insert into public.department_memberships (organization_id, department_id, user_id, role)
  values ('50000000-1000-4000-8000-000000000001', '50000000-1100-4000-8000-000000000001', '50000000-0000-4000-8000-000000000006', 'department_admin');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$insert into public.department_memberships (organization_id, department_id, user_id, role)
    values ('50000000-1000-4000-8000-000000000001', '50000000-1100-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'viewer')$$,
  'P0001', 'platform_admin_cannot_hold_membership', 'a department_admin cannot add a platform admin as a member'
);
select lives_ok(
  $$insert into public.department_memberships (organization_id, department_id, user_id, role)
    values ('50000000-1000-4000-8000-000000000001', '50000000-1100-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', 'viewer')$$,
  'a department_admin can still add a regular member as authenticated'
);
set local role postgres;

-- 29: count_platform_admin_organization_totals hat kein Privileg fuer authenticated -- dieselbe
-- Begruendung wie bei count_publications_for_quotas: ein Grant an authenticated legte Mitglieder-/
-- Abteilungszahlen fremder Vereine offen.
set local role authenticated;
select throws_ok(
  $$select * from public.count_platform_admin_organization_totals(array['50000000-1000-4000-8000-000000000001']::uuid[])$$,
  '42501', null, 'authenticated cannot call count_platform_admin_organization_totals directly'
);
set local role postgres;

-- 30-31: liefert die tatsaechliche Mitglieder-/Abteilungszahl der Separation-Org (1 Mitgliedschaft
-- aus organization_memberships, 1 Abteilung aus departments, siehe Fixtur oben) statt einer der
-- beiden Zeilenzahlen aus dem falschen der beiden LEFT JOINs.
select is(
  (select member_count from public.count_platform_admin_organization_totals(
    array['50000000-1000-4000-8000-000000000001', '50000000-9999-4000-8000-000000000099']::uuid[]
  ) where organization_id = '50000000-1000-4000-8000-000000000001'),
  1, 'count_platform_admin_organization_totals reports the actual member count'
);
select is(
  (select department_count from public.count_platform_admin_organization_totals(
    array['50000000-1000-4000-8000-000000000001', '50000000-9999-4000-8000-000000000099']::uuid[]
  ) where organization_id = '50000000-1000-4000-8000-000000000001'),
  1, 'count_platform_admin_organization_totals reports the actual department count'
);

-- 32-33: ein Verein ohne Mitgliedschaften/Abteilungen bekommt trotzdem eine Zeile mit 0/0 -- die
-- beiden LEFT JOINs muessen coalescen, nicht die Zeile aus unnest() wegfallen lassen. Beide
-- Spalten einzeln geprueft, sonst bliebe ein Fehler im department_count-coalesce unbemerkt.
select is(
  (select member_count from public.count_platform_admin_organization_totals(
    array['50000000-1000-4000-8000-000000000001', '50000000-9999-4000-8000-000000000099']::uuid[]
  ) where organization_id = '50000000-9999-4000-8000-000000000099'),
  0, 'an organization id without any rows still gets member_count 0 instead of being dropped'
);
select is(
  (select department_count from public.count_platform_admin_organization_totals(
    array['50000000-1000-4000-8000-000000000001', '50000000-9999-4000-8000-000000000099']::uuid[]
  ) where organization_id = '50000000-9999-4000-8000-000000000099'),
  0, 'an organization id without any rows still gets department_count 0 instead of being dropped'
);

-- Eine aktive Aufgabenart darf jede Prioritaet nur einmal vergeben, sonst waere "der aktive
-- Provider" undefiniert (2026081305). Die Zeile aus dem CRUD-Smoke oben belegt bereits
-- (text_generation, 100, aktiv) und dient hier als Gegenpart.
select throws_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, priority)
    values ('PGTAP Duplicate Priority', 'openai', 'https://example.invalid', 'openai-test', 100)$$,
  '23505', null, 'a second active text provider cannot take an already used priority'
);
select lives_ok(
  $$insert into public.llm_provider_configurations (label, protocol, base_url, model, priority, is_active)
    values ('PGTAP Standby', 'openai', 'https://example.invalid', 'openai-test', 100, false)$$,
  'an inactive provider may keep a priority an active one already uses'
);
-- Dass eine andere Aufgabenart dieselbe Prioritaet belegen darf, laesst sich hier nicht pruefen:
-- llm_provider_configurations_active_implemented_adapter_check (2026081201) verbietet jede aktive
-- Zeile ausser text_generation, und inaktive Zeilen faellt der partielle Index ohnehin nicht an.
-- Die Spalte task_kind steht im Index fuer die Aufgabenarten, die es noch nicht gibt (siehe
-- 2026081103: das Vokabular ist absichtlich breiter als die Umsetzung).

-- Der vorbereitete Ersatz aus dem Fall davor darf erst aktiv werden, wenn seine Prioritaet frei
-- ist -- genau der Moment, in dem die Verwaltung den Konflikt anzeigen soll.
select throws_ok(
  $$update public.llm_provider_configurations set is_active = true where label = 'PGTAP Standby'$$,
  '23505', null, 'activating a standby onto an occupied priority is rejected'
);

select * from finish();
rollback;
