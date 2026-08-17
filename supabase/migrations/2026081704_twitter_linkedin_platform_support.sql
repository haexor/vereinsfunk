begin;

-- Paket 045: Twitter/X und LinkedIn als volle Kanaele (OAuth + echtes Veroeffentlichen), analog zu
-- Instagram/Facebook. Bewusst NICHT angefasst: post_variants_platform_check (vor-Paket-033
-- Bild/Video-Pipeline, vom Text-Pilot ungenutzt, siehe plans/045).

-- 1. Plattform-CHECKs erweitern -- ueberall dort, wo 'instagram'/'facebook' bislang die volle Menge
-- der OAuth-Plattformen war. oauth_states/oauth_pending_connections blieben bei Plan 039 bewusst eng
-- (ein Website-Kanal entsteht nie ueber OAuth) -- Twitter/LinkedIn entstehen dagegen ueber OAuth wie
-- Instagram/Facebook, deshalb hier erstmals erweitert.
alter table public.social_connections drop constraint social_connections_platform_check;
alter table public.social_connections add constraint social_connections_platform_check
  check (platform in ('instagram', 'facebook', 'twitter', 'linkedin', 'website'));

alter table public.oauth_states drop constraint oauth_states_platform_check;
alter table public.oauth_states add constraint oauth_states_platform_check
  check (platform in ('instagram', 'facebook', 'twitter', 'linkedin'));

alter table public.oauth_pending_connections drop constraint oauth_pending_connections_platform_check;
alter table public.oauth_pending_connections add constraint oauth_pending_connections_platform_check
  check (platform in ('instagram', 'facebook', 'twitter', 'linkedin'));

alter table public.publications drop constraint publications_platform_check;
alter table public.publications add constraint publications_platform_check
  check (platform in ('instagram', 'facebook', 'twitter', 'linkedin'));

alter table public.text_generation_platform_defaults drop constraint text_generation_platform_defaults_platform_check;
alter table public.text_generation_platform_defaults add constraint text_generation_platform_defaults_platform_check
  check (platform in ('instagram', 'facebook', 'twitter', 'linkedin', 'website'));

alter table public.composition_sessions drop constraint composition_sessions_target_platforms_check;
alter table public.composition_sessions add constraint composition_sessions_target_platforms_check
  check (target_platforms <@ array['instagram', 'facebook', 'twitter', 'linkedin', 'website']::text[]
    and public.text_array_is_distinct(target_platforms));

alter table public.policy_settings drop constraint policy_settings_default_target_platforms_check;
alter table public.policy_settings add constraint policy_settings_default_target_platforms_check
  check (default_target_platforms <@ array['instagram', 'facebook', 'twitter', 'linkedin', 'website']::text[]
    and public.text_array_is_distinct(default_target_platforms));

-- 2. PKCE-Verifier fuer den Twitter/X-OAuth2-Flow: muss zwischen /connect/twitter/start und
-- /connect/twitter/callback ueberleben (bei Instagram/Facebook/LinkedIn bleibt die Spalte null, kein
-- eigener CHECK -- die Route weiss selbst, fuer welche Plattform sie einen Verifier braucht).
alter table public.oauth_states add column code_verifier text;

-- 3. Laengenvorgabe je neue Plattform -- echte Plattform-Maxima (X 280, LinkedIn 3000), bereits als
-- Zielwerte in frueheren Migrationen kommentiert (siehe 2026081308).
insert into public.text_generation_platform_defaults (platform, max_characters) values
  ('twitter', 280),
  ('linkedin', 3000);

commit;
