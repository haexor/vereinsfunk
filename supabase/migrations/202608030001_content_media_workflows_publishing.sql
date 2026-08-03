begin;

-- Flexible content: stored values are data, not an enum that must change for every new preset.
alter table public.submissions add column preset_slug text;
alter table public.submissions add column communication_goal text;
alter table public.submissions add column requested_formats jsonb;
alter table public.submissions add column source_material jsonb;
update public.submissions set preset_slug = content_type, communication_goal = 'inform', requested_formats = '["feed_image"]'::jsonb,
  source_material = jsonb_build_object('facts', facts, 'observations', '[]'::jsonb, 'quotes', '[]'::jsonb, 'doNotMention', '[]'::jsonb)
where preset_slug is null;
alter table public.submissions alter column preset_slug set not null;
alter table public.submissions alter column communication_goal set not null;
alter table public.submissions alter column requested_formats set not null;
alter table public.submissions alter column source_material set not null;
alter table public.submissions drop constraint if exists submissions_content_type_check;
alter table public.submissions add constraint submissions_preset_slug_check check (preset_slug ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$');
alter table public.submissions add constraint submissions_goal_check check (communication_goal in ('inform','inspire','thank','invite','recruit','educate','strengthen_community'));
alter table public.submissions add constraint submissions_formats_check check (jsonb_typeof(requested_formats) = 'array' and jsonb_array_length(requested_formats) between 1 and 4);
alter table public.submissions add constraint submissions_material_check check (jsonb_typeof(source_material) = 'object' and source_material ?& array['facts','observations','quotes','doNotMention']);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, department_id uuid not null, submission_id uuid,
  bucket_id text not null check (bucket_id in ('raw-media','rendered-media')), object_path text not null,
  mime_type text not null, byte_size bigint not null check (byte_size > 0), sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  width integer check (width > 0), height integer check (height > 0), duration_ms integer check (duration_ms > 0),
  upload_status text not null default 'initiated' check (upload_status in ('initiated','uploaded','normalizing','ready','quarantined','failed','deleted')),
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','failed')), contains_minors boolean not null default false,
  exif_stripped_at timestamptz, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (bucket_id,object_path),
  foreign key (organization_id,department_id) references public.departments(organization_id,id),
  foreign key (organization_id,submission_id) references public.submissions(organization_id,id)
);
create table public.consent_records (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, pseudonymous_subject_ref text not null check (char_length(pseudonymous_subject_ref) between 8 and 160),
  scope text not null check (char_length(scope) <= 500), guardian_confirmed boolean not null default false, valid_from timestamptz not null default now(), valid_until timestamptz,
  revoked_at timestamptz, evidence_bucket text not null default 'raw-media', evidence_path text not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), check (valid_until is null or valid_until > valid_from)
);
create table public.face_regions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, media_asset_id uuid not null, x numeric(6,5) not null check (x >= 0 and x <= 1), y numeric(6,5) not null check (y >= 0 and y <= 1), width numeric(6,5) not null check (width > 0 and width <= 1), height numeric(6,5) not null check (height > 0 and height <= 1),
  source text not null check (source in ('automatic','manual')), confidence numeric(5,4) check (confidence >= 0 and confidence <= 1), subject_kind text not null check (subject_kind in ('adult','minor','unknown')),
  decision text not null default 'pending' check (decision in ('pending','consented','obscure','exclude')), consent_record_id uuid, obscuring_style text check (obscuring_style in ('club_mascot','sports_ball','emoji','confetti_badge','brand_shape','scribble','pixelate','solid_blur')),
  revision integer not null default 1 check (revision > 0), created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), foreign key (organization_id,media_asset_id) references public.media_assets(organization_id,id) on delete cascade,
  foreign key (organization_id,consent_record_id) references public.consent_records(organization_id,id), check (x + width <= 1 and y + height <= 1),
  check ((decision = 'consented' and consent_record_id is not null) or (decision <> 'consented' and consent_record_id is null)),
  check ((decision = 'obscure' and obscuring_style is not null) or (decision <> 'obscure' and obscuring_style is null))
);
create table public.media_derivatives (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, media_asset_id uuid not null, platform_variant_id uuid,
  recipe jsonb not null check (jsonb_typeof(recipe) = 'object'), recipe_version text not null, bucket_id text not null default 'rendered-media' check (bucket_id = 'rendered-media'), object_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'), mime_type text not null, byte_size bigint not null check (byte_size > 0), width integer check (width > 0), height integer check (height > 0), status text not null default 'processing' check (status in ('processing','ready','failed','invalidated')),
  created_at timestamptz not null default now(), ready_at timestamptz, unique (organization_id,id), unique (bucket_id,object_path),
  foreign key (organization_id,media_asset_id) references public.media_assets(organization_id,id) on delete restrict
);
create table public.post_variants (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, post_version_id uuid not null, platform text not null check (platform in ('instagram','facebook')),
  format text not null check (format in ('feed_image','carousel','story','reel')), schema_version text not null, prompt_version text not null,
  variant jsonb not null check (jsonb_typeof(variant) = 'object'), created_at timestamptz not null default now(),
  unique (organization_id,id), unique (post_version_id,platform,format), foreign key (organization_id,post_version_id) references public.post_versions(organization_id,id) on delete cascade
);
alter table public.media_derivatives add constraint media_derivatives_variant_fk foreign key (organization_id,platform_variant_id) references public.post_variants(organization_id,id) on delete restrict;
create table public.post_media (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, post_version_id uuid not null, media_derivative_id uuid not null,
  position integer not null check (position >= 0), role text not null check (role in ('primary','slide','background')), alt_text text not null default '', created_at timestamptz not null default now(),
  unique (organization_id,id), unique (post_version_id,position), foreign key (organization_id,post_version_id) references public.post_versions(organization_id,id) on delete cascade,
  foreign key (organization_id,media_derivative_id) references public.media_derivatives(organization_id,id) on delete restrict
);
create table public.approval_media_snapshots (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, approval_request_id uuid not null, media_derivative_id uuid not null, position integer not null check (position >= 0), sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
  unique (approval_request_id,position), foreign key (organization_id,approval_request_id) references public.approval_requests(organization_id,id) on delete cascade,
  foreign key (organization_id,media_derivative_id) references public.media_derivatives(organization_id,id) on delete restrict
);

