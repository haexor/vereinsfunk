begin;

-- Paket 020: Rechtliche Pflichten und Datenschutzbetrieb. Siehe plans/020-rechtliche-pflichten-und-datenschutzbetrieb.md.

-- 1. Manipulationssicherer Audit-Trail (Nutzeranforderung 2026-08-05, Plan Abschnitt "4b") --------
-- chain_seq ist die Ordnungsspalte der Kette, nicht created_at: now() ist innerhalb EINER
-- Transaktion konstant (Postgres liefert den Transaktionsstart, nicht die Anweisungszeit) --
-- mehrere audit_events-Inserts in derselben Transaktion (z. B. eine Kaskade wie
-- invalidate_approvals_for_consent_revocation, die in einer Schleife mehrere Eintraege schreibt)
-- haetten identisches created_at, und id (ein zufaelliges UUID) korreliert nicht mit der
-- Einfuegereihenfolge -- "order by created_at desc, id desc" waere dann effektiv zufaellig
-- (gefunden beim eigenen pgTAP-Test dieses Pakets). generated always as identity garantiert echte
-- Einfuegereihenfolge, auch innerhalb derselben Transaktion.
alter table public.audit_events
  add column chain_seq bigint generated always as identity,
  add column prev_hash text,
  add column hash text;

-- Kette je Verein: jede Zeile haengt am Hash der zuvor eingefuegten Zeile desselben Vereins.
-- Advisory-Lock ist notwendig, nicht nur vorsichtig: ohne ihn koennten zwei gleichzeitige Inserts
-- fuer denselben Verein denselben "letzten" Hash lesen und zwei Zeilen mit demselben prev_hash
-- erzeugen (ein Fork statt einer Kette) -- der Lock serialisiert Ketten-Anhaenge je Verein
-- innerhalb der Transaktion, andere Vereine bleiben unabhaengig (gleiches Muster wie
-- create_organization()'s "create_organization:<user>"-Lock, hier je Verein statt je Nutzer).
create or replace function public.compute_audit_event_hash() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  previous_hash text;
  canonical text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));

  select hash into previous_hash from public.audit_events
    where organization_id = new.organization_id
    order by chain_seq desc
    limit 1;

  -- extract(epoch from ...) statt created_at::text: Letzteres rendert abhaengig von der
  -- TimeZone/DateStyle-Einstellung der jeweiligen Datenbanksitzung (gefunden im eigenen Review) --
  -- eine Kette, die mit einer anderen Sitzungs-TimeZone nachgerechnet wird, haette sonst einen
  -- falschen Manipulationsalarm fuer die gesamte Historie geworfen, ohne dass etwas manipuliert war.
  canonical := new.id::text || '|' || new.organization_id::text || '|' || coalesce(new.actor_user_id::text, '') || '|'
    || new.action || '|' || new.entity_type || '|' || coalesce(new.entity_id::text, '') || '|'
    || new.correlation_id::text || '|' || new.metadata::text || '|' || extract(epoch from new.created_at)::text;

  new.prev_hash := previous_hash;
  new.hash := encode(extensions.digest(coalesce(previous_hash, '') || canonical, 'sha256'), 'hex');
  return new;
end;
$$;
create trigger audit_events_compute_hash before insert on public.audit_events
  for each row execute function public.compute_audit_event_hash();

-- Signierte Kopf-Hash-Schnappschuesse je Verein: mit einem Schluessel signiert, der nicht in der
-- Datenbank liegt (SECRET_BOX_KEYS, siehe packages/secrets createChainSigner). Ein periodischer
-- Cron dafuer fehlt weiterhin (Paket 004 "in Arbeit", gleiche Lücke wie bei jedem anderen Job in
-- diesem Plan) -- POST /v1/organizations/:id/audit-chain/sign loest ihn bis dahin manuell aus.
-- Der Zweck: auch nach einer spaeteren Aufbewahrungsloeschung aelterer audit_events (unten,
-- audit_event_days) bleibt beweisbar, dass die Kette bis zu einem Zeitpunkt unveraendert war --
-- verify_audit_chain kann nur noch lokale Konsistenz der VERBLEIBENDEN Zeilen pruefen, keine
-- geloeschten Praefixe rekonstruieren. Das ist eine inhaerente Spannung zwischen Loeschpflicht und
-- Manipulationssicherheit, keine Nachlaessigkeit -- siehe Plan, Abschnitt "Umsetzung: Ergebnis und
-- Abweichungen vom Plan".
create table public.audit_chain_signatures (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_count bigint not null check (event_count >= 0),
  head_hash text,
  key_version text not null,
  signature text not null,
  signed_at timestamptz not null default now()
);
create index audit_chain_signatures_scope_idx on public.audit_chain_signatures (organization_id, signed_at desc);
alter table public.audit_chain_signatures enable row level security;
alter table public.audit_chain_signatures force row level security;
create policy audit_chain_signatures_select on public.audit_chain_signatures for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
grant select on public.audit_chain_signatures to authenticated;
grant all privileges on public.audit_chain_signatures to service_role;

