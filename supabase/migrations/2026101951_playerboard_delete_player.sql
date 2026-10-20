begin;

-- DELETE /v1/playerboard/players/:id zaehlte die Punkte des Kader-Eintrags und loeschte ihn danach
-- in einem zweiten Aufruf. Der Fremdschluessel von playerboard_point_entries loescht mit
-- ("on delete cascade"): Punkte, die zwischen Zaehlen und Loeschen gespeichert wurden, gingen still
-- verloren. Den Fremdschluessel auf "restrict" zu stellen scheidet aus, weil das Loeschen einer
-- Verzeichnisperson (Betroffenenrechte) ueber denselben Kader-Eintrag kaskadiert.
--
-- Die Funktion sperrt den Kader-Eintrag vor der Pruefung. Eine Punktespeicherung haelt fuer ihren
-- Fremdschluessel eine KEY-SHARE-Sperre auf genau dieser Zeile: entweder wartet das Loeschen auf
-- ihren Commit und sieht die Punkte danach (jede Anweisung bekommt in READ COMMITTED einen neuen
-- Snapshot), oder die Punktespeicherung wartet und scheitert nach dem Loeschen am Fremdschluessel.
-- security invoker: playerboard_players_update/_delete (training.manage) bleiben die Pruefung.
create or replace function public.playerboard_delete_player(target_player_id uuid)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.playerboard_players where id = target_player_id for update;
  if not found then
    return 'not_found';
  end if;
  if exists (select 1 from public.playerboard_point_entries where player_id = target_player_id) then
    return 'player_has_points';
  end if;
  delete from public.playerboard_players where id = target_player_id;
  if not found then
    return 'not_found';
  end if;
  return 'deleted';
end;
$$;

revoke all on function public.playerboard_delete_player(uuid) from public;
grant execute on function public.playerboard_delete_player(uuid) to authenticated;

commit;
