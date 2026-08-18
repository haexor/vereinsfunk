begin;

-- Plan 045, PR 0 Schritt 3: die Foto-Markier-UI ist der erste echte Aufrufer, der eine fehlerhaft
-- gezogene Markierung wieder entfernen will, bevor sie entschieden ist. Die RLS-Policy
-- face_regions_write (202608030001_content_media_workflows_publishing.sql) deckt bereits FOR ALL
-- ab, also auch DELETE -- nur der zugrunde liegende GRANT fehlte seit jeher: das urspruengliche
-- "grant select,insert,update ... to authenticated" liess DELETE aus, weil bis zu diesem Paket nie
-- ein echter Aufrufer als authenticated eine face_regions-Zeile geloescht hat. Gefunden per echtem
-- Playwright-Lauf gegen die neue Markier-UI (403 "permission denied for table face_regions") --
-- die eigenen pgTAP-Tests hatten face_regions-Schreiben bislang nur unter der Rolle postgres
-- geuebt, nie unter authenticated (siehe auch die SECURITY DEFINER-Nachbesserung in dieser
-- Migrationsreihe, Kommentar in 2026081802).
grant delete on public.face_regions to authenticated;

commit;
