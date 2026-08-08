begin;

-- Paket 015: Einwilligungsverwaltung. Schliesst das bestehende Medien-Gate (evaluateMediaGate,
-- packages/domain) wirklich, indem es endlich einen Schreibpfad fuer consent_records baut, und
-- ergaenzt einen digitalen Einwilligungsprozess ohne Konto. Siehe plans/015-einwilligungsverwaltung.md.

-- 0. Bugfix im Vorbild-Trigger, der fuer den neuen Widerrufs-Trigger nachgebaut wird -------------
-- invalidate_approvals_for_media_change() filtert seit 202608030001 auf
-- "media_derivative_id = new.media_derivative_id", obwohl der Trigger "after update on
-- media_derivatives" feuert -- dort heisst die Primaerschluesselspalte "id", nicht
-- "media_derivative_id" (die Spalte existiert nur auf post_media/approval_media_snapshots, die
-- AUF media_derivatives verweisen). new.media_derivative_id existiert auf dieser Zeile nicht und
-- brich zur Laufzeit ab. Der Trigger ist bislang nie gelaufen (keine Inhalts-Pipeline, die
-- media_derivatives.sha256/.status aendert) und deshalb nie an dieser Stelle gescheitert. Wird hier
-- mitbehoben, weil der neue Widerrufs-Trigger unten dasselbe Muster korrekt nachbilden muss.
create or replace function public.invalidate_approvals_for_media_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.approval_requests set invalidated_at = now()
  where invalidated_at is null and organization_id = new.organization_id and post_version_id in (
    select post_version_id from public.post_media
    where organization_id = new.organization_id and media_derivative_id = new.id
  );
  return new;
end;
$$;