-- Prueffunktion: erkennt lokal manipulierte Zeilen (hash passt nicht mehr zu prev_hash+Inhalt --
-- gilt unabhaengig von jeder Nachbarzeile, auch nach einer Aufbewahrungsloeschung) und meldet
-- zusaetzlich informativ unverkettete Nachbarn innerhalb der verbliebenen Zeilen (das ist nach
-- einer regulaeren Loeschung am aeltesten verbliebenen Datensatz in der Regel der Fall und beweist
-- fuer sich allein kein Tampering -- eine boesartige Loeschung MITTIGER Zeilen erzeugt dasselbe
-- Signal und ist davon nicht unterscheidbar; dafuer ist die kryptografische Pruefung der
-- signierten Schnappschuesse da, siehe GET .../audit-chain/verify in apps/api). Nur service_role:
-- Aufruf ausschliesslich aus der API nach organization.manage-Pruefung, gleiches Muster wie
-- cleanup_expired_oauth_state().
create or replace function public.verify_audit_chain(target_organization_id uuid)
returns table(checked_count bigint, tampered_count bigint, unlinked_count bigint)
language sql stable set search_path = public, pg_temp as $$
  with ordered as (
    select
      hash, prev_hash,
      lag(hash) over (order by chain_seq) as expected_prev_hash,
      (id::text || '|' || organization_id::text || '|' || coalesce(actor_user_id::text, '') || '|'
        || action || '|' || entity_type || '|' || coalesce(entity_id::text, '') || '|'
        || correlation_id::text || '|' || metadata::text || '|' || extract(epoch from created_at)::text) as canonical
    from public.audit_events
    where organization_id = target_organization_id
  )
  select
    count(*),
    count(*) filter (where hash is distinct from encode(extensions.digest(coalesce(prev_hash, '') || canonical, 'sha256'), 'hex')),
    count(*) filter (where expected_prev_hash is not null and prev_hash is distinct from expected_prev_hash)
  from ordered;
$$;
revoke all on function public.verify_audit_chain(uuid) from public;
grant execute on function public.verify_audit_chain(uuid) to service_role;

-- 2. Aufbewahrung: Fristen je Verein, mit belastbaren Obergrenzen ---------------------------------
create table public.retention_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  raw_media_days integer not null default 90 check (raw_media_days between 7 and 730),
  derivative_days integer check (derivative_days between 30 and 3650),
  audit_event_days integer not null default 1095 check (audit_event_days between 365 and 3650),
  consent_evidence_years integer not null default 5 check (consent_evidence_years between 1 and 30),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- comment_text_days und status_event_days aus dem Plan-DDL fehlen bewusst: publication_comments
-- (Paket 018) und post_status_events (Paket 016) existieren noch nicht (beide Pakete nicht
-- umgesetzt, siehe Repo-weite Suche im eigenen Review) -- eine Frist fuer eine nicht existierende
-- Tabelle waere eine erfundene Konfigurationsmoeglichkeit ohne Wirkung. Nachzuziehen, sobald 016/018
-- gebaut werden.
-- delete_media_on_person_leave aus dem Plan-DDL fehlt ebenfalls bewusst: die Spalte haette keinen
-- Job, der sie auswertet -- ein Mitgliederaustritt loest heute keine Medienpruefung aus (dafuer
-- fehlt die Verknuepfung "welche Rohmedien zeigen ausschliesslich diese Person", die es ohne
-- Gesichtserkennung/Personenzuordnung nicht geben darf, siehe plans/README.md "Keine
-- Gesichtserkennung oder biometrischen Profile"). Ein Schalter ohne Wirkung waere dieselbe
-- Zusage-ohne-Job-Fehlerklasse wie die urspruengliche Dummy-Zeile, zu deren Beseitigung dieses
-- Paket existiert.
-- Bestandsvereine (angelegt vor dieser Migration) bekommen die Standardwerte nachgetragen, damit
-- der Aufbewahrungs-Endpunkt nicht zwischen "keine Zeile" und "Standardwerte" unterscheiden muss --
-- updated_by ist not null, daher nur fuer Vereine mit mindestens einer/einem organization_owner.
insert into public.retention_settings (organization_id, updated_by)
select organization.id, (
  select membership.user_id from public.organization_memberships membership
  where membership.organization_id = organization.id and membership.role = 'organization_owner'
  order by membership.created_at limit 1
)
from public.organizations organization
where not exists (select 1 from public.retention_settings existing where existing.organization_id = organization.id)
  and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = organization.id and membership.role = 'organization_owner'
  );

