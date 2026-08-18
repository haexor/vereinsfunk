begin;

-- Plan 045, PR 0 Schritt 3: Review-Fix. invalidate_people_review_on_face_change() (2026081802)
-- wurde ohne SECURITY DEFINER angelegt, obwohl sie eine ANDERE Tabelle beschreibt als die, in die
-- gerade geschrieben wird (media_assets statt face_regions) -- damit lief das Update darin mit den
-- Rechten der aufrufenden Person. Seit 2026081801 hat authenticated keinen UPDATE-Grant mehr auf
-- media_assets, also scheiterte jedes echte Markieren einer Gesichtsregion durch ein Mitglied an
-- "permission denied for table media_assets" -- gefunden per echtem Playwright-Lauf gegen die neue
-- Foto-Markier-UI, nicht durch die eigenen pgTAP-Tests: die hatten face_regions-Schreiben bislang
-- ausschliesslich unter der Rolle postgres geuebt, nie unter authenticated (siehe die
-- entsprechend nachgeschaerften Faelle in supabase/tests/media_people_review.test.sql).
create or replace function public.invalidate_people_review_on_face_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.media_assets set people_reviewed_at = null, people_reviewed_by = null
    where id = coalesce(new.media_asset_id, old.media_asset_id);
  return coalesce(new, old);
end; $$;

commit;
