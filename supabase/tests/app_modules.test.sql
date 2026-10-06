begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

set local role postgres;

-- Paket 051: Modulrahmen. Zwei Vereine: 1 ohne Abo (der Tarif schraenkt nichts ein), 2 mit einem
-- eigenen Tarif, der nur social_media enthaelt.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-modules.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('51000000-1000-4000-8000-000000000001', 'PGTAP Module Verein', 'pgtap-module-verein'),
  ('51000000-1000-4000-8000-000000000002', 'PGTAP Module Tarifverein', 'pgtap-module-tarifverein');
insert into public.departments (id, organization_id, name, slug) values
  ('51000000-1100-4000-8000-000000000001', '51000000-1000-4000-8000-000000000001', 'Abteilung A', 'abteilung-a'),
  ('51000000-1100-4000-8000-000000000002', '51000000-1000-4000-8000-000000000001', 'Abteilung B', 'abteilung-b'),
  ('51000000-1100-4000-8000-000000000003', '51000000-1000-4000-8000-000000000002', 'Abteilung C', 'abteilung-c');
insert into public.teams (id, organization_id, department_id, name) values
  ('51000000-1200-4000-8000-000000000001', '51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000001', 'Team X'),
  ('51000000-1200-4000-8000-000000000002', '51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000002', 'Team Y');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('51000000-1000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'organization_owner');

-- 1: Bestand -- jeder vor dieser Migration vorhandene Tarif enthaelt beide Module.
select is(
  (select count(*)::integer from public.subscription_plans where not (included_modules @> '{social_media,playerboard}')),
  0, 'every existing plan includes both modules after the migration'
);

-- 2: ein neuer Tarif ohne Angabe enthaelt nur social_media (Spaltendefault).
insert into public.subscription_plans (key, display_name, monthly_price_cents, storage_bytes, max_teams, max_departments, sort_order)
values ('pgtap_modules_social_only', 'Nur Social Media', 0, 1000000, null, null, 999);
select is(
  (select included_modules from public.subscription_plans where key = 'pgtap_modules_social_only'),
  '{social_media}'::public.app_module[], 'a new plan defaults to the social_media module only'
);
insert into public.organization_subscriptions (organization_id, plan_key) values
  ('51000000-1000-4000-8000-000000000002', 'pgtap_modules_social_only');

-- 3-4: ohne Abo und ohne policy_settings ist jedes Modul ueberall aktiv.
select ok(authz.module_enabled('51000000-1000-4000-8000-000000000001', null, null, 'playerboard'),
  'without a subscription and without settings, playerboard is enabled at the organization level');
select ok(authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000001', '51000000-1200-4000-8000-000000000001', 'social_media'),
  'without a subscription and without settings, social_media is enabled at team level');

-- 5-6: der Tarif ohne playerboard schaltet es ueberall im Verein ab, social_media bleibt.
select ok(not authz.module_enabled('51000000-1000-4000-8000-000000000002', '51000000-1100-4000-8000-000000000003', null, 'playerboard'),
  'a plan without playerboard disables it in every department');
select ok(authz.module_enabled('51000000-1000-4000-8000-000000000002', '51000000-1100-4000-8000-000000000003', null, 'social_media'),
  'a plan with social_media keeps it enabled');

-- 7: auch ein Verein, der playerboard ausdruecklich nennt, bekommt es nicht ueber den Tarif hinaus.
insert into public.policy_settings (organization_id, scope, enabled_modules, updated_by) values
  ('51000000-1000-4000-8000-000000000002', 'organization', '{social_media,playerboard}', '51000000-0000-4000-8000-000000000001');
select ok(not authz.module_enabled('51000000-1000-4000-8000-000000000002', null, null, 'playerboard'),
  'an organization cannot enable a module its plan does not include');

-- 8-10: Abteilung A waehlt alles ab ('{}'); Team X darunter nennt playerboard -- bleibt aus.
-- Abteilung B ist davon unberuehrt, Team Y ohne eigene Zeile erbt von B.
insert into public.policy_settings (organization_id, scope, department_id, enabled_modules, updated_by) values
  ('51000000-1000-4000-8000-000000000001', 'department', '51000000-1100-4000-8000-000000000001', '{}', '51000000-0000-4000-8000-000000000001');
insert into public.policy_settings (organization_id, scope, department_id, team_id, enabled_modules, updated_by) values
  ('51000000-1000-4000-8000-000000000001', 'team', '51000000-1100-4000-8000-000000000001', '51000000-1200-4000-8000-000000000001', '{playerboard}', '51000000-0000-4000-8000-000000000001');
select ok(not authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000001', null, 'social_media'),
  'an empty list on a department disables every module there');
select ok(not authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000001', '51000000-1200-4000-8000-000000000001', 'playerboard'),
  'a team cannot re-enable a module its department deselected');
select ok(authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000002', '51000000-1200-4000-8000-000000000002', 'playerboard'),
  'a team without its own row in another department inherits that department (enabled)');

-- 11-12: eine Mannschaft waehlt fuer sich ab, die Abteilung darueber bleibt unberuehrt.
insert into public.policy_settings (organization_id, scope, department_id, team_id, enabled_modules, updated_by) values
  ('51000000-1000-4000-8000-000000000001', 'team', '51000000-1100-4000-8000-000000000002', '51000000-1200-4000-8000-000000000002', '{social_media}', '51000000-0000-4000-8000-000000000001');
select ok(not authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000002', '51000000-1200-4000-8000-000000000002', 'playerboard'),
  'a team can deselect a module for itself');
select ok(authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000002', null, 'playerboard'),
  'a team setting does not affect its department');

-- 13: null auf einer Ebene ist neutral (erben), nicht "kein Modul".
update public.policy_settings set enabled_modules = null
 where organization_id = '51000000-1000-4000-8000-000000000001' and scope = 'department' and department_id = '51000000-1100-4000-8000-000000000001';
select ok(authz.module_enabled('51000000-1000-4000-8000-000000000001', '51000000-1100-4000-8000-000000000001', null, 'social_media'),
  'null on a department means inherit, not "no module"');

-- 14: Spaltenrecht -- authenticated liest enabled_modules (die Oberflaeche zeigt die Auswahl je Ebene).
set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select enabled_modules from public.policy_settings where organization_id = '51000000-1000-4000-8000-000000000001'$$,
  'authenticated can select the enabled_modules column'
);

-- 15: authenticated darf policy_settings.enabled_modules nicht direkt schreiben (nur ueber die API).
select throws_ok(
  $$update public.policy_settings set enabled_modules = '{}' where organization_id = '51000000-1000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot write enabled_modules directly'
);

-- 16: anon darf authz.module_enabled nicht ausfuehren.
set local role anon;
select throws_ok(
  $$select authz.module_enabled('51000000-1000-4000-8000-000000000001', null, null, 'playerboard')$$,
  '42501', null, 'anon cannot execute authz.module_enabled'
);

select * from finish();
rollback;
