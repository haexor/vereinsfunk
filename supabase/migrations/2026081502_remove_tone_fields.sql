begin;

-- Betreiberentscheidung 2026-08-15: "Tonalitaet" war doppelt vertreten und in keinem der beiden
-- Faelle mit der Content-Generierung verbunden. organization_brand_profiles.tone (und die
-- Abteilungs-/Mannschafts-Pendants, Plan 013) war reines Branding-Metadatum, nie von etwas
-- ausserhalb der Marken-Seite gelesen. policy_settings.tone (Plan 011) war zwar strukturell als
-- Regelfeld angelegt, aber nie bis in resolveEffectiveConfig() verdrahtet (toRuleOverride() in
-- apps/api/src/routes/shared.ts mappt es nie in ConfigOverride.tone) -- speicherbar, aber
-- wirkungslos. Jeder Beitrag legt seine Tonalitaet tatsaechlich individuell ueber das
-- Stilprofil/die Persona der Textwerkstatt fest (Paket 040, "Charakter-Modell"). Beide Felder
-- werden ersatzlos entfernt.

-- 1. Marken-Tonalitaet ----------------------------------------------------------------------------

-- locked_fields kann noch 'tone' enthalten -- muss vor dem engeren CHECK unten raus, sonst
-- verletzt der neue CHECK Bestandsdaten.
update public.organization_brand_profiles set locked_fields = array_remove(locked_fields, 'tone');
update public.department_brand_profiles set locked_fields = array_remove(locked_fields, 'tone');

-- NOT VALID: only the metadata catalog lock is taken here, not a full-table scan. The next
-- migration validates existing rows under a much weaker lock.
alter table public.organization_brand_profiles drop constraint organization_brand_profiles_locked_fields_check;
alter table public.organization_brand_profiles add constraint organization_brand_profiles_locked_fields_check
  check (locked_fields <@ array['primaryColor','accentColor','logoAssetId','displayFontAssetId','bodyFontAssetId']) not valid;

alter table public.department_brand_profiles drop constraint department_brand_profiles_locked_fields_check;
alter table public.department_brand_profiles add constraint department_brand_profiles_locked_fields_check
  check (locked_fields <@ array['primaryColor','accentColor','logoAssetId','displayFontAssetId','bodyFontAssetId']) not valid;

-- Der tone-CHECK jeder Tabelle referenziert ausschliesslich die tone-Spalte selbst und faellt mit
-- ihr automatisch weg.
alter table public.organization_brand_profiles drop column tone;
alter table public.department_brand_profiles drop column tone;
alter table public.team_brand_profiles drop column tone;

-- 2. Richtlinien-Tonalitaet ------------------------------------------------------------------------

alter table public.policy_settings drop column tone;

-- set_policy_rules() neu, dieselbe Definition wie zuletzt in 2026081311_default_target_platforms,
-- nur ohne den tone-Zweig und ohne 'tone' in allowed_keys.
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
    'forbiddenTopics', 'requiredHashtags', 'consentExpiresOnLeave', 'consentValidityMonths',
    'defaultTargetPlatforms'
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
    consent_expires_on_leave = case when patch ? 'consentExpiresOnLeave' then (patch->>'consentExpiresOnLeave')::boolean else consent_expires_on_leave end,
    consent_validity_months = case when patch ? 'consentValidityMonths' then (patch->>'consentValidityMonths')::integer else consent_validity_months end,
    default_target_platforms = case
      when patch ? 'defaultTargetPlatforms' and jsonb_typeof(patch->'defaultTargetPlatforms') = 'array' then coalesce((select array_agg(value) from jsonb_array_elements_text(patch->'defaultTargetPlatforms') value), '{}'::text[])
      when patch ? 'defaultTargetPlatforms' then null
      else default_target_platforms end,
    updated_by = auth.uid()
  where id = existing_id;

  select * into result from public.policy_settings where id = existing_id;
  return result;
end;
$$;
revoke all on function public.set_policy_rules(uuid, text, uuid, uuid, jsonb) from public;
grant execute on function public.set_policy_rules(uuid, text, uuid, uuid, jsonb) to authenticated;

commit;
