begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- complete_onboarding_step haengt einen Schritt atomar an completed_steps an, statt das Array in
-- der API zu lesen und als Ganzes zurueckzuschreiben (dabei ging ein gleichzeitig abgeschlossener
-- Schritt verloren).
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '41950000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-onboarding-step.local', '', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '41950000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'viewer@pgtap-onboarding-step.local', '', '{}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '41950000-0000-4000-8000-000000000001', true);
select public.create_organization('PGTAP Onboarding Step Org', 'Hauptabteilung');

set local role postgres;
insert into public.organization_memberships (organization_id, user_id, role)
  select id, '41950000-0000-4000-8000-000000000002', 'organization_viewer' from public.organizations where slug = 'pgtap-onboarding-step-org';

set local role authenticated;
select set_config('request.jwt.claim.sub', '41950000-0000-4000-8000-000000000001', true);
select is(
  (select completed_steps from public.complete_onboarding_step((select id from public.organizations where slug = 'pgtap-onboarding-step-org'), 'branding')),
  array['branding'], 'the first completed step is stored'
);
select is(
  (select completed_steps from public.complete_onboarding_step((select id from public.organizations where slug = 'pgtap-onboarding-step-org'), 'responsible_person')),
  array['branding', 'responsible_person'], 'a further step is appended to the stored steps, not written over them'
);
select is(
  (select completed_steps from public.complete_onboarding_step((select id from public.organizations where slug = 'pgtap-onboarding-step-org'), 'branding')),
  array['branding', 'responsible_person'], 'completing a step twice does not duplicate it'
);

-- Negativ: ohne organization.manage filtert organization_onboarding_update die Zeile heraus.
select set_config('request.jwt.claim.sub', '41950000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.complete_onboarding_step((select id from public.organizations where slug = 'pgtap-onboarding-step-org'), 'extra')),
  0, 'a member without organization.manage changes no row'
);
set local role postgres;
select is(
  (select completed_steps from public.organization_onboarding where organization_id = (select id from public.organizations where slug = 'pgtap-onboarding-step-org')),
  array['branding', 'responsible_person'], 'the viewer call left the steps unchanged'
);

set local role anon;
select throws_ok(
  $$select * from public.complete_onboarding_step('41950000-9000-4000-8000-000000000001', 'branding')$$,
  '42501', null, 'anon cannot execute complete_onboarding_step'
);

select * from finish();
rollback;
