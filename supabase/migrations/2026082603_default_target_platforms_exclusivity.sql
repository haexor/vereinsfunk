begin;

-- Review PR #181: 'plaintext' ist exklusiv (primitives.ts, hasExclusivePlatformConflict), aber
-- policy_settings_default_target_platforms_check erlaubte bislang z. B. ['plaintext','instagram'].
-- Anders als composition_sessions_target_platforms_check (dessen Schreibpfad
-- create_text_generation_session ausschliesslich service_role zugaenglich ist, siehe Migration
-- 2026082601) laeuft der Schreibpfad hier ueber set_policy_setting() -- security definer, aber an
-- 'authenticated' granted (Migration 2026080604). Die Zod-Refine in policy.ts schuetzt nur den
-- eigenen API-Weg, nicht einen direkten RPC-Aufruf -- ohne CHECK bliebe das genau die Luecke, die
-- RPCs traut Client nicht beschreibt.
alter table public.policy_settings drop constraint policy_settings_default_target_platforms_check;
alter table public.policy_settings add constraint policy_settings_default_target_platforms_check
  check (default_target_platforms <@ array['instagram', 'facebook', 'twitter', 'linkedin', 'website', 'plaintext']::text[]
    and public.text_array_is_distinct(default_target_platforms)
    and not ('plaintext' = any(default_target_platforms) and coalesce(array_length(default_target_platforms, 1), 0) > 1)) not valid;
alter table public.policy_settings validate constraint policy_settings_default_target_platforms_check;

commit;
