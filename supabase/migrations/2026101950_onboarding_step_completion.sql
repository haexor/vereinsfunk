begin;

-- POST /v1/onboarding/steps/:step/complete las completed_steps, ergaenzte den Schritt in der API
-- und schrieb das ganze Array zurueck. Zwei gleichzeitig abgeschlossene Schritte ueberschrieben
-- sich dabei, einer ging verloren. Das Anhaengen passiert jetzt in einer einzigen UPDATE-Anweisung:
-- ein gleichzeitiger zweiter Aufruf wartet auf die Zeilensperre des ersten und rechnet danach auf
-- dessen Ergebnis weiter.
-- security invoker: organization_onboarding_update (organization.manage) bleibt die Pruefung.
create or replace function public.complete_onboarding_step(target_organization_id uuid, target_step text)
returns table (completed_steps text[], dismissed_at timestamptz)
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.organization_onboarding o
     set completed_steps = case when target_step = any(o.completed_steps) then o.completed_steps else o.completed_steps || target_step end
   where o.organization_id = target_organization_id
  returning o.completed_steps, o.dismissed_at;
$$;

revoke all on function public.complete_onboarding_step(uuid, text) from public;
grant execute on function public.complete_onboarding_step(uuid, text) to authenticated;

commit;