alter table public.retention_settings enable row level security;
alter table public.retention_settings force row level security;
create policy retention_settings_select on public.retention_settings for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
grant select on public.retention_settings to authenticated;
grant all privileges on public.retention_settings to service_role;
create trigger set_retention_settings_updated_at before update on public.retention_settings
  for each row execute function public.set_updated_at();

-- Was geloescht wurde, bleibt als Tatsache nachweisbar -- ohne die Daten selbst (kein entity_id,
-- keine Namen: ein Loeschprotokoll, das die geloeschten Daten benennt, hat nichts geloescht).
create table public.retention_deletions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_count integer not null check (entity_count >= 0),
  rule_key text not null,
  cutoff_date date not null,
  dry_run boolean not null default false,
  correlation_id uuid not null,
  executed_at timestamptz not null default now()
);
create index retention_deletions_scope_idx on public.retention_deletions (organization_id, executed_at desc);
alter table public.retention_deletions enable row level security;
alter table public.retention_deletions force row level security;
create policy retention_deletions_select on public.retention_deletions for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
grant select on public.retention_deletions to authenticated;
grant all privileges on public.retention_deletions to service_role;

-- 3. Betroffenenrechte: Auskunft, Loeschung, Berichtigung, Widerspruch, Datenuebertragbarkeit -----
create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('access', 'deletion', 'rectification', 'objection', 'portability')),
  subject_kind text not null check (subject_kind in ('member', 'directory_person', 'guardian', 'external')),
  directory_person_id uuid,
  subject_label text not null check (char_length(subject_label) between 1 and 200),
  received_at date not null,
  -- Wird beim Anlegen per Trigger aus received_at gesetzt (unten), nicht vom Aufrufer -- ein
  -- Kalendermonat, keine 30 Tage: die DSGVO rechnet in Kalendermonaten, das faellt je nach Monat
  -- unterschiedlich aus.
  due_at date not null,
  extended_until date check (extended_until is null or extended_until > due_at),
  extension_reason text, extension_notified_at timestamptz,
  check (extension_reason is null or extended_until is not null),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed', 'rejected', 'partially_completed')),
  resolution_note text,
  handled_by uuid references public.profiles(id), completed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- Spaltenliste bei SET NULL: sonst wuerde auch organization_id genullt (gleiches Muster wie an
  -- jeder anderen Stelle dieses Projekts mit SET NULL auf einem Verbundschluessel). Der Nachweis
  -- der Bearbeitung (subject_label, Frist, Status) bleibt bestehen, auch wenn die Verzeichnisperson
  -- selbst geloescht wird -- sonst verschwindet der Nachweis der Anfrage mit der Loeschung, die sie
  -- dokumentiert.
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete set null (directory_person_id)
);
create index data_subject_requests_scope_idx on public.data_subject_requests (organization_id, status, due_at);
alter table public.data_subject_requests enable row level security;
alter table public.data_subject_requests force row level security;
create policy data_subject_requests_select on public.data_subject_requests for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
grant select on public.data_subject_requests to authenticated;
grant all privileges on public.data_subject_requests to service_role;
create trigger set_data_subject_requests_updated_at before update on public.data_subject_requests
  for each row execute function public.set_updated_at();

create or replace function public.set_data_subject_request_due_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.due_at := (new.received_at + interval '1 month')::date;
  return new;
end;
$$;
create trigger data_subject_requests_set_due_at before insert on public.data_subject_requests
  for each row execute function public.set_data_subject_request_due_at();

