begin;

-- Plan 044, PR 1 Step 2: welche Zielplattformen ein Verein/eine Abteilung standardmaessig anhakt --
-- dieselbe Vererbung wie jede andere Richtlinie (Plan 011), aber mit einer Nuance, die
-- allowed_presets/allowed_formats/allowed_channel_ids nicht brauchen: null und {} sind hier
-- UNTERSCHIEDLICHE Zustaende. null heisst "geerbt" -- die Abteilung uebernimmt, was der Verein
-- gesetzt hat. {} (leeres Array) heisst "ausdruecklich keine Vorauswahl" -- eine Abteilung kann
-- damit die Vereinsvorgabe abbestellen, ohne dass eine andere an ihre Stelle tritt. Anders als
-- allowed_presets/allowed_formats/allowed_channel_ids (Schnittmenge ueber Ebenen, kann nur enger
-- werden) ERSETZT ein gesetzter Wert einer tieferen Ebene die Vorgabe der aeusseren komplett -- ein
-- Verein mit ['instagram'] und eine Abteilung mit ['facebook'] ergibt fuer diese Abteilung
-- ['facebook'], nicht die leere Schnittmenge.
alter table public.policy_settings
  add column default_target_platforms text[]
    check (default_target_platforms <@ array['instagram', 'facebook', 'website']::text[]
      and public.text_array_is_distinct(default_target_platforms));

-- Additiv zu den Grants aus 2026080606/2026080801/2026080701 (Postgres-Spalten-Grants ersetzen sich
-- nicht gegenseitig) -- kein Grant-Ersatz noetig.
grant select (default_target_platforms) on public.policy_settings to authenticated;

-- set_policy_rules() braucht dasselbe coalesce-Muster wie forbidden_topics/required_hashtags
-- (2026080801), nicht das von allowed_presets/allowed_formats/allowed_channel_ids: eine
-- ausdruecklich leere Auswahl (patch.defaultTargetPlatforms = []) darf nicht zu SQL-NULL
-- kollabieren, sonst ginge die "ausdruecklich keine Vorauswahl"-Bedeutung im Schreibpfad verloren.
-- Anders als bei forbidden_topics/required_hashtags bleibt der non-array-Zweig aber null (nicht
-- '{}'), weil default_target_platforms -- anders als die beiden additiven Felder -- tatsaechlich
-- "geerbt" kennt.
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
    'forbiddenTopics', 'requiredHashtags', 'tone', 'consentExpiresOnLeave', 'consentValidityMonths',
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
    tone = case when patch ? 'tone' then patch->>'tone' else tone end,
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
