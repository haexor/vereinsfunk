begin;

-- Paket 046: mehrere LLMs koennen gleichzeitig einen Vorschlag liefern. Ein Klick auf
-- "Generieren"/"Ueberarbeiten" erzeugt dafuer ab jetzt mehrere generation_candidates-Zeilen statt
-- einer -- round_input_hash gruppiert die Zeilen, die derselbe Klick zusammen erzeugt hat ("eine
-- Runde"), waehrend input_hash je Zeile weiterhin eindeutig bleibt (siehe naechste Migration).
--
-- Default per Trigger statt "not null" ohne Backfill-Zwang an jeder bestehenden INSERT-Stelle:
-- jede bisherige Zeile war bereits ihre eigene Ein-Kandidat-Runde, ihr eigener input_hash ist also
-- exakt der richtige round_input_hash. Das gilt nicht nur fuer die historischen Datenbank-Zeilen
-- (per Backfill unten), sondern auch fuer die vielen direkten Test-Fixture-INSERTs in
-- supabase/tests/*.sql, die round_input_hash nie nennen -- ein Trigger-Default erspart, jede
-- einzelne dieser Stellen anzufassen. create_text_generation_session (naechste Migration) setzt
-- den Wert fuer eine echte Mehrfach-Runde stattdessen explizit und ueberschreibt den Trigger damit.
alter table public.generation_candidates add column round_input_hash text;
update public.generation_candidates set round_input_hash = input_hash where round_input_hash is null;
alter table public.generation_candidates alter column round_input_hash set not null;
alter table public.generation_candidates add constraint generation_candidates_round_input_hash_check check (round_input_hash ~ '^[a-f0-9]{64}$');

create function public.set_generation_candidate_round_input_hash() returns trigger
language plpgsql as $$
begin
  if new.round_input_hash is null then new.round_input_hash := new.input_hash; end if;
  return new;
end;
$$;
create trigger set_generation_candidate_round_input_hash before insert on public.generation_candidates
  for each row execute function public.set_generation_candidate_round_input_hash();

-- Fuer den Lesepfad (apps/api/src/routes/content.ts): "die juengste Runde einer Sitzung" wird ab
-- jetzt ueber round_input_hash statt ueber eine einzelne Kandidatenzeile aufgeloest.
create index generation_candidates_session_round_idx on public.generation_candidates (composition_session_id, round_input_hash);

commit;
