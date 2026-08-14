begin;

-- Plan 039: die eigene Vereinswebsite/der eigene Blog ist ein Kanal wie jeder andere. Kein
-- eigenes Vokabular fuer die Textwerkstatt (siehe SocialPlatformSchema-Kommentar in
-- packages/contracts/src/primitives.ts): 'website' kommt in dieselbe Plattform-Menge wie
-- 'instagram'/'facebook', und was einen Website-Kanal tatsaechlich unterscheidet -- kein OAuth-Token,
-- eine eigene Adresse statt eines externen Konto-IDs, eine vom Verein selbst gepflegte Laengengrenze
-- -- sitzt an den Spalten, nicht am Enum.

-- 1. Plattform-CHECK erweitern -- nur dort, wo in diesem Paket auch tatsaechlich 'website'
-- geschrieben wird: der Kanal selbst, die Plattform-Vorgaben und die Ziel-Plattformen einer
-- Sitzung. oauth_states/oauth_pending_connections bleiben auf ('instagram','facebook'): ein
-- Website-Kanal entsteht nie ueber OAuth (Step 2 unten).
--
-- publications/post_variants bleiben BEWUSST eng (Review dieses PRs). Plan 039 sagt zu: "Bis zum
-- Folgepaket erzeugt ein Blog-Kanal keine Veroeffentlichungszeile" -- durchgesetzt wird das hier,
-- nicht in der API: schedule_publication() ist security-definer und per
-- "grant execute ... to authenticated" (2026080606) direkt ueber PostgREST aufrufbar, ein reiner
-- TS-Riegel waere also umgehbar. Die RPC kopiert connection.platform ungefiltert in publications;
-- ohne diesen CHECK entstuende fuer einen Blog-Kanal eine Zeile, die POST /v1/publications/:id/execute
-- danach nie ausfuehren kann (kein social_connection_secrets-Eintrag -- Entwurfsentscheidung 2) und
-- die zudem PublicationSchema (packages/contracts/src/policy.ts) beim Serialisieren zerbricht.
-- Erweitert wird beides erst mit dem Auslieferungspaket, das den Blog wirklich bespielen kann.
alter table public.social_connections drop constraint social_connections_platform_check;
alter table public.social_connections add constraint social_connections_platform_check
  check (platform in ('instagram', 'facebook', 'website'));

alter table public.text_generation_platform_defaults drop constraint text_generation_platform_defaults_platform_check;
alter table public.text_generation_platform_defaults add constraint text_generation_platform_defaults_platform_check
  check (platform in ('instagram', 'facebook', 'website'));

alter table public.composition_sessions drop constraint composition_sessions_target_platforms_check;
alter table public.composition_sessions add constraint composition_sessions_target_platforms_check
  check (target_platforms <@ array['instagram', 'facebook', 'website']::text[] and public.text_array_is_distinct(target_platforms));

-- 2. external_account_id/website_url schliessen sich gegenseitig aus -- ein Website-Kanal hat nie
-- ein externes Konto, ein Instagram-/Facebook-Kanal nie eine Website-Adresse. social_connection_secrets
-- bleibt unangetastet: ein Website-Kanal bekommt dort schlicht keine Zeile (Entwurfsentscheidung 2).
alter table public.social_connections alter column external_account_id drop not null;
alter table public.social_connections add column website_url text;
alter table public.social_connections add constraint social_connections_website_url_check
  check (website_url is null or website_url ~ '^https://');
alter table public.social_connections add constraint social_connections_platform_fields_check
  check (
    (platform = 'website' and external_account_id is null and website_url is not null) or
    (platform <> 'website' and external_account_id is not null and website_url is null)
  );

-- Adresse ist der Traeger der Eindeutigkeit fuer Website-Kanaele, nicht external_account_id (das
-- bleibt fuer sie immer null -- ein unique(...,external_account_id) saehe jede weitere Website-Zeile
-- nie als Duplikat). Beliebig viele Website-Kanaele je Verein, auf Vereins- wie auf Abteilungsebene
-- (Entwurfsentscheidung 4) -- nur derselbe Blog nicht zweimal. Kanonisierung (Schema/Host-Case/
-- Root-Trailing-Slash) sitzt im Schreibpfad (POST /v1/channels), nicht hier.
--
-- "archived_at is null" gehoert in das Praedikat (Review dieses PRs): DELETE /v1/channels/:id
-- archiviert nur (status='disconnected', archived_at=now()), die Zeile bleibt stehen. Ohne diese
-- Bedingung blockiert ein einmal archivierter Blog seine eigene Adresse fuer immer -- die Anlage
-- antwortet 409 und es gibt keinen Weg zurueck, weil kein Endpunkt eine Verbindung reaktiviert.
create unique index social_connections_website_url_unique on public.social_connections (organization_id, website_url)
  where platform = 'website' and archived_at is null;

-- 3. Laengengrenze je Kanal -- null heisst "globale Plattform-Vorgabe gilt" (Entwurfsentscheidung 3).
alter table public.social_connections add column max_characters integer;
alter table public.social_connections add constraint social_connections_max_characters_check
  check (max_characters is null or max_characters between 100 and 10000);

-- Spaltenrechte wie bei jeder anderen social_connections-Spalte (Plan 012, Massnahme 1): additiv,
-- die bestehende Grant-Anweisung bleibt unangetastet.
grant select (website_url, max_characters) on public.social_connections to authenticated;

-- 4. Website-Vorgabe: 5000 Zeichen (Betreiberentscheidung 2026-08-14). Ohne Schritt 4 in Plan 039 PR
-- 1 (Token-Leine, siehe apps/worker/src/textGeneration.ts) waere dieser Wert ein leeres Versprechen --
-- die Provider-Anfrage haette weiter ein festes 1200-Token-Budget und ein 5000-Zeichen-Beitrag
-- kaeme abgeschnitten zurueck.
insert into public.text_generation_platform_defaults (platform, max_characters) values ('website', 5000);

commit;
