begin;

-- Paket 016: Auswertung: interne Kennzahlen. Siehe plans/016-auswertung-interne-kennzahlen.md,
-- Abschnitt "Abweichungen vom Plan, vor der Umsetzung festgelegt" fuer die Begruendung der
-- Abweichungen vom urspruenglichen Entwurf (kein metrics_daily/metrics_by_preset_daily, kein
-- Aggregationsjob -- alle Kennzahlen werden live aus den Rohtabellen unten berechnet).

-- 1. Statushistorie -------------------------------------------------------------------------------
-- Ohne Historie ist keine Durchlaufzeit und kein "wie viele Beitraege wurden zum ersten Mal an
-- diesem Tag veroeffentlicht" rekonstruierbar -- posts.status ist nur der aktuelle Wert.
create table public.post_status_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  department_id uuid not null,
  team_id uuid,
  post_id uuid not null,
  from_status public.post_status,
  to_status public.post_status not null,
  actor_user_id uuid references public.profiles(id),
  actor_kind text not null default 'system' check (actor_kind in ('user', 'system', 'worker')),
  reason text,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, post_id)
    references public.posts(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id)
);
create index post_status_events_post_idx on public.post_status_events (post_id, occurred_at);
create index post_status_events_scope_idx on public.post_status_events (organization_id, department_id, to_status, occurred_at desc);

-- Ein Trigger statt Anwendungscode, weil posts.status auch aus Migrationen und kuenftigen Workern
-- geaendert wird (Plan, Abschnitt "Datenmodell") -- eine Historie mit Luecken waere schlimmer als
-- keine. Zwei Trigger statt einer kombinierten Bedingung: OLD steht im WHEN-Ausdruck eines
-- INSERT-Triggers nicht zur Verfuegung. auth.uid() bleibt auch innerhalb der SECURITY DEFINER-
-- Freigabefunktionen (decide_approval_stage, schedule_publication, ...) die tatsaechlich handelnde
-- Person, weil es den Sitzungs-JWT-Kontext liest, nicht die aktuelle Rolle -- deshalb reicht ein
-- einfacher (nicht SECURITY DEFINER) Funktionskoerper: alle posts-Schreibzugriffe laufen ohnehin
-- ausschliesslich ueber den Service-Client (kein insert/update-Grant an authenticated auf posts,
-- siehe 202608020003_api_grants.sql), der Trigger erbt also immer ausreichende Rechte fuer den
-- eigenen Insert.
-- Hinweis: alle heutigen Schreibzugriffe auf posts.status laufen ausschliesslich ueber den
-- Service-Client (siehe oben), der keinen Nutzer-JWT-Kontext an Postgres weiterreicht -- auth.uid()
-- liest hier deshalb in der Praxis durchgehend NULL, actor_kind wird durchgehend 'system'. Das ist
-- kein Fehler dieses Pakets: keine der in diesem Paket gebauten Kennzahlen liest actor_user_id/
-- actor_kind. Die Spalten bleiben fuer eine spaetere, hier nicht gebaute Zurechnung vorbereitet
-- (z. B. ueber ein von der aufrufenden Funktion gesetztes set_config()).
create or replace function public.record_post_status_event() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into public.post_status_events
    (organization_id, department_id, team_id, post_id, from_status, to_status, actor_user_id, actor_kind)
  values (
    new.organization_id, new.department_id, new.team_id, new.id,
    case when TG_OP = 'UPDATE' then old.status else null end,
    new.status,
    auth.uid(),
    case when auth.uid() is not null then 'user' else 'system' end
  );
  return new;
end;
$$;
create trigger posts_status_history_insert
  after insert on public.posts
  for each row execute function public.record_post_status_event();
create trigger posts_status_history_update
  after update of status on public.posts
  for each row when (old.status is distinct from new.status)
  execute function public.record_post_status_event();

alter table public.post_status_events enable row level security;
alter table public.post_status_events force row level security;
create policy post_status_events_select on public.post_status_events for select to authenticated
  using (authz.has_department_permission(department_id, 'analytics.view'));
grant select on public.post_status_events to authenticated;
grant all privileges on public.post_status_events to service_role;

-- 2. Aufbewahrung fuer die Statushistorie -----------------------------------------------------------
-- 2026080901_compliance_and_retention.sql liess status_event_days bewusst aus ("Nachzuziehen, sobald
-- 016/018 gebaut werden") -- das wird hier eingeloest. 730 Tage (24 Monate) als Standardwert, wie
-- vom Plan unter "Risiken und offene Entscheidungen" empfohlen ("24 Monate Rohereignisse ... sind
-- ein vernuenftiger Ausgangspunkt").
alter table public.retention_settings
  add column status_event_days integer not null default 730 check (status_event_days between 90 and 3650);

commit;
