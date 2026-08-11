begin;

-- Plan 032 / former Plan 031: only custom profiles are persisted. The five system
-- modes remain reviewed application registry data and cannot be shadowed by a tenant row.
create type public.content_style_profile_kind as enum ('system', 'custom');
create type public.composition_session_status as enum (
  'draft', 'queued', 'generating', 'candidate_ready', 'failed', 'accepted', 'abandoned', 'expired'
);
create type public.generation_candidate_status as enum (
  'pending', 'generating', 'ready', 'failed', 'accepted', 'abandoned', 'expired'
);

-- Used by content_style_profiles.avoid_rules below to mirror avoidRules' per-element
-- z.string().max(160) bound: a plain CHECK expression cannot contain a subquery, so the
-- per-element length scan lives in this small immutable helper instead.
create or replace function public.text_array_elements_within_length(value text[], max_length integer)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(max(char_length(element)), 0) <= max_length from unnest(value) as element;
$$;

create table public.content_style_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid,
  team_id uuid,
  slug text not null check (slug ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$' and char_length(slug) <= 64),
  name text not null check (char_length(name) between 1 and 80),
  kind public.content_style_profile_kind not null default 'custom' check (kind = 'custom'),
  description text not null check (char_length(description) between 1 and 500),
  style_rules jsonb not null check (jsonb_typeof(style_rules) = 'object'),
  avoid_rules text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade,
  check (team_id is null or department_id is not null),
  check (cardinality(avoid_rules) <= 30 and public.text_array_elements_within_length(avoid_rules, 160)),
  -- The five curated system slugs stay reviewed application registry data (see comment
  -- above); without this check the Zod-only reservation in CreateCustomStyleProfileRequestSchema
  -- would be the sole guard, and any writer that bypasses it could shadow a system profile.
  check (slug not in ('klar_erklaerend', 'warm_gemeinschaftlich', 'lebendig_sportlich', 'leicht_humorvoll', 'feierlich_wertschaetzend'))
);
create unique index content_style_profiles_organization_slug_unique
  on public.content_style_profiles (organization_id, slug) where department_id is null;
create unique index content_style_profiles_department_slug_unique
  on public.content_style_profiles (organization_id, department_id, slug) where department_id is not null and team_id is null;
create unique index content_style_profiles_team_slug_unique
  on public.content_style_profiles (organization_id, team_id, slug) where team_id is not null;

-- Used by composition_sessions' requested_formats check below. A plain CHECK expression cannot
-- contain a subquery, so the count(distinct ...) comparison needed to reject duplicate array
-- elements lives in this small immutable helper instead.
create or replace function public.jsonb_text_array_is_distinct(value jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select count(*) = count(distinct element) from jsonb_array_elements_text(value) as element;
$$;

create table public.composition_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null,
  team_id uuid,
  post_id uuid,
  preset_slug text not null check (preset_slug ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$' and char_length(preset_slug) <= 64),
  communication_goal text not null check (communication_goal in (
    'inform', 'inspire', 'thank', 'invite', 'recruit', 'educate', 'strengthen_community'
  )),
  requested_formats jsonb not null check (
    jsonb_typeof(requested_formats) = 'array'
    and jsonb_array_length(requested_formats) between 1 and 3
    and requested_formats <@ '["text_post", "photo_post", "video_post"]'::jsonb
    -- Mirrors CreateCompositionSessionSchema's superRefine: a user-uploaded video is never
    -- misrepresented as an AI-generated Reel, so video_post cannot share a session with
    -- another presentation type, and requestedFormats must not contain duplicates.
    and not (requested_formats @> '["video_post"]'::jsonb and jsonb_array_length(requested_formats) > 1)
    and public.jsonb_text_array_is_distinct(requested_formats)
  ),
  -- Mirrors submissions_material_check (202608030001_content_media_workflows_publishing.sql):
  -- the same SourceMaterialSchema shape requires all four keys, not just object-typed.
  source_material jsonb not null check (
    jsonb_typeof(source_material) = 'object'
    and source_material ?& array['facts', 'observations', 'quotes', 'doNotMention']
  ),
  style_profile_id uuid,
  style_profile_snapshot jsonb not null check (jsonb_typeof(style_profile_snapshot) = 'object'),
  source_revision integer not null check (source_revision > 0),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  status public.composition_session_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id),
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id),
  foreign key (organization_id, post_id)
    references public.posts(organization_id, id) on delete set null,
  foreign key (organization_id, style_profile_id)
    references public.content_style_profiles(organization_id, id) on delete set null
);