-- Loeschung eines Verzeichniseintrags (POST /v1/data-subjects/:personId/erase) darf keinen
-- Einwilligungsnachweis mitreissen: consent_records bleibt Nachweis, nur die identifizierende
-- Verknuepfung verschwindet. War bislang "on delete restrict" -- eine Loeschung waere an jeder
-- Person mit auch nur einer Einwilligung gescheitert, obwohl genau diese Personen (Minderjaehrige
-- mit Medien) der Hauptfall fuer eine Loeschanfrage sind (gefunden beim Entwurf dieses Pakets).
alter table public.consent_records drop constraint consent_records_person_fk;
alter table public.consent_records add constraint consent_records_person_fk
  foreign key (organization_id, directory_person_id)
  references public.directory_people(organization_id, id) on delete set null (directory_person_id);

-- POST /v1/data-subjects/:personId/erase entfernt bislang nur die Verknuepfung zur Person
-- (directory_person_id), behauptet in der Antwort aber "Verknuepfung zur Person entfernt" als
-- vollstaendig -- zwei weitere Spalten derselben Zeile tragen die Identitaet unveraendert weiter
-- und machen die Loeschung wirkungslos (adversariale Pruefung: pseudonymous_subject_ref ist beim
-- Papierweg haeufig exakt die directory_person_id, signer_name ist bei Papiereinwilligungen der
-- Klarname der unterschreibenden Person bzw. eines Elternteils). Beide muessen von der API beim
-- Erase mitgeloescht werden koennen, ohne den Nachweis selbst (Umfang, Zeitpunkt, Nachweisdatei)
-- zu entfernen.
alter table public.consent_records alter column pseudonymous_subject_ref drop not null;
alter table public.consent_records alter column signer_name drop not null;

-- Einwilligungsnachweise: erst nach consent_evidence_years ab Ende der Gueltigkeit (Plan, Abschnitt
-- "1. Aufbewahrung durchsetzen") -- bislang stand das nur im Formular und in retention_settings,
-- ohne dass irgendein Code die Nachweisdatei je geloescht haette (adversariale Pruefung: dieselbe
-- Zusage-ohne-Job-Fehlerklasse wie die urspruengliche "Rohmedien Loeschung nach 90 Tagen"-Dummy-
-- Zeile, zu deren Beseitigung dieses Paket existiert). evidence_path wird nullbar, weil die Zeile
-- selbst (Umfang, Unterzeichnungsdatum, Widerruf) als Nachweis der ENTSCHEIDUNG bestehen bleibt --
-- nur die Nachweisdatei mit Unterschrift/Kontaktdaten verschwindet.
alter table public.consent_records alter column evidence_path drop not null;
alter table public.consent_records add column evidence_deleted_at timestamptz;

-- Ende der Gueltigkeit ist der Widerruf, wenn vorhanden, sonst das gesetzte Ablaufdatum -- eine
-- Einwilligung ohne beides ist unbefristet gueltig und nie ein Kandidat fuer diese Regel. Derselbe
-- Cross-Tenant-Schutz wie bei select_expired_raw_media, obwohl consent_records fuer authenticated
-- ohnehin keinen Insert-Grant hat (Paket 015) -- konsistent, nicht weil hier ausnutzbar.
create or replace function public.select_expired_consent_evidence(target_organization_id uuid, cutoff timestamptz)
returns table(consent_record_id uuid, bucket_id text, object_path text)
language sql stable set search_path = public, pg_temp as $$
  select record.id, record.evidence_bucket, record.evidence_path
  from public.consent_records record
  where record.organization_id = target_organization_id
    and record.evidence_path is not null
    and coalesce(record.revoked_at, record.valid_until) is not null
    and coalesce(record.revoked_at, record.valid_until) < cutoff
    and record.evidence_path like ('organizations/' || target_organization_id::text || '/%');
$$;
revoke all on function public.select_expired_consent_evidence(uuid, timestamptz) from public;
grant execute on function public.select_expired_consent_evidence(uuid, timestamptz) to service_role;

