begin;

-- Ein Spieler soll auch dann vollstaendig aus dem Kader entfernbar sein, wenn es Punktestaende
-- gibt. Der FK playerboard_point_entries loescht diese Eintraege per ON DELETE CASCADE. Die Sperre
-- serialisiert das Entfernen mit parallelen Punkte-INSERTs.
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
  delete from public.playerboard_players where id = target_player_id;
  if not found then
    return 'not_found';
  end if;
  return 'deleted';
end;
$$;

comment on function public.playerboard_delete_player(uuid) is
  'Atomare Kader-Loeschung. Zugehoerige Punktestaende werden durch ON DELETE CASCADE mit entfernt; der Aufrufer muss training.manage pruefen.';

commit;
