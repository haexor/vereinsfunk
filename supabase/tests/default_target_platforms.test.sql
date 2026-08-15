begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '64500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@pgtap-defaultplatforms.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('64500000-1000-4000-8000-000000000001', 'PGTAP Default Platforms Verein', 'pgtap-defaultplatforms-verein');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('64500000-1000-4000-8000-000000000001', '64500000-0000-4000-8000-000000000001', 'organization_owner');

set local role authenticated;
select set_config('request.jwt.claim.sub', '64500000-0000-4000-8000-000000000001', true);

-- 1-3: CHECK-Constraint -- dieselbe Menge wie composition_sessions.target_platforms (2026081310),
-- inklusive Duplikatpruefung ueber denselben text_array_is_distinct-Helfer.
set local role postgres;
select lives_ok(
  $$insert into public.policy_settings (organization_id, scope, default_target_platforms, updated_by)
    values ('64500000-1000-4000-8000-000000000001', 'organization', array['instagram', 'website'], '64500000-0000-4000-8000-000000000001')$$,
  'a valid subset of the known platforms is accepted'
);
select throws_ok(
  $$update public.policy_settings set default_target_platforms = array['twitter']
    where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization'$$,
  '23514', null, 'an unknown platform is rejected'
);
select throws_ok(
  $$update public.policy_settings set default_target_platforms = array['instagram', 'instagram']
    where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization'$$,
  '23514', null, 'a duplicated platform is rejected'
);
-- Zurueck auf einen bekannten Ausgangszustand fuer die set_policy_rules-Faelle unten.
update public.policy_settings set default_target_platforms = array['instagram']
  where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization';
set local role authenticated;

-- 4: ein Patch ohne defaultTargetPlatforms laesst die Spalte unveraendert.
select public.set_policy_rules('64500000-1000-4000-8000-000000000001', 'organization', null, null, '{"selfApprovalAllowed": true}'::jsonb);
select is(
  (select default_target_platforms from public.policy_settings where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization'),
  array['instagram']::text[], 'a patch that omits defaultTargetPlatforms leaves the column unchanged'
);

-- 5: ein gesetzter Wert ERSETZT den vorigen vollstaendig (kein Merge/keine Schnittmenge).
select public.set_policy_rules('64500000-1000-4000-8000-000000000001', 'organization', null, null, '{"defaultTargetPlatforms": ["facebook"]}'::jsonb);
select is(
  (select default_target_platforms from public.policy_settings where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization'),
  array['facebook']::text[], 'a set value replaces the previous selection entirely'
);

-- 6: eine ausdruecklich leere Auswahl wird als SQL-'{}' gespeichert, nicht als NULL -- sonst ginge
-- die "ausdruecklich keine Vorauswahl"-Bedeutung im Schreibpfad verloren (dasselbe Risiko wie bei
-- forbidden_topics/required_hashtags ohne coalesce, siehe 2026080801).
select public.set_policy_rules('64500000-1000-4000-8000-000000000001', 'organization', null, null, '{"defaultTargetPlatforms": []}'::jsonb);
select is(
  (select default_target_platforms from public.policy_settings where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization'),
  array[]::text[], 'an explicitly empty selection is stored as {}, not NULL'
);

-- 7: ein expliziter JSON-null-Wert setzt die Spalte auf SQL-NULL zurueck -- "wieder geerbt".
select public.set_policy_rules('64500000-1000-4000-8000-000000000001', 'organization', null, null, '{"defaultTargetPlatforms": null}'::jsonb);
select is(
  (select default_target_platforms from public.policy_settings where organization_id = '64500000-1000-4000-8000-000000000001' and scope = 'organization'),
  null, 'an explicit null resets the column to inherited'
);

select * from finish();
rollback;
