begin;

-- Bildstil-Nachbesserung: fuenfter Rahmenstil "festlich" -- ein bewusst fest goldener,
-- verzierter Rahmen unabhaengig von der Vereinsfarbe, siehe applyFestlichFrameStyle in
-- apps/api/src/imageStyle.ts. Eigene Migration, da ALTER TYPE ... ADD VALUE erst nach dem
-- Commit dieser eigenen Transaktion verwendbar ist (derselbe Grund wie bei
-- 2026081915_image_style_presets_frame_kind.sql).
alter type public.image_style_frame_style add value 'festlich';

commit;
