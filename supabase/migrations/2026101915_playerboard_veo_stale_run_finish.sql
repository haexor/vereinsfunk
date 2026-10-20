begin;

-- Die Freigabe haengender Veo-Laeufe (> 2 h 'running') setzte integration_sync_runs direkt auf
-- 'failed' und uebersprang damit playerboard_veo_finish_sync: consecutive_failures,
-- last_error_code und integration_sources.last_sync_status blieben unveraendert -- ein Lauf, der
-- jedes Mal haengen bleibt, zaehlte nie als Fehllauf, und die Trainer erfuhren nie davon.
-- Jetzt laeuft jeder haengende Lauf durch dieselbe Abschlusslogik wie ein vom Worker beendeter.
-- Die Benachrichtigungsmail verschickt nur der Worker (veoSync.ts) anhand des notify-Ergebnisses;
-- dieser Cron-Pfad kann das nicht. Verlangt finish_sync hier eine Benachrichtigung, bleibt
-- failure_notified_at deshalb offen -- sonst gaelte die Serie als gemeldet, ohne dass eine Mail
-- rausging. Der naechste vom Worker abgeschlossene Fehllauf meldet sie dann.
create or replace function public.playerboard_veo_enqueue_scheduled_syncs() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  due record;
  stale record;
  finished record;
  enqueued integer := 0;
  outcome record;
begin
  for stale in
    select run.id
      from public.integration_sync_runs run
      join public.playerboard_veo_links veo on veo.integration_source_id = run.source_id
     where run.status = 'running'
       and run.started_at < now() - interval '2 hours'
  loop
    for finished in select * from public.playerboard_veo_finish_sync(stale.id, 'failed', 'stale_run', 0, 0, 0, 0) loop
      if finished.notify then
        update public.playerboard_veo_links set failure_notified_at = null where team_id = finished.team_id;
      end if;
    end loop;
  end loop;

  for due in
    select veo.organization_id, veo.integration_source_id
      from public.playerboard_veo_links veo
      join public.integration_sources source on source.id = veo.integration_source_id
     where source.enabled
       and veo.last_error_code is distinct from 'auth_expired'
       and authz.module_enabled(veo.organization_id, veo.department_id, veo.team_id, 'playerboard')
  loop
    select * into outcome from public.enqueue_integration_sync(
      due.organization_id, due.integration_source_id,
      'schedule:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), gen_random_uuid(), null
    );
    if outcome.result = 'acquired' then enqueued := enqueued + 1; end if;
  end loop;
  return enqueued;
end;
$$;
revoke all on function public.playerboard_veo_enqueue_scheduled_syncs() from public, anon, authenticated;
grant execute on function public.playerboard_veo_enqueue_scheduled_syncs() to service_role;

commit;