create table public.composition_session_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  composition_session_id uuid not null,
  media_asset_id uuid not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (composition_session_id, position),
  unique (composition_session_id, media_asset_id),
  foreign key (organization_id, composition_session_id)
    references public.composition_sessions(organization_id, id) on delete cascade,
  foreign key (organization_id, media_asset_id)
    references public.media_assets(organization_id, id) on delete restrict
);
-- Support composition_session_media's on delete restrict FK to media_assets: without this,
-- deleting/updating a media_assets row forces a sequential scan to check for references.
create index composition_session_media_media_asset_idx on public.composition_session_media(organization_id, media_asset_id);

create table public.generation_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  composition_session_id uuid not null,
  base_post_version_id uuid,
  generation_intent text not null check (generation_intent in ('initial', 'revise')),
  revision_instruction text check (revision_instruction is null or char_length(revision_instruction) between 1 and 500),
  status public.generation_candidate_status not null default 'pending',
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  generated_content jsonb check (generated_content is null or jsonb_typeof(generated_content) = 'object'),
  quality_flags text[] not null default '{}',
  failure_code text,
  expires_at timestamptz,
  accepted_post_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (composition_session_id, input_hash),
  foreign key (organization_id, composition_session_id)
    references public.composition_sessions(organization_id, id) on delete cascade,
  foreign key (organization_id, base_post_version_id)
    references public.post_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, accepted_post_version_id)
    references public.post_versions(organization_id, id) on delete restrict,
  check ((generation_intent = 'initial' and revision_instruction is null) or (generation_intent = 'revise' and revision_instruction is not null))
);

-- This contains only reviewed reproducibility metadata, never a raw provider prompt,
-- media bytes or provider credential. It becomes immutable with the accepted version.
create table public.post_generation_provenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  post_version_id uuid not null,
  composition_session_id uuid,
  generation_candidate_id uuid,
  style_profile_snapshot jsonb not null check (jsonb_typeof(style_profile_snapshot) = 'object'),
  prompt_template_version text not null check (char_length(prompt_template_version) between 1 and 120),
  provider_model_id text not null check (char_length(provider_model_id) between 1 and 200),
  -- ADR-010: "Provider-Modell und -Konfigurations-ID" are both required for reproducibility.
  provider_configuration_id uuid not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, post_version_id),
  foreign key (organization_id, post_version_id)
    references public.post_versions(organization_id, id) on delete cascade,
  foreign key (organization_id, composition_session_id)
    references public.composition_sessions(organization_id, id) on delete set null,
  foreign key (organization_id, generation_candidate_id)
    references public.generation_candidates(organization_id, id) on delete set null,
  foreign key (provider_configuration_id)
    references public.llm_provider_configurations(id) on delete restrict
);

-- Plain inline CHECK: this whole file runs in one begin;/commit; transaction (line 1/end), so a
-- separate ADD CONSTRAINT ... NOT VALID + VALIDATE CONSTRAINT split buys nothing here -- the
-- ACCESS EXCLUSIVE lock taken by ADD COLUMN is held for the rest of the transaction regardless,
-- through the VALIDATE CONSTRAINT scan. That split only avoids a locked full-table scan when
-- VALIDATE CONSTRAINT runs in a later, separate transaction.
alter table public.media_assets add column compression_provenance jsonb
  check (compression_provenance is null or jsonb_typeof(compression_provenance) = 'object');
alter table public.media_derivatives add column compression_provenance jsonb
  check (compression_provenance is null or jsonb_typeof(compression_provenance) = 'object');

alter table public.content_style_profiles enable row level security;
alter table public.content_style_profiles force row level security;
alter table public.composition_sessions enable row level security;
alter table public.composition_sessions force row level security;
alter table public.composition_session_media enable row level security;
alter table public.composition_session_media force row level security;
alter table public.generation_candidates enable row level security;
alter table public.generation_candidates force row level security;
alter table public.post_generation_provenance enable row level security;
alter table public.post_generation_provenance force row level security;