-- 4. Dokumentation der Verarbeitungen und Auftragsverarbeiter --------------------------------------
create table public.processing_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null check (char_length(purpose) between 1 and 300),
  legal_basis text not null check (char_length(legal_basis) between 1 and 1000),
  data_categories text[] not null default '{}',
  subject_categories text[] not null default '{}',
  recipients text[] not null default '{}',
  third_country_transfer boolean not null default false,
  transfer_safeguard text,
  check (not third_country_transfer or transfer_safeguard is not null),
  retention_note text not null check (char_length(retention_note) between 1 and 1000),
  reviewed_at date, reviewed_by uuid references public.profiles(id),
  check ((reviewed_at is null) = (reviewed_by is null)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index processing_records_scope_idx on public.processing_records (organization_id, created_at);
alter table public.processing_records enable row level security;
alter table public.processing_records force row level security;
create policy processing_records_select on public.processing_records for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
grant select on public.processing_records to authenticated;
grant all privileges on public.processing_records to service_role;
create trigger set_processing_records_updated_at before update on public.processing_records
  for each row execute function public.set_updated_at();

create table public.processor_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processor_name text not null check (char_length(processor_name) between 1 and 200),
  purpose text not null check (char_length(purpose) between 1 and 300),
  signed_at date, valid_until date check (valid_until is null or signed_at is null or valid_until > signed_at),
  -- raw-media, nicht brand-assets: dort liegen schon die Einwilligungsnachweise aus Paket 015, und
  -- brand-assets erlaubt nur SVG, PNG, JPEG und WOFF2 -- ein Vertrag als PDF/DOCX passt dort nicht
  -- hinein (siehe Plan, Abschnitt "Datenmodell").
  document_bucket text not null default 'raw-media' check (document_bucket = 'raw-media'),
  document_path text,
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'terminated')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index processor_agreements_scope_idx on public.processor_agreements (organization_id, status);
alter table public.processor_agreements enable row level security;
alter table public.processor_agreements force row level security;
create policy processor_agreements_select on public.processor_agreements for select to authenticated
  using (authz.has_organization_permission(organization_id, 'organization.manage'));
grant select on public.processor_agreements to authenticated;
grant all privileges on public.processor_agreements to service_role;
create trigger set_processor_agreements_updated_at before update on public.processor_agreements
  for each row execute function public.set_updated_at();

-- Vertraege als PDF oder DOCX -- additiv, gleiches Muster wie die PDF-Ergaenzung aus Paket 015
-- (raw-media traegt beide Nachweisarten unter unterschiedlichen Pfadpraefixen, siehe Storage-
-- Policy unten). application/json fuer das Auskunftsbuendel aus GET /v1/data-subjects/:personId/export
-- (organizations/<org>/exports/<uuid>.json) -- ohne diesen Eintrag lehnt Storage den Upload mit
-- invalid_mime_type ab und der Auskunftsendpunkt waere gegen echtes Supabase Storage nie benutzbar
-- (adversariale Pruefung, im Vitest-Fake unbemerkt, weil der dortige Storage-Stub keine MIME-Liste kennt).
update storage.buckets
set allowed_mime_types = array(select distinct unnest(
  allowed_mime_types || array['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/json']
))
where id = 'raw-media';

-- 5. Kanalbezogene Pflichtangaben und presserechtliche Verantwortung -------------------------------
alter table public.social_connections
  add column imprint_url text,
  add column privacy_url text,
  -- Presserechtliche Verantwortung fuer redaktionelle Inhalte (§ 18 MStV), getrennt von
  -- responsible_profile_id aus Paket 012 (dort: wer im Verein fuer den Kanal zustaendig ist).
  add column editorial_responsible_profile_id uuid references public.profiles(id),
  add column editorial_responsible_note text check (char_length(editorial_responsible_note) <= 500);

revoke select on public.social_connections from authenticated;
grant select (
  id, organization_id, platform, external_account_id, display_name, scopes, token_expires_at,
  status, last_verified_at, metadata, owner_scope, owner_department_id, responsible_profile_id,
  purpose, archived_at, confidential, imprint_url, privacy_url, editorial_responsible_profile_id,
  editorial_responsible_note, created_at, updated_at
) on public.social_connections to authenticated;

