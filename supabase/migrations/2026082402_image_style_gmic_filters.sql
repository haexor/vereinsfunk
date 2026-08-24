begin;

-- G'MIC-Effekte bleiben explizite, kuratierte Preset-Werte. Es gibt absichtlich kein freies
-- Command-Feld: G'MIC ist eine vollständige Bildsprache und darf niemals mit Nutzereingaben
-- ausgeführt werden.
alter type public.image_style_filter add value if not exists 'gmic_vintage';
alter type public.image_style_filter add value if not exists 'gmic_poster';

commit;
