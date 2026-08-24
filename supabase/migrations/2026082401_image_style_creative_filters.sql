begin;

-- Kreative, serverseitig gerenderte Bildstil-Effekte. Beide Werte sind additiv und verändern
-- weder bestehende Presets noch deren Render-Ergebnisse.
alter type public.image_style_filter add value if not exists 'comic';
alter type public.image_style_filter add value if not exists 'konfetti';

commit;