-- 6. Storage: Pfadpraefix-Rechte innerhalb von raw-media -------------------------------------------
-- Bislang galt fuer raw-media, rendered-media und brand-assets dieselbe, rein vereinsweite Regel
-- (jedes Mitglied liest jedes Objekt seines Vereins) -- ausreichend fuer Submissions/Renders, aber
-- zu weit fuer Einwilligungsnachweise (organizations/<org>/consents/<id>/...) und
-- Auftragsverarbeitungsunterlagen (organizations/<org>/compliance/<id>/...), die seit Paket 015 im
-- selben Bucket liegen. Ab hier durchgesetzt in der Storage-Policy selbst, nicht erst in der API
-- (Plan, Abschnitt "Datenmodell").
create or replace function authz.can_read_consent_evidence_object(target_organization_id uuid, target_consent_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not exists (
      select 1 from public.consent_records record
      where record.organization_id = target_organization_id and record.id = target_consent_id
    ) then false
    else coalesce((
      select authz.has_department_permission(person.department_id, 'consent.manage')
      from public.consent_records record
      join public.directory_people person
        on person.organization_id = record.organization_id and person.id = record.directory_person_id
      where record.organization_id = target_organization_id and record.id = target_consent_id
        and record.directory_person_id is not null and person.department_id is not null
    ), authz.has_organization_permission(target_organization_id, 'consent.manage'))
  end;
$$;
revoke all on function authz.can_read_consent_evidence_object(uuid, uuid) from public;
grant execute on function authz.can_read_consent_evidence_object(uuid, uuid) to authenticated;

drop policy storage_read_own_organization on storage.objects;

-- authz.is_any_member_of_organization statt authz.is_organization_member (wie in der urspruenglichen
-- Policy): Letzteres prueft nur organization_memberships und uebersieht ein reines Abteilungs- oder
-- Team-Mitglied ohne eigene Vereinsrolle -- derselbe Fund, der in Paket 023 fuer andere RLS-Policies
-- bereits behoben wurde (plans/README.md, "Mitgliedersichtbarkeit vereinsweit"), hier aber beim
-- eigenen pgTAP-Test dieses Pakets erneut aufgefallen ist, weil beide Storage-Policies neu
-- geschrieben werden mussten.
create policy storage_read_own_organization on storage.objects for select to authenticated
using (
  bucket_id in ('rendered-media', 'brand-assets')
  and (storage.foldername(name))[1] = 'organizations'
  and authz.is_any_member_of_organization(((storage.foldername(name))[2])::uuid)
);

create policy storage_read_raw_media on storage.objects for select to authenticated
using (
  bucket_id = 'raw-media'
  and (storage.foldername(name))[1] = 'organizations'
  and case (storage.foldername(name))[3]
    when 'compliance' then authz.has_organization_permission(((storage.foldername(name))[2])::uuid, 'organization.manage')
    when 'exports' then authz.has_organization_permission(((storage.foldername(name))[2])::uuid, 'organization.manage')
    -- Regex-Vorabpruefung, bevor Segment 4 in uuid gecastet wird: ein RLS-Policy-Ausdruck laeuft
    -- ueber JEDE gescannte Zeile einer Abfrage -- eine einzelne Zeile mit einem nicht-UUID-foermigen
    -- vierten Segment wuerde sonst die gesamte Abfrage mit einem Cast-Fehler abbrechen, nicht nur den
    -- Zugriff auf diese eine Zeile verweigern (kein aktueller Schreibpfad erzeugt so einen Namen,
    -- aber RLS ist die eigentliche Sicherheitsgrenze und sollte sich nicht darauf verlassen).
    when 'consents' then
      (storage.foldername(name))[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and authz.can_read_consent_evidence_object(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[4])::uuid)
    -- Abteilungsscope statt vereinsweit (adversariale Pruefung, siehe Abweichungen im Plan): die
    -- urspruengliche Fassung dieser Zeile nutzte authz.is_any_member_of_organization und hat damit
    -- ein reines Team- oder Abteilungsmitglied ohne Vereinsrolle Lesezugriff auf die ROHMEDIEN
    -- JEDER Abteilung des Vereins gegeben, nicht nur der eigenen -- genau die Population, der
    -- plans/README.md ausdrueckich nur "Zugriff auf Text und freigegebene Derivate", nie auf
    -- Rohmedien zugesteht. departments/<deptId>/... ist das einzige heute verwendete Praefix unter
    -- raw-media (Submissions) -- dort wird auf die tatsaechliche Abteilung geprueft, nicht
    -- vereinsweit; authz.is_department_member faellt intern bereits auf eine Vereinsrolle zurueck,
    -- ein organization_admin sieht also weiterhin alles.
    when 'departments' then
      (storage.foldername(name))[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and authz.is_department_member(((storage.foldername(name))[4])::uuid)
    else authz.is_any_member_of_organization(((storage.foldername(name))[2])::uuid)
  end
);

-- 7. Retention-Kandidaten ermitteln (nur Auswahl -- geloescht wird aus der API: das Storage-Objekt
-- selbst braucht einen HTTP-Aufruf an Supabase Storage, keine reine SQL-Operation) --------------
-- Sicherer als die Wortwahl des Plans ("kein freigegebenes Derivat"): ausgeschlossen wird jedes
-- Medienobjekt mit IRGENDEINEM Derivat, unabhaengig vom Status -- media_derivatives verweist mit
-- on delete restrict auf media_assets, ein Objekt mit einem nicht-fertigen Derivat wuerde die
-- Datenbank sonst gar nicht erst loeschen lassen. Gleiches Prinzip fuer Derivate: ausgeschlossen ist
-- jedes Derivat mit irgendeiner Referenz aus post_media/approval_media_snapshots/
-- publication_media_grants, nicht nur solche aus veroeffentlichten Publikationen -- alle drei
-- Tabellen verweisen ebenfalls mit on delete restrict (post_media, approval_media_snapshots) bzw.
-- ohne on delete-Klausel (publication_media_grants, per Definition ebenso blockierend).
--
-- KRITISCHER FUND (adversariale Pruefung, siehe Abweichungen im Plan): media_assets.object_path
-- ist ein freier Text ohne CHECK gegen organization_id (vorbestehende Luecke seit der ersten
-- Content-Pipeline-Migration) -- ein Mitglied mit post.create in seinem EIGENEN Verein A kann per
-- INSERT eine media_assets-Zeile mit organization_id=A, aber object_path='organizations/<Verein
-- B>/...' anlegen. Vor diesem Paket war das folgenlos, weil kein Code Storage-Objekte anhand dieser
-- Spalte loescht. Seit POST /v1/organizations/:id/retention/run das mit Service-Role tut (der Pfad
-- selbst unterliegt keiner RLS-Pruefung), wuerde ein solcher Datensatz beim naechsten Retention-Lauf
-- des eigenen Vereins A ein echtes Objekt eines FREMDEN Vereins B unwiderruflich loeschen. Der
-- LIKE-Filter unten stellt sicher, dass nur Pfade zurueckgegeben werden, die tatsaechlich mit dem
-- Praefix des ANGEFRAGTEN Vereins beginnen -- eine untergeschobene Zeile mit einem fremden Pfad
-- faellt dann aus der Auswahl heraus, weil ihr Pfad nicht zu target_organization_id passt.
create or replace function public.select_expired_raw_media(target_organization_id uuid, cutoff timestamptz)
returns table(media_asset_id uuid, bucket_id text, object_path text)
language sql stable set search_path = public, pg_temp as $$
  select asset.id, asset.bucket_id, asset.object_path
  from public.media_assets asset
  where asset.organization_id = target_organization_id
    and asset.created_at < cutoff
    and asset.upload_status <> 'deleted'
    and asset.object_path like ('organizations/' || target_organization_id::text || '/%')
    and not exists (
      select 1 from public.media_derivatives derivative
      where derivative.organization_id = asset.organization_id and derivative.media_asset_id = asset.id
    );
$$;
revoke all on function public.select_expired_raw_media(uuid, timestamptz) from public;
grant execute on function public.select_expired_raw_media(uuid, timestamptz) to service_role;

create or replace function public.select_expired_media_derivatives(target_organization_id uuid, cutoff timestamptz)
returns table(media_derivative_id uuid, bucket_id text, object_path text)
language sql stable set search_path = public, pg_temp as $$
  select derivative.id, derivative.bucket_id, derivative.object_path
  from public.media_derivatives derivative
  where derivative.organization_id = target_organization_id
    and derivative.created_at < cutoff
    and derivative.object_path like ('organizations/' || target_organization_id::text || '/%')
    and not exists (
      select 1 from public.post_media post_media
      where post_media.organization_id = derivative.organization_id and post_media.media_derivative_id = derivative.id
    )
    and not exists (
      select 1 from public.approval_media_snapshots snapshot
      where snapshot.organization_id = derivative.organization_id and snapshot.media_derivative_id = derivative.id
    )
    and not exists (
      select 1 from public.publication_media_grants grant_row
      where grant_row.organization_id = derivative.organization_id and grant_row.media_derivative_id = derivative.id
    );
$$;
revoke all on function public.select_expired_media_derivatives(uuid, timestamptz) from public;
grant execute on function public.select_expired_media_derivatives(uuid, timestamptz) to service_role;

-- 8. create_organization(): Vorbelegungen fuer Aufbewahrung und Verarbeitungsdokumentation --------
-- Ersetzt die Definition aus 2026080502_platform_administration.sql vollstaendig -- derselbe
-- Funktionskoerper mit zwei zusaetzlichen insert-Anweisungen kurz vor dem Ende, kein anderes
-- Verhalten aendert sich. processing_records-Texte sind bewusst Entwuerfe ("bitte durch den Verein
-- bestaetigen"), keine fertigen Rechtsbehauptungen -- reviewed_at bleibt null, bis jemand sie
-- bestaetigt (Plan, Abschnitt "4. Dokumentation der Verarbeitungen").
create or replace function public.create_organization(
  organization_name text,
  first_department_name text,
  organization_timezone text default 'Europe/Berlin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := auth.uid();
  new_organization_id uuid;
  new_department_id uuid;
  base_slug text;
  candidate_slug text;
  department_slug text;
  suffix integer := 0;
  owner_count integer;
  max_organizations_per_owner integer;
begin
  if acting_user is null then
    raise exception 'authentication required';
  end if;
  if char_length(trim(coalesce(organization_name, ''))) = 0 then
    raise exception 'organization name is required';
  end if;
  if char_length(trim(coalesce(first_department_name, ''))) = 0 then
    raise exception 'first department name is required';
  end if;

  select (value::text)::integer into max_organizations_per_owner
  from public.platform_settings where key = 'max_organizations_per_owner';
  if max_organizations_per_owner is null then
    max_organizations_per_owner := 3;
  end if;

  perform pg_advisory_xact_lock(hashtext('create_organization:' || acting_user::text));

  select count(*) into owner_count
  from public.organization_memberships
  where user_id = acting_user
    and role = 'organization_owner'
    and (expires_at is null or expires_at > now());
  if owner_count >= max_organizations_per_owner then
    raise exception 'organization limit reached for this account';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(organization_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'verein'; end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.organizations (name, slug, timezone)
      values (trim(organization_name), candidate_slug, organization_timezone)
      returning id into new_organization_id;
      exit;
    exception when unique_violation then
      suffix := suffix + 1;
      candidate_slug := base_slug || '-' || suffix;
    end;
  end loop;

  insert into public.organization_profiles (organization_id) values (new_organization_id);
  insert into public.organization_onboarding (organization_id) values (new_organization_id);
  insert into public.organization_brand_profiles (organization_id) values (new_organization_id);
  insert into public.retention_settings (organization_id, updated_by) values (new_organization_id, acting_user);
  insert into public.processing_records (organization_id, purpose, legal_basis, data_categories, subject_categories, retention_note) values
    (new_organization_id, 'Beitragserstellung und Freigabe', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Beitragstexte', 'Bildmaterial'], array['Mitglieder', 'Verzeichnispersonen'], 'Bis zur Loeschung des Vereinskontos'),
    (new_organization_id, 'Medienverarbeitung (Anonymisierung, Rendering)', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Bildmaterial', 'Videomaterial'], array['Mitglieder', 'Verzeichnispersonen'], 'Gemaess Aufbewahrungsfrist fuer Rohmedien'),
    (new_organization_id, 'Einwilligungsverwaltung', 'Einwilligung -- bitte durch den Verein bestaetigen oder anpassen', array['Einwilligungserklaerungen', 'Kontaktdaten Erziehungsberechtigter'], array['Verzeichnispersonen', 'Erziehungsberechtigte'], 'Gemaess gesetzlicher Aufbewahrungsfrist fuer Nachweise'),
    (new_organization_id, 'Mitgliederverzeichnis', 'Vertragserfuellung / berechtigtes Interesse -- bitte durch den Verein bestaetigen oder anpassen', array['Stammdaten', 'Kontaktdaten'], array['Mitglieder', 'Verzeichnispersonen'], 'Bis zum Austritt bzw. Loeschung des Vereinskontos');

  department_slug := trim(both '-' from regexp_replace(lower(trim(first_department_name)), '[^a-z0-9]+', '-', 'g'));
  if department_slug = '' then department_slug := 'abteilung'; end if;

  insert into public.departments (organization_id, name, slug)
  values (new_organization_id, trim(first_department_name), department_slug)
  returning id into new_department_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, acting_user, 'organization_owner');

  insert into public.department_memberships (organization_id, department_id, user_id, role)
  values (new_organization_id, new_department_id, acting_user, 'department_admin');

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id)
  values (new_organization_id, acting_user, 'organization.created', 'organization', new_organization_id, gen_random_uuid());

  return new_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

commit;
