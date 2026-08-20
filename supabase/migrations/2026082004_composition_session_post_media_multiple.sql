begin;

-- Plan 047, PR 0: hebt die bewusste Pilot-Grenze aus Plan 045 ("hoechstens ein Foto, kein
-- Karussell") auf der Anhang-Ebene auf. composition_session_post_media war bislang auf genau eine
-- Zeile je Sitzung (role='primary', position=0) gepinnt; jetzt traegt sie N Zeilen mit einer
-- echten Position, genauso wie post_media selbst schon immer (unique(post_version_id, position)).
alter table public.composition_session_post_media drop constraint composition_session_post_media_position_check;
alter table public.composition_session_post_media drop constraint composition_session_post_media_role_check;
alter table public.composition_session_post_media drop constraint composition_session_post_media_composition_session_id_key;

-- role-Konvention wie in apps/api/src/routes/publishing.ts: Position 0 = 'primary', alles danach
-- 'slide'. Ob daraus am Ende eine Komposition (ein Ergebnisfoto) oder ein echtes Karussell (N
-- Fotos) wird, entscheidet sich erst spaeter (Plan 047, PR 1/PR 2) -- diese Tabelle haelt nur die
-- rohen Quellfotos einer Sitzung.
alter table public.composition_session_post_media add constraint composition_session_post_media_role_check check (role in ('primary', 'slide'));
alter table public.composition_session_post_media add constraint composition_session_post_media_position_check check (position >= 0);
alter table public.composition_session_post_media add constraint composition_session_post_media_composition_session_id_position_key unique (composition_session_id, position);

commit;
