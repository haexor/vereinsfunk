begin;

-- Paket 046: der SaaS-Betreiber legt fest, wie viele verschiedene LLMs gleichzeitig einen
-- Textvorschlag liefern. Ein weiterer Schlossel in platform_settings, genau wie
-- max_organizations_per_owner/publishing_enabled (2026080502) -- Wertebereich/Gueltigkeit sitzt in
-- packages/contracts (PlatformSettingValueSchemas), nicht als CHECK hier, wie bei den
-- bestehenden Schluesseln auch schon. Seed-Wert 1: ohne Eingriff des Betreibers bleibt das
-- Bestandsverhalten (ein Modell je Anfrage) unveraendert.
insert into public.platform_settings (key, value) values ('text_generation_ensemble_size', '1'::jsonb)
  on conflict (key) do nothing;

commit;
