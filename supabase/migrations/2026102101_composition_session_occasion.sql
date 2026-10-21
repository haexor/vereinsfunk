begin;

-- Ein Beitrag aus dem Kalender behaelt seinen Anlass (Spiel oder Veranstaltung), wie es
-- 2026080704_fixtures_and_events.sql fuer submissions eingefuehrt hat. Die Textwerkstatt hatte den
-- Bezug verloren: ?fixtureId=/?clubEventId= oeffneten ein leeres Formular, die Anlassvorschlaege
-- erkannten keinen Beitrag aus der Textwerkstatt, und eine spaetere Korrektur im Spielplan
-- invalidierte keine laufende Freigabe. Herkunft und Faktenschnappschuss setzt nur die API
-- (services/scheduleOccasion.ts) mit dem Service-Client; authenticated darf composition_sessions
-- weiterhin nur lesen.
alter table public.composition_sessions
  add column fixture_id uuid,
  add column club_event_id uuid,
  add column source_provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_provenance) = 'object'),
  add column source_revision_at timestamptz,
  add column source_prefill_snapshot jsonb
    check (source_prefill_snapshot is null or jsonb_typeof(source_prefill_snapshot) = 'object'),
  add constraint composition_sessions_single_occasion check (fixture_id is null or club_event_id is null),
  add constraint composition_sessions_fixture_fk
    foreign key (organization_id, fixture_id) references public.fixtures(organization_id, id) on delete set null (fixture_id),
  add constraint composition_sessions_event_fk
    foreign key (organization_id, club_event_id) references public.club_events(organization_id, id) on delete set null (club_event_id);

create index composition_sessions_fixture_idx on public.composition_sessions(fixture_id) where fixture_id is not null;
create index composition_sessions_club_event_idx on public.composition_sessions(club_event_id) where club_event_id is not null;

-- Dieselbe Invalidierung wie bisher fuer Beitraege aus submissions, jetzt auch fuer Beitraege aus
-- der Textwerkstatt (composition_sessions.post_id).
create or replace function public.invalidate_approvals_for_fixture_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.approval_requests
  set invalidated_at = now()
  where invalidated_at is null
    and post_id in (
      select post.id from public.posts post
      join public.submissions submission on submission.id = post.submission_id
      where submission.fixture_id = new.id
      union
      select session.post_id from public.composition_sessions session
      where session.fixture_id = new.id and session.post_id is not null
    );
  return new;
end;
$$;

create or replace function public.invalidate_approvals_for_club_event_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.approval_requests
  set invalidated_at = now()
  where invalidated_at is null
    and post_id in (
      select post.id from public.posts post
      join public.submissions submission on submission.id = post.submission_id
      where submission.club_event_id = new.id
      union
      select session.post_id from public.composition_sessions session
      where session.club_event_id = new.id and session.post_id is not null
    );
  return new;
end;
$$;

commit;
