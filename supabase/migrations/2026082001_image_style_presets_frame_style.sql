begin;

-- Bildstil-Nachbesserung: der bisherige parametrische Rahmen kannte nur einen einzigen visuellen
-- Stil (Vollrand). frame_style faechert das auf mehrere fertige Stile auf, die weiterhin nur
-- Farbe (frame_color) und Staerke (frame_width_px) uebernehmen -- kein neuer Parameter noetig.
create type public.image_style_frame_style as enum ('solid', 'double', 'corner_marks', 'bottom_bar');

alter table public.image_style_presets add column frame_style public.image_style_frame_style;

-- Bestehende parametrische Presets bekommen 'solid' -- exakt ihr heutiges Rendering, kein
-- Bestandspreset aendert dadurch sein Ergebnis.
update public.image_style_presets set frame_style = 'solid' where frame_type = 'parametric';

alter table public.image_style_presets add constraint image_style_presets_frame_style_check
  check ((frame_type = 'parametric') = (frame_style is not null));

commit;
