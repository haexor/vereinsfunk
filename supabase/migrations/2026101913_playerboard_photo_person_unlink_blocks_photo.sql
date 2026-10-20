begin;

-- Das Loeschen einer Verzeichnisperson (Betroffenenanfrage) nimmt ueber ON DELETE CASCADE ihre
-- Zeilen in playerboard_training_photo_people mit. playerboard_public_photos() liest "keine
-- Zuordnung" als "niemand braucht eine Einwilligung" -- das Foto blieb damit oeffentlich, obwohl die
-- abgebildete Person gerade ihre Loeschung verlangt hat. Gesperrt wurde es nur zufaellig, wenn der
-- SET-NULL-Trigger auf consent_records (consent_records_block_playerboard_photos) VOR der Kaskade
-- lief -- die Reihenfolge der RI-Trigger haengt an ihren Namen/OIDs, nicht an einer Zusage.
-- Jede entfernte Zuordnung macht die Aussage des Reviews ("alle erkennbaren Personen gelistet, alle
-- mit gueltiger Einwilligung") ungueltig; das Foto wird deshalb gesperrt und privat, wie beim
-- Widerruf einer Einwilligung. playerboard_review_photo_consent() ersetzt die Zuordnungen per
-- delete+insert und setzt danach selbst wieder 'approved' -- dort bleibt das Ergebnis gleich.
create or replace function public.playerboard_block_photo_on_person_unlink() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.playerboard_training_photos photo set consent_review_status = 'blocked', public = false
   where photo.organization_id = old.organization_id
     and photo.id = old.photo_id
     and photo.consent_review_status <> 'blocked';
  return old;
end;
$$;
revoke all on function public.playerboard_block_photo_on_person_unlink() from public;

drop trigger if exists playerboard_training_photo_people_block_on_unlink on public.playerboard_training_photo_people;
create trigger playerboard_training_photo_people_block_on_unlink
  before delete on public.playerboard_training_photo_people
  for each row execute function public.playerboard_block_photo_on_person_unlink();

commit;
