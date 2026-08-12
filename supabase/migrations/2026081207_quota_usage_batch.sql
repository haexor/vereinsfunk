begin;

-- GET /v1/analytics/summary listet die Kontingentauslastung eines Vereins und rief dafuer
-- count_publications_in_period je Kontingentzeile einzeln auf -- ein Round-Trip pro Zeile (N+1).
-- Ein Verein mit vielen Abteilungen und Kanaelen erzeugte damit bei jeder Auswertungsanfrage
-- entsprechend viele Aufrufe, obwohl es fachlich eine einzige Frage ist.
--
-- Die Zaehllogik selbst bleibt bewusst an genau einer Stelle: diese Funktion ruft
-- count_publications_in_period pro Zeile auf, statt die Perioden- und Statusregeln ein zweites Mal
-- auszuschreiben. Eine Kopie waere die naechste Stelle, die bei einer Regelaenderung von
-- schedule_publication() abdriftet -- und dann meldete die Auswertung eine andere Auslastung, als
-- die Sperre beim Veroeffentlichen tatsaechlich anwendet.
create or replace function public.count_publications_for_quotas(
  target_organization uuid, reference timestamptz
) returns table (quota_id uuid, used integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select quota.id,
         public.count_publications_in_period(
           quota.organization_id, quota.department_id, quota.team_id,
           quota.social_connection_id, quota.period, reference
         )
  from public.channel_quotas quota
  where quota.organization_id = target_organization;
$$;

-- Dieselbe Begruendung wie bei count_publications_in_period: die Funktion prueft keine
-- Mitgliedschaft, ein Grant an authenticated legte die Veroeffentlichungszahlen eines FREMDEN
-- Vereins offen. Die API prueft analytics.view fuer den angefragten Scope, bevor sie aufruft.
revoke all on function public.count_publications_for_quotas(uuid, timestamptz) from public;
grant execute on function public.count_publications_for_quotas(uuid, timestamptz) to service_role;

commit;
