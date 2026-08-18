begin;

-- Plan 045, PR 0 Schritt 1: der Upload-Pfad wird real (SupabaseUploadService ersetzt
-- LocalUploadService, siehe apps/api/src/mediaUpload.ts). Bislang gab es keinen einzigen
-- Schreibzugriff auf media_assets ausserhalb der Service Role in echtem Code -- die pauschalen
-- Grants an authenticated (202608030001) waren nie ein aktives Risiko, weil kein Feld je einen
-- echten Wert bekam. Sobald der Upload-Abschluss echte Werte in scan_status/upload_status
-- schreibt, waere ein Mitglied mit post.create sonst in der Lage, ueber einen direkten
-- PostgREST-Aufruf sein eigenes Foto als scan_status='clean'/upload_status='ready'
-- freizuschreiben, ohne dass die API je den Inhalt gesehen hat.
alter table public.media_assets
  add column structural_validation_status text not null default 'pending'
    check (structural_validation_status in ('pending', 'valid', 'failed'));

-- Entscheidung (Betreiber, 2026-08-18): kein separater Malware-Scanner-Provider. Die
-- angemeldeten, namentlich bekannten Vereinsmitglieder sind kein anonymes Public-Upload --
-- Byte-Sniff gegen den Client-Content-Type plus ein erfolgreiches Sharp-Decode (dieselbe Pruefung
-- wie brandLogo.ts) gilt als ausreichende Grundlage. structural_validation_status='valid' und
-- scan_status='clean' werden deshalb vom selben Codepfad in derselben Schreiboperation gesetzt,
-- es gibt keine zweite, unabhaengige Scan-Stufe. Ein negativer Struktur-Befund haelt beide auf
-- 'failed', nie auf dem alten Default 'pending', der schedule_publication() bislang unbegrenzt
-- blockiert haette (siehe 2026081302, media_blockers 'scan_pending').
revoke update on public.media_assets from authenticated;
drop policy if exists media_assets_update on public.media_assets;

commit;
