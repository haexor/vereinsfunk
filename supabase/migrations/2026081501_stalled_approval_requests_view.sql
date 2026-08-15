-- Plan 031: GET /v1/approval-requests/stalled lud bisher ALLE approval_requests einer
-- Organisation (unbegrenzt mit der Historie wachsend) und filterte erst in TypeScript auf
-- "tatsaechlich festhaengend" -- eine Anfrage mit mindestens einer offenen/festhaengenden Stufe,
-- die entweder ueberfaellig ist oder deren Anfrage invalidiert wurde. Diese View zieht genau
-- dieselbe Bedingung serverseitig vor.
--
-- security_invoker = true (statt security definer): die View laeuft mit den Rechten der
-- aufrufenden Rolle, approval_requests_select/approval_stages_select (beide zuletzt erweitert in
-- 2026081002_review_route_reresolution.sql) greifen deshalb unveraendert weiter -- keine neue
-- Vertrauensgrenze, keine Funktion, die Berechtigungen nachbilden muesste.
create view public.stalled_approval_requests
  with (security_invoker = true) as
select
  request.id,
  request.organization_id,
  request.post_id,
  request.post_version_id,
  request.invalidated_at,
  bool_or(stage.deadline_at is not null and stage.deadline_at < now()) as is_overdue
from public.approval_requests request
join public.approval_stages stage
  on stage.approval_request_id = request.id and stage.organization_id = request.organization_id
where stage.status in ('open', 'stalled')
group by request.id, request.organization_id, request.post_id, request.post_version_id, request.invalidated_at
having request.invalidated_at is not null
  or bool_or(stage.deadline_at is not null and stage.deadline_at < now());

grant select on public.stalled_approval_requests to authenticated;
