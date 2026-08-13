begin;

-- Plan 040: replaces the dial-shaped style_rules (sentenceLength/energy/humour/formality/
-- perspective/bannedPhrases) with a character model (toneTags/catchphrases/exampleInput/
-- exampleOutput/additionalInstructions). style_rules stays a schemaless jsonb column (the CHECK
-- below only ever verified jsonb_typeof = 'object', never a field shape), so the new Zod shape
-- needs no column change. bannedPhrases is retired without replacement; avoid_rules already
-- covers the same "don't say this" concept. do_rules is new, mirroring avoid_rules exactly, for
-- "always do this".
alter table public.content_style_profiles add column do_rules text[] not null default '{}';
alter table public.content_style_profiles add constraint content_style_profiles_do_rules_bounds
  check (cardinality(do_rules) <= 30 and public.text_array_elements_within_length(do_rules, 160));

alter table public.platform_style_personas add column do_rules text[] not null default '{}';
alter table public.platform_style_personas add constraint platform_style_personas_do_rules_bounds
  check (cardinality(do_rules) <= 30 and public.text_array_elements_within_length(do_rules, 160));

-- Reset existing rows to the new schema's empty-but-valid shape ('{}' parses against the new
-- StyleProfileRulesSchema because every field there defaults). No production data exists yet
-- (pilot-readiness gate still closed) -- only locally/pilot-created personas and profiles, which
-- the operator/member who created them can re-author with the new fields.
update public.content_style_profiles set style_rules = '{}'::jsonb;
update public.platform_style_personas set style_rules = '{}'::jsonb;

commit;