create table public.workflow_outbox (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, department_id uuid not null, workflow_name text not null,
  entity_id uuid not null, source_revision integer not null check (source_revision > 0), purpose text not null, correlation_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), status text not null default 'pending' check (status in ('pending','dispatched','failed','cancelled')), dispatched_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,workflow_name,entity_id,source_revision,purpose), foreign key (organization_id,department_id) references public.departments(organization_id,id)
);
create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, department_id uuid not null, workflow_name text not null, entity_id uuid not null, source_revision integer not null check (source_revision > 0),
  hatchet_run_id text, technical_status text not null default 'queued' check (technical_status in ('queued','running','succeeded','failed','cancelled','action_required')), attempt integer not null default 0 check (attempt >= 0), error_class text, correlation_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,workflow_name,entity_id,source_revision), unique (hatchet_run_id), foreign key (organization_id,department_id) references public.departments(organization_id,id)
);

create table public.social_connections (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, platform text not null check (platform in ('instagram','facebook')), external_account_id text not null, display_name text not null,
  scopes text[] not null default '{}', token_ciphertext bytea not null, token_key_version text not null, token_expires_at timestamptz, status text not null default 'active' check (status in ('active','action_required','disconnected')), last_verified_at timestamptz, metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,platform,external_account_id)
);
create table public.publications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, post_version_id uuid not null, social_connection_id uuid not null, platform text not null check (platform in ('instagram','facebook')),
  schedule_revision integer not null default 1 check (schedule_revision > 0), scheduled_for timestamptz, status text not null default 'queued' check (status in ('queued','uploading','processing','published','failed','unknown','action_required','cancelled')),
  provider_publication_id text, idempotency_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,platform,post_version_id,social_connection_id), unique (organization_id,idempotency_key),
  foreign key (organization_id,post_version_id) references public.post_versions(organization_id,id), foreign key (organization_id,social_connection_id) references public.social_connections(organization_id,id)
);
create table public.publication_attempts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, publication_id uuid not null, attempt_number integer not null check (attempt_number > 0), status text not null, provider_container_id text, error_class text, response_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(response_summary) = 'object'), created_at timestamptz not null default now(),
  unique (publication_id,attempt_number), foreign key (organization_id,publication_id) references public.publications(organization_id,id) on delete cascade
);
create table public.publication_media_grants (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, media_derivative_id uuid not null, publication_id uuid not null, token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz, accessed_at timestamptz, created_at timestamptz not null default now(),
  foreign key (organization_id,media_derivative_id) references public.media_derivatives(organization_id,id), foreign key (organization_id,publication_id) references public.publications(organization_id,id)
);