-- 1. consent_records: Umfang strukturieren, Herkunft, Widerruf, Ablösung -------------------------
alter table public.consent_records
  add column scope_structured jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scope_structured) = 'object'),
  add column origin text not null default 'paper'
    check (origin in ('paper', 'digital', 'imported')),
  add column source_id uuid,
  add column signed_at date,
  add column signer_name text,
  add column signer_role text check (signer_role in ('self', 'guardian')),
  add column revoked_by text check (revoked_by in ('self', 'guardian', 'organization')),
  add column revocation_reason text,
  add column superseded_by uuid,
  -- Nicht im Plan-DDL, aber fuer den dauerhaften Widerrufslink aus Abschnitt 3 notwendig ("ein
  -- dauerhafter Widerrufslink, der in jeder E-Mail steht"): dieser Token unterscheidet sich vom
  -- consent_requests.token_hash der ANFRAGE (einmalig, endet bei Beantwortung) -- er bleibt fuer
  -- die gesamte Lebensdauer der entstandenen Einwilligung gueltig. Nur bei origin='digital' gesetzt.
  add column revocation_token_hash text unique;

-- Spaltenliste bei SET NULL ist Pflicht: ohne sie setzt PostgreSQL alle Spalten des
-- Fremdschluessels auf NULL, auch organization_id -- die ist not null.
alter table public.consent_records add constraint consent_records_superseded_fk
  foreign key (organization_id, superseded_by)
  references public.consent_records(organization_id, id) on delete set null (superseded_by);

alter table public.consent_records add constraint consent_records_guardian_check
  check (signer_role is distinct from 'guardian' or guardian_confirmed);

alter table public.consent_records add constraint consent_records_not_self_superseded
  check (superseded_by is null or superseded_by <> id);
create unique index consent_records_superseded_unique
  on public.consent_records (organization_id, superseded_by)
  where superseded_by is not null;

alter table public.consent_records add constraint consent_records_source_fk
  foreign key (organization_id, source_id)
  references public.integration_sources(organization_id, id) on delete set null (source_id);
alter table public.consent_records add constraint consent_records_origin_source_check
  check (source_id is null or origin = 'imported');
alter table public.consent_records add constraint consent_records_revocation_token_digital_check
  check (revocation_token_hash is null or origin = 'digital');

-- directory_person_id existiert bereits seit Paket 014 (2026080703_integration_framework.sql).

-- Der Bucket muss PDFs annehmen, sonst scheitert jeder Papier-Nachweis-Upload genau an dem Punkt,
-- an dem das Paket seinen Nutzen hat (Plan, Abschnitt 2). Additiv statt eines kompletten Ersatzes
-- der Liste, sonst wuerde diese Migration verlieren, was eine spaetere Aenderung des Vorzustands
-- (2026080702_brand_assets_and_fonts.sql) ergaenzt (gefunden im Code-Review).
update storage.buckets
set allowed_mime_types = array(select distinct unnest(allowed_mime_types || array['application/pdf']))
where id = 'raw-media';

-- 2. Digitale Einwilligungsanfragen ---------------------------------------------------------------
create table public.consent_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Denormalisiert aus directory_people.department_id: eine RLS-Policy auf dieser Tabelle darf sich
  -- nicht auf die SELECT-Policy von directory_people verlassen (siehe "RLS-Unterabfrage eigene
  -- Policy", plans/README.md) -- mit einer eigenen Spalte braucht die Policy unten keinen Join.
  department_id uuid not null,
  directory_person_id uuid not null,
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  recipient_role text not null check (recipient_role in ('self', 'guardian')),
  requested_scope jsonb not null check (jsonb_typeof(requested_scope) = 'object'),
  text_version text not null,
  token_hash text not null unique,
  status text not null default 'sent'
    check (status in ('sent', 'granted', 'declined', 'expired', 'revoked_link')),
  expires_at timestamptz not null,
  responded_at timestamptz,
  consent_record_id uuid,
  response_ip_hash text,
  response_user_agent_hash text,
  send_count integer not null default 1 check (send_count between 1 and 5),
  last_sent_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((status = 'granted') = (consent_record_id is not null)),
  -- Nur 'granted'/'declined' entstehen durch eine Antwort der empfangenden Person -- 'expired' und
  -- 'revoked_link' sind Systemuebergaenge ohne eigenen Antwortzeitpunkt (gefunden im Code-Review;
  -- die urspruengliche Fassung haette dafuer einen erfundenen responded_at verlangt).
  check ((status in ('granted', 'declined')) = (responded_at is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete cascade,
  -- restrict, nicht set null: eine erteilte Einwilligung ist Nachweis und wird widerrufen, nicht
  -- geloescht -- ein SET NULL wuerde den CHECK oben verletzen und die Loeschung an einer schwer
  -- lesbaren CHECK-Meldung scheitern lassen. restrict sagt das direkt.
  foreign key (organization_id, consent_record_id)
    references public.consent_records(organization_id, id) on delete restrict
);
create unique index consent_requests_open_unique
  on public.consent_requests (organization_id, directory_person_id, recipient_email)
  where status = 'sent';
create index consent_requests_scope_idx on public.consent_requests (organization_id, department_id, status);

-- Einwilligungstext pro Verein editierbar, nicht global (Entscheidung 2026-08-08, siehe
-- plans/015-einwilligungsverwaltung.md "Risiken und offene Entscheidungen"): eine Vorlage wird
-- vom Code bereitgestellt (DEFAULT_CONSENT_TEXT_TEMPLATE, apps/api), ein Verein darf sie durch
-- eine eigene Fassung ersetzen. Nie ein UPDATE -- eine Aenderung legt eine neue Zeile an, die
-- alte bleibt unveraendert bestehen (dasselbe Prinzip wie consent_records/post_versions): der
-- Nachweis einer digitalen Einwilligung ist, WELCHEN Text jemand bestaetigt hat.
create table public.organization_consent_texts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 20000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index organization_consent_texts_scope_idx on public.organization_consent_texts (organization_id, created_at desc);
alter table public.organization_consent_texts enable row level security;
alter table public.organization_consent_texts force row level security;
create policy organization_consent_texts_select on public.organization_consent_texts for select to authenticated
  using (authz.is_any_member_of_organization(organization_id));
grant select on public.organization_consent_texts to authenticated;
grant all privileges on public.organization_consent_texts to service_role;

-- Der Nachweis einer digitalen Einwilligung ist, WELCHEN Text jemand bestaetigt hat -- "nie ein
-- UPDATE" war bislang nur durch den fehlenden Grant fuer authenticated erzwungen, service_role
-- (grant all privileges oben) haette eine bestehende Textversion aendern oder loeschen koennen
-- (gefunden im Code-Review). Gleiches Muster wie media_derivative_immutable: per Trigger statt
-- per Grant, damit auch service_role den Schutz nicht umgehen kann.
create or replace function public.organization_consent_text_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'organization_consent_texts is append-only';
end;
$$;
create trigger organization_consent_texts_immutable
  before update or delete on public.organization_consent_texts
  for each row execute function public.organization_consent_text_immutable();

alter table public.consent_requests enable row level security;
alter table public.consent_requests force row level security;
create policy consent_requests_select on public.consent_requests for select to authenticated
  using (authz.has_department_permission(department_id, 'consent.manage'));
grant select on public.consent_requests to authenticated;
grant all privileges on public.consent_requests to service_role;
create trigger set_consent_requests_updated_at before update on public.consent_requests
  for each row execute function public.set_updated_at();

-- 3. Neue Permission consent.manage --------------------------------------------------------------
-- Nur department_admin (automatisch organization_admin/organization_owner ueber die bestehende
-- has_organization_permission-Fallback-Klausel), nicht team_manager -- analog zu
-- integration.manage/fixture.manage/event.manage: Einwilligungen betreffen Elternkontakt und
-- Rechtsnachweise, dieselbe Sensitivitaet wie der Elternkontakt aus Paket 014.
create or replace function authz.has_department_permission(target_department_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.department_memberships membership
    where membership.department_id = target_department_id
      and membership.user_id = auth.uid()
      and (membership.expires_at is null or membership.expires_at > now())
      and case membership.role
        when 'department_admin' then permission = any(array['department.manage','member.invite','member.remove','team.manage','post.create','post.edit','post.submit','post.approve','post.publish','social_account.manage','brand.manage','analytics.view','directory.read','integration.manage','fixture.manage','event.manage','consent.manage'])
        when 'editor' then permission = any(array['post.create','post.edit','post.submit','analytics.view'])
        when 'approver' then permission = any(array['post.approve','analytics.view'])
        when 'contributor' then permission = any(array['post.create','post.submit'])
        when 'viewer' then permission = 'analytics.view'
      end
  ) or exists (
    select 1 from public.departments department
    where department.id = target_department_id
      and authz.has_organization_permission(department.organization_id, permission)
  );
$$;

-- 4. policy_settings: Einwilligungsrichtlinien ergaenzen -----------------------------------------
alter table public.policy_settings
  add column consent_expires_on_leave boolean,          -- null = erben; OR-Verschaerfung wie media_requires_consent_check
  add column consent_validity_months integer check (consent_validity_months between 1 and 120);

-- Ersetzt den Grant aus 2026080701 vollstaendig (kein "ADD COLUMN TO GRANT" in Postgres).
grant select (
  id, organization_id, scope, department_id, team_id, invite_allowed, posts_visible_org_wide,
  submit_requires_permission, review_required, review_mode, review_stage_label, review_minimum_approvals,
  review_deadline_hours, minor_approval_required, self_approval_allowed, allow_same_reviewer_across_stages,
  allow_review_exemptions, media_requires_consent_check, allowed_presets, allowed_formats, allowed_channel_ids,
  forbidden_topics, required_hashtags, tone, allow_department_owned_channels, require_channel_responsible,
  consent_expires_on_leave, consent_validity_months, created_at, updated_at
) on public.policy_settings to authenticated;

-- set_policy_rules() (2026080606) um die zwei neuen Felder erweitert, gleiches Muster wie die
-- bestehenden heterogen typisierten Felder (patch ? 'key' statt eines fixen Spaltensatzes).
create or replace function public.set_policy_rules(
  target_organization_id uuid, target_scope text, target_department_id uuid, target_team_id uuid, patch jsonb
) returns public.policy_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  authorized boolean;
  existing_id uuid;
  result public.policy_settings;
  allowed_keys text[] := array[
    'submitRequiresPermission', 'reviewRequired', 'reviewMode', 'reviewStageLabel', 'reviewMinimumApprovals',
    'reviewDeadlineHours', 'minorApprovalRequired', 'selfApprovalAllowed', 'allowSameReviewerAcrossStages',
    'allowReviewExemptions', 'mediaRequiresConsentCheck', 'allowedPresets', 'allowedFormats', 'allowedChannelIds',
    'forbiddenTopics', 'requiredHashtags', 'tone', 'consentExpiresOnLeave', 'consentValidityMonths'
  ];
  patch_key text;
begin
  for patch_key in select jsonb_object_keys(patch) loop
    if not (patch_key = any(allowed_keys)) then
      raise exception 'unknown_policy_rule_field: %', patch_key;
    end if;
  end loop;

  if target_scope = 'organization' then
    authorized := authz.has_organization_permission(target_organization_id, 'organization.manage');
  elsif target_scope = 'department' then
    authorized := authz.has_department_permission(target_department_id, 'department.manage');
  elsif target_scope = 'team' then
    authorized := authz.has_team_permission(target_team_id, 'team.manage');
  else
    raise exception 'invalid_scope';
  end if;
  if not authorized then
    raise exception 'insufficient_permission';
  end if;

  select id into existing_id from public.policy_settings
    where organization_id = target_organization_id
      and scope = target_scope::public.policy_scope
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
    for update;

  if existing_id is null then
    insert into public.policy_settings (organization_id, scope, department_id, team_id, updated_by)
      values (target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id, auth.uid())
      returning id into existing_id;
  end if;

  update public.policy_settings set
    submit_requires_permission = case when patch ? 'submitRequiresPermission' then (patch->>'submitRequiresPermission')::boolean else submit_requires_permission end,
    review_required = case when patch ? 'reviewRequired' then (patch->>'reviewRequired')::boolean else review_required end,
    review_mode = case when patch ? 'reviewMode' then (patch->>'reviewMode')::public.review_mode else review_mode end,
    review_stage_label = case when patch ? 'reviewStageLabel' then patch->>'reviewStageLabel' else review_stage_label end,
    review_minimum_approvals = case when patch ? 'reviewMinimumApprovals' then (patch->>'reviewMinimumApprovals')::integer else review_minimum_approvals end,
    review_deadline_hours = case when patch ? 'reviewDeadlineHours' then (patch->>'reviewDeadlineHours')::integer else review_deadline_hours end,
    minor_approval_required = case when patch ? 'minorApprovalRequired' then (patch->>'minorApprovalRequired')::boolean else minor_approval_required end,
    self_approval_allowed = case when patch ? 'selfApprovalAllowed' then (patch->>'selfApprovalAllowed')::boolean else self_approval_allowed end,
    allow_same_reviewer_across_stages = case when patch ? 'allowSameReviewerAcrossStages' then (patch->>'allowSameReviewerAcrossStages')::boolean else allow_same_reviewer_across_stages end,
    allow_review_exemptions = case when patch ? 'allowReviewExemptions' then (patch->>'allowReviewExemptions')::boolean else allow_review_exemptions end,
    media_requires_consent_check = case when patch ? 'mediaRequiresConsentCheck' then (patch->>'mediaRequiresConsentCheck')::boolean else media_requires_consent_check end,
    allowed_presets = case
      when patch ? 'allowedPresets' and jsonb_typeof(patch->'allowedPresets') = 'array' then (select array_agg(value) from jsonb_array_elements_text(patch->'allowedPresets') value)
      when patch ? 'allowedPresets' then null
      else allowed_presets end,
    allowed_formats = case
      when patch ? 'allowedFormats' and jsonb_typeof(patch->'allowedFormats') = 'array' then (select array_agg(value) from jsonb_array_elements_text(patch->'allowedFormats') value)
      when patch ? 'allowedFormats' then null
      else allowed_formats end,
    allowed_channel_ids = case
      when patch ? 'allowedChannelIds' and jsonb_typeof(patch->'allowedChannelIds') = 'array' then (select array_agg(value::uuid) from jsonb_array_elements_text(patch->'allowedChannelIds') value)
      when patch ? 'allowedChannelIds' then null
      else allowed_channel_ids end,
    forbidden_topics = case
      when patch ? 'forbiddenTopics' and jsonb_typeof(patch->'forbiddenTopics') = 'array' then coalesce((select array_agg(value) from jsonb_array_elements_text(patch->'forbiddenTopics') value), '{}'::text[])
      when patch ? 'forbiddenTopics' then '{}'::text[]
      else forbidden_topics end,
    required_hashtags = case
      when patch ? 'requiredHashtags' and jsonb_typeof(patch->'requiredHashtags') = 'array' then coalesce((select array_agg(value) from jsonb_array_elements_text(patch->'requiredHashtags') value), '{}'::text[])
      when patch ? 'requiredHashtags' then '{}'::text[]
      else required_hashtags end,
    tone = case when patch ? 'tone' then patch->>'tone' else tone end,
    consent_expires_on_leave = case when patch ? 'consentExpiresOnLeave' then (patch->>'consentExpiresOnLeave')::boolean else consent_expires_on_leave end,
    consent_validity_months = case when patch ? 'consentValidityMonths' then (patch->>'consentValidityMonths')::integer else consent_validity_months end,
    updated_by = auth.uid()
  where id = existing_id;

  select * into result from public.policy_settings where id = existing_id;
  return result;
end;
$$;
revoke all on function public.set_policy_rules(uuid, text, uuid, uuid, jsonb) from public;
grant execute on function public.set_policy_rules(uuid, text, uuid, uuid, jsonb) to authenticated;

-- 5. Widerrufsfolgen: ein Widerruf invalidiert offene Freigaben und stoppt geplante Publikationen -
-- Spiegelt invalidate_approvals_for_media_change und invalidate_approvals_for_fixture_change
-- (2026080704): dieselbe Kette post_media -> post_versions -> posts/approval_requests/publications,
-- hier ueber face_regions.consent_record_id -> media_assets -> media_derivatives -> post_media.
create or replace function public.invalidate_approvals_for_consent_revocation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  affected_version_ids uuid[];
  affected_post_ids uuid[];
  invalidated_request_ids uuid[];
  changed_post_ids uuid[];
  cancelled_publication_ids uuid[];
  cascade_correlation_id uuid := gen_random_uuid();
  affected_id uuid;
begin
  select array_agg(distinct post_media.post_version_id), array_agg(distinct post_version.post_id)
  into affected_version_ids, affected_post_ids
  from public.face_regions face
  join public.media_derivatives derivative
    on derivative.organization_id = face.organization_id and derivative.media_asset_id = face.media_asset_id
  join public.post_media post_media
    on post_media.organization_id = derivative.organization_id and post_media.media_derivative_id = derivative.id
  join public.post_versions post_version
    on post_version.organization_id = post_media.organization_id and post_version.id = post_media.post_version_id
  where face.organization_id = new.organization_id and face.consent_record_id = new.id;

  if affected_post_ids is null then
    return new;
  end if;

  select array_agg(id) into invalidated_request_ids from public.approval_requests
  where invalidated_at is null and organization_id = new.organization_id and post_id = any(affected_post_ids);
  update public.approval_requests set invalidated_at = now()
  where id = any(invalidated_request_ids);

  select array_agg(id) into changed_post_ids from public.posts
  where organization_id = new.organization_id and status = 'awaiting_approval' and id = any(affected_post_ids);
  update public.posts set status = 'changes_requested'
  where id = any(changed_post_ids);

  select array_agg(id) into cancelled_publication_ids from public.publications
  where organization_id = new.organization_id and status = 'queued' and post_version_id = any(affected_version_ids);
  update public.publications set status = 'cancelled'
  where id = any(cancelled_publication_ids);

  -- Jeder tatsaechlich ausgefuehrte Kaskadenschritt bekommt einen audit_events-Eintrag mit
  -- gemeinsamer correlation_id und new.id als Ausloeserbezug (Plan 015, Abschnitt 5, Punkt 5) --
  -- sonst sieht ein Verein spaeter zwar, dass eine Freigabe invalidiert oder eine Publikation
  -- storniert wurde, aber nicht, dass ein Widerruf die Ursache war (gefunden im Code-Review). Der
  -- Trigger deckt damit auch Widerrufe ab, die nicht ueber POST /v1/consents/:id/revoke laufen.
  if invalidated_request_ids is not null then
    foreach affected_id in array invalidated_request_ids loop
      insert into public.audit_events (organization_id, action, entity_type, entity_id, correlation_id, metadata)
      values (new.organization_id, 'approval_request.invalidated', 'approval_requests', affected_id, cascade_correlation_id, jsonb_build_object('reason', 'consent_revoked', 'consentRecordId', new.id));
    end loop;
  end if;

  if changed_post_ids is not null then
    foreach affected_id in array changed_post_ids loop
      insert into public.audit_events (organization_id, action, entity_type, entity_id, correlation_id, metadata)
      values (new.organization_id, 'post.changes_requested', 'posts', affected_id, cascade_correlation_id, jsonb_build_object('reason', 'consent_revoked', 'consentRecordId', new.id));
    end loop;
  end if;

  if cancelled_publication_ids is not null then
    foreach affected_id in array cancelled_publication_ids loop
      insert into public.audit_events (organization_id, action, entity_type, entity_id, correlation_id, metadata)
      values (new.organization_id, 'publication.cancelled', 'publications', affected_id, cascade_correlation_id, jsonb_build_object('reason', 'consent_revoked', 'consentRecordId', new.id));
    end loop;
  end if;

  return new;
end;
$$;
create trigger invalidate_approval_after_consent_revocation after update on public.consent_records
  for each row when (old.revoked_at is distinct from new.revoked_at and new.revoked_at is not null)
  execute function public.invalidate_approvals_for_consent_revocation();

commit;
