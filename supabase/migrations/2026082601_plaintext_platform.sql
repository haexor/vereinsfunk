begin;

-- Kanallose Zielplattform "Nur Text": LLM/Stilprofil-Ergebnisse testen, ohne dass ein Verein einen
-- Kanal (Instagram/Facebook/...) verbunden hat. Bewusst NICHT angefasst:
-- social_connections_platform_check, oauth_states_platform_check,
-- oauth_pending_connections_platform_check, publications_platform_check, post_variants -- 'plaintext'
-- bekommt strukturell nie einen Kanal und nie eine publications-Zeile (Vorbild: 'website' ist aus
-- demselben Grund von publications_platform_check ausgeschlossen, siehe routes/publishing.ts).
-- Exklusivitaet (nicht mit anderen Plattformen kombinierbar) wird in createTextGenerationSession
-- durchgesetzt, nicht per CHECK -- die RPC ist ohnehin nur service_role zugaenglich.

alter table public.composition_sessions drop constraint composition_sessions_target_platforms_check;
alter table public.composition_sessions add constraint composition_sessions_target_platforms_check
  check (target_platforms <@ array['instagram', 'facebook', 'twitter', 'linkedin', 'website', 'plaintext']::text[]
    and public.text_array_is_distinct(target_platforms)) not valid;
alter table public.composition_sessions validate constraint composition_sessions_target_platforms_check;

alter table public.policy_settings drop constraint policy_settings_default_target_platforms_check;
alter table public.policy_settings add constraint policy_settings_default_target_platforms_check
  check (default_target_platforms <@ array['instagram', 'facebook', 'twitter', 'linkedin', 'website', 'plaintext']::text[]
    and public.text_array_is_distinct(default_target_platforms)) not valid;
alter table public.policy_settings validate constraint policy_settings_default_target_platforms_check;

alter table public.text_generation_platform_defaults drop constraint text_generation_platform_defaults_platform_check;
alter table public.text_generation_platform_defaults add constraint text_generation_platform_defaults_platform_check
  check (platform in ('instagram', 'facebook', 'twitter', 'linkedin', 'website', 'plaintext')) not valid;
alter table public.text_generation_platform_defaults validate constraint text_generation_platform_defaults_platform_check;

-- 10.000 ist die reale Systemobergrenze (MaxCharactersSchema/MAX_CHARACTERS_CEILING,
-- packages/contracts/src/content.ts), zugleich das Maximum der Spalten-CHECK hier -- "beliebig lang"
-- bildet sich darauf ab.
insert into public.text_generation_platform_defaults (platform, max_characters) values ('plaintext', 10000);

commit;
