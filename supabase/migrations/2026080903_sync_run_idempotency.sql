-- Paket 026: pro Quelle/Bereich genau einen aktiven Apply-Lauf und einen stabilen
-- Idempotenzvertrag. Die Entscheidung und Anlage passieren in EINER Datenbankfunktion,
-- niemals als zwei TypeScript-Abfragen mit einem Rennen dazwischen.

alter table public.integration_sync_runs
  add column request_idempotency_key text not null default gen_random_uuid()::text
    check (char_length(request_idempotency_key) between 1 and 128);

alter table public.integration_sync_runs
  add constraint integration_sync_runs_idempotency_unique
    unique (organization_id, source_id, domain, request_idempotency_key);

-- Dry-Runs aendern keine Fachdaten und duerfen deshalb parallel Vorschauen erzeugen. Apply-Laeufe
-- dagegen werden je Quelle und Bereich serialisiert. Ein abgeschlossener Lauf gibt den Slot frei.
create unique index integration_sync_runs_active_apply_unique
  on public.integration_sync_runs (organization_id, source_id, domain)
  where mode = 'apply' and status = 'running';

create or replace function public.acquire_integration_sync_run(
  target_organization_id uuid,
  target_source_id uuid,
  target_domain public.integration_domain,
  target_mode text,
  target_request_idempotency_key text,
  target_correlation_id uuid,
  target_triggered_by uuid
)
returns table(result text, run_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_run_id uuid;
begin
  if target_mode not in ('dry_run', 'apply') then
    raise exception 'invalid sync mode' using errcode = '22023';
  end if;

  if char_length(target_request_idempotency_key) not between 1 and 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  -- Die Service Role darf diese Funktion aufrufen, der Aufrufer darf aber nicht eine Quelle
  -- einer anderen Organisation an die Laufzeile binden.
  perform 1 from public.integration_sources
    where id = target_source_id and organization_id = target_organization_id;
  if not found then
    raise exception 'integration source does not belong to organization' using errcode = 'P0002';
  end if;

  select id into existing_run_id
    from public.integration_sync_runs
    where organization_id = target_organization_id
      and source_id = target_source_id
      and domain = target_domain
      and request_idempotency_key = target_request_idempotency_key;
  if found then
    return query select 'replay'::text, existing_run_id;
    return;
  end if;

  if target_mode = 'apply' then
    select id into existing_run_id
      from public.integration_sync_runs
      where organization_id = target_organization_id
        and source_id = target_source_id
        and domain = target_domain
        and mode = 'apply'
        and status = 'running';
    if found then
      return query select 'already_running'::text, existing_run_id;
      return;
    end if;
  end if;

  begin
    insert into public.integration_sync_runs (
      organization_id, source_id, domain, mode, correlation_id, triggered_by,
      request_idempotency_key
    ) values (
      target_organization_id, target_source_id, target_domain, target_mode,
      target_correlation_id, target_triggered_by, target_request_idempotency_key
    ) returning id into existing_run_id;
    return query select 'acquired'::text, existing_run_id;
    return;
  exception when unique_violation then
    -- Entweder gewann gleichzeitig derselbe Idempotenz-Request oder ein anderer Apply-Lauf.
    -- Beide Faelle werden nach dem blockierenden Unique-Check aus der nun sichtbaren Zeile
    -- bestimmt; dadurch bleibt kein Check-then-insert-Fenster offen.
    select id into existing_run_id
      from public.integration_sync_runs
      where organization_id = target_organization_id
        and source_id = target_source_id
        and domain = target_domain
        and request_idempotency_key = target_request_idempotency_key;
    if found then
      return query select 'replay'::text, existing_run_id;
      return;
    end if;

    select id into existing_run_id
      from public.integration_sync_runs
      where organization_id = target_organization_id
        and source_id = target_source_id
        and domain = target_domain
        and mode = 'apply'
        and status = 'running';
    if found then
      return query select 'already_running'::text, existing_run_id;
      return;
    end if;
    raise;
  end;
end;
$$;

revoke all on function public.acquire_integration_sync_run(uuid, uuid, public.integration_domain, text, text, uuid, uuid) from public;
grant execute on function public.acquire_integration_sync_run(uuid, uuid, public.integration_domain, text, text, uuid, uuid) to service_role;

comment on column public.integration_sync_runs.request_idempotency_key is
  'API-Idempotenzschluessel: gleiche Quelle/Bereich/Schluessel liefert denselben Lauf, ohne erneut zu lesen oder anzuwenden.';
comment on function public.acquire_integration_sync_run(uuid, uuid, public.integration_domain, text, text, uuid, uuid) is
  'Atomarer Guard fuer HTTP- und kuenftige Cron-Syncs: Quelle pruefen, Replay liefern oder aktiven Apply-Lauf serialisieren.';
