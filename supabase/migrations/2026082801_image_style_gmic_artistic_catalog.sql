begin;

-- Der sichtbare Katalog besteht aus festen, im Media-Provider hinterlegten Rezepten. Es gibt
-- bewusst kein frei beschreibbares G'MIC-Kommando: G'MIC kann sonst lokale Dateien lesen oder
-- externe Befehle laden und darf deshalb niemals direkt mit Nutzereingaben ausgefuehrt werden.
alter type public.image_style_filter add value if not exists 'gmic_brushify';
alter type public.image_style_filter add value if not exists 'gmic_cartoon';
alter type public.image_style_filter add value if not exists 'gmic_color_ellipses';
alter type public.image_style_filter add value if not exists 'gmic_cubism';
alter type public.image_style_filter add value if not exists 'gmic_ellipsionism';
alter type public.image_style_filter add value if not exists 'gmic_fire_edges';
alter type public.image_style_filter add value if not exists 'gmic_fractalize';
alter type public.image_style_filter add value if not exists 'gmic_glow';
alter type public.image_style_filter add value if not exists 'gmic_halftone';
alter type public.image_style_filter add value if not exists 'gmic_hardsketchbw';
alter type public.image_style_filter add value if not exists 'gmic_hearts';
alter type public.image_style_filter add value if not exists 'gmic_houghsketchbw';
alter type public.image_style_filter add value if not exists 'gmic_lightrays';
alter type public.image_style_filter add value if not exists 'gmic_light_relief';
alter type public.image_style_filter add value if not exists 'gmic_linify';
alter type public.image_style_filter add value if not exists 'gmic_mosaic';
alter type public.image_style_filter add value if not exists 'gmic_pencilbw';
alter type public.image_style_filter add value if not exists 'gmic_pixelsort';
alter type public.image_style_filter add value if not exists 'gmic_polaroid';
alter type public.image_style_filter add value if not exists 'gmic_polygonize';
alter type public.image_style_filter add value if not exists 'gmic_poster_edges';
alter type public.image_style_filter add value if not exists 'gmic_rodilius';
alter type public.image_style_filter add value if not exists 'gmic_sketchbw';
alter type public.image_style_filter add value if not exists 'gmic_sponge';
alter type public.image_style_filter add value if not exists 'gmic_stained_glass';
alter type public.image_style_filter add value if not exists 'gmic_stars';
alter type public.image_style_filter add value if not exists 'gmic_stencil';
alter type public.image_style_filter add value if not exists 'gmic_stencilbw';
alter type public.image_style_filter add value if not exists 'gmic_tetris';
alter type public.image_style_filter add value if not exists 'gmic_warhol';
alter type public.image_style_filter add value if not exists 'gmic_weave';
alter type public.image_style_filter add value if not exists 'gmic_whirls';

commit;