create or replace function public.enforce_immutable_derivative() returns trigger language plpgsql set search_path = public,pg_temp as $$ begin if old.status = 'ready' then raise exception 'ready media derivatives are immutable'; end if; return new; end; $$;
create trigger media_derivative_immutable before update on public.media_derivatives for each row execute function public.enforce_immutable_derivative();
create or replace function public.invalidate_approvals_for_media_change() returns trigger language plpgsql set search_path = public,pg_temp as $$ begin update public.approval_requests set invalidated_at = now() where organization_id = new.organization_id and post_version_id in (select post_version_id from public.post_media where organization_id = new.organization_id and media_derivative_id = new.media_derivative_id); return new; end; $$;
create trigger invalidate_approval_after_derivative_update after update on public.media_derivatives for each row when (old.sha256 is distinct from new.sha256 or old.status is distinct from new.status) execute function public.invalidate_approvals_for_media_change();

do $$ declare table_name text; begin foreach table_name in array array['media_assets','consent_records','face_regions','media_derivatives','post_variants','post_media','approval_media_snapshots','workflow_outbox','workflow_runs','social_connections','publications','publication_attempts','publication_media_grants'] loop execute format('alter table public.%I enable row level security',table_name); execute format('alter table public.%I force row level security',table_name); end loop; end $$;
create policy media_assets_select on public.media_assets for select to authenticated using (authz.is_department_member(department_id));
create policy media_assets_insert on public.media_assets for insert to authenticated with check (created_by = auth.uid() and authz.has_department_permission(department_id,'post.create'));
create policy media_assets_update on public.media_assets for update to authenticated using (authz.has_department_permission(department_id,'post.edit')) with check (authz.has_department_permission(department_id,'post.edit'));
create policy consent_records_select on public.consent_records for select to authenticated using (authz.is_organization_member(organization_id));
create policy face_regions_select on public.face_regions for select to authenticated using (exists(select 1 from public.media_assets asset where asset.id=media_asset_id and asset.organization_id=face_regions.organization_id and authz.is_department_member(asset.department_id)));
create policy face_regions_write on public.face_regions for all to authenticated using (exists(select 1 from public.media_assets asset where asset.id=media_asset_id and asset.organization_id=face_regions.organization_id and authz.has_department_permission(asset.department_id,'post.edit'))) with check (exists(select 1 from public.media_assets asset where asset.id=media_asset_id and asset.organization_id=face_regions.organization_id and authz.has_department_permission(asset.department_id,'post.edit')));
create policy derivatives_select on public.media_derivatives for select to authenticated using (authz.is_organization_member(organization_id));
create policy variants_select on public.post_variants for select to authenticated using (authz.is_organization_member(organization_id));
create policy post_media_select on public.post_media for select to authenticated using (authz.is_organization_member(organization_id));
create policy snapshots_select on public.approval_media_snapshots for select to authenticated using (authz.is_organization_member(organization_id));
create policy workflow_runs_select on public.workflow_runs for select to authenticated using (authz.is_organization_member(organization_id));
create policy connections_select on public.social_connections for select to authenticated using (authz.is_organization_member(organization_id));
create policy publications_select on public.publications for select to authenticated using (authz.is_organization_member(organization_id));
create policy publication_attempts_select on public.publication_attempts for select to authenticated using (authz.is_organization_member(organization_id));
create policy publication_grants_select on public.publication_media_grants for select to authenticated using (false);

grant select,insert,update on public.media_assets,public.face_regions to authenticated;
grant select on public.consent_records,public.media_derivatives,public.post_variants,public.post_media,public.approval_media_snapshots,public.workflow_runs,public.social_connections,public.publications,public.publication_attempts to authenticated;
grant all privileges on public.media_assets,public.consent_records,public.face_regions,public.media_derivatives,public.post_variants,public.post_media,public.approval_media_snapshots,public.workflow_outbox,public.workflow_runs,public.social_connections,public.publications,public.publication_attempts,public.publication_media_grants to service_role;
do $$ declare table_name text; begin foreach table_name in array array['media_assets','consent_records','face_regions','workflow_outbox','workflow_runs','social_connections','publications'] loop execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',table_name,table_name); end loop; end $$;
create index media_assets_scope_idx on public.media_assets(organization_id,department_id,created_at desc);
create index face_regions_asset_idx on public.face_regions(organization_id,media_asset_id);
create index workflow_outbox_pending_idx on public.workflow_outbox(status,created_at) where status='pending';
create index publications_schedule_idx on public.publications(status,scheduled_for);
commit;