-- Read visibility follows plain scope membership, like posts/post_versions
-- (2026080603_post_visibility.sql), not the post.create permission that gates who may write a
-- profile: a team/department viewer can see their scope's style profile even though only a
-- team_manager/contributor/editor may create or use one to compose a post. is_any_member_of_organization
-- (not is_organization_member) covers the common case of a member with only a department/team role.
create policy content_style_profiles_select on public.content_style_profiles for select to authenticated using (
  (team_id is not null and authz.has_team_membership(team_id))
  or (team_id is null and department_id is not null and authz.is_department_member(department_id))
  or (department_id is null and authz.is_any_member_of_organization(organization_id))
);
-- Same team_id branch as posts/submissions/post_versions (2026080603_post_visibility.sql):
-- a team_manager with only a team_memberships row (no department_memberships row) must still
-- see and edit their own team's sessions/candidates/provenance.
create policy composition_sessions_select on public.composition_sessions for select to authenticated using (
  created_by = auth.uid()
  or authz.has_department_permission(department_id, 'post.edit')
  or (team_id is not null and authz.has_team_permission(team_id, 'post.edit'))
);
create policy composition_session_media_select on public.composition_session_media for select to authenticated using (
  exists (select 1 from public.composition_sessions session where session.id = composition_session_id and session.organization_id = composition_session_media.organization_id and (
    session.created_by = auth.uid()
    or authz.has_department_permission(session.department_id, 'post.edit')
    or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
  ))
);
create policy generation_candidates_select on public.generation_candidates for select to authenticated using (
  exists (select 1 from public.composition_sessions session where session.id = composition_session_id and session.organization_id = generation_candidates.organization_id and (
    session.created_by = auth.uid()
    or authz.has_department_permission(session.department_id, 'post.edit')
    or (session.team_id is not null and authz.has_team_permission(session.team_id, 'post.edit'))
  ))
);
create policy post_generation_provenance_select on public.post_generation_provenance for select to authenticated using (
  exists (
    select 1 from public.post_versions version
    join public.posts post on post.id = version.post_id and post.organization_id = version.organization_id
    where version.id = post_generation_provenance.post_version_id
      and version.organization_id = post_generation_provenance.organization_id
      and (
        -- Mirrors post_versions_select's third branch (2026080603_post_visibility.sql): once a
        -- post is published/scheduled it is readable org-wide, so its provenance record must not
        -- be more restrictive than the post/version it belongs to.
        (post.status in ('published', 'scheduled') and authz.is_any_member_of_organization(post.organization_id))
        or authz.is_department_member(post.department_id)
        or (post.team_id is not null and authz.has_team_membership(post.team_id))
      )
  )
);

grant select on public.content_style_profiles, public.composition_sessions, public.composition_session_media, public.generation_candidates, public.post_generation_provenance to authenticated;
grant all privileges on public.content_style_profiles, public.composition_sessions, public.composition_session_media, public.generation_candidates, public.post_generation_provenance to service_role;

create trigger set_content_style_profiles_updated_at before update on public.content_style_profiles for each row execute function public.set_updated_at();
create trigger set_composition_sessions_updated_at before update on public.composition_sessions for each row execute function public.set_updated_at();
create trigger set_generation_candidates_updated_at before update on public.generation_candidates for each row execute function public.set_updated_at();

create or replace function public.enforce_immutable_post_generation_provenance()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'post generation provenance is immutable';
end;
$$;
create trigger post_generation_provenance_immutable before update or delete on public.post_generation_provenance
  for each row execute function public.enforce_immutable_post_generation_provenance();

create index composition_sessions_scope_idx on public.composition_sessions(organization_id, department_id, created_at desc);
create index generation_candidates_session_idx on public.generation_candidates(organization_id, composition_session_id, created_at desc);
-- Support generation_candidates' on delete restrict FKs to post_versions: without these,
-- deleting/updating a post_versions row forces a sequential scan to check for references.
create index generation_candidates_base_post_version_idx on public.generation_candidates(base_post_version_id) where base_post_version_id is not null;
create index generation_candidates_accepted_post_version_idx on public.generation_candidates(accepted_post_version_id) where accepted_post_version_id is not null;

commit;
