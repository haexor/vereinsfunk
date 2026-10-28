begin;

-- Die API prueft training.manage vor dem Aufruf. Der Service-Client fuehrt danach die atomare
-- Punktepruefung und Loeschung aus, ohne dass RLS Zeilen in dieser Pruefung ausblenden kann.
grant execute on function public.playerboard_delete_player(uuid) to service_role;
comment on function public.playerboard_delete_player(uuid) is
  'Atomare Kader-Loeschung ohne vorhandene Punkte. Die API autorisiert den Aufrufer mit training.manage vor dem Service-Role-Aufruf.';

commit;
