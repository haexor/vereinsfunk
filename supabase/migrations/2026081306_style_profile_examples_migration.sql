begin;

-- Personas/Stilprofil-Editor (worktree-personas-editor-tabs-und-mehrfachbeispiele): replaces the
-- single exampleInput/exampleOutput pair in style_rules with an examples[] array, and
-- StyleProfileRulesSchema stays .strict(). Unlike 2026081304 (where no real profile/persona
-- existed yet), rows created since Plan 040 shipped may already carry the old
-- {exampleInput, exampleOutput} shape -- those would fail Zod parsing (unrecognized_keys) the next
-- time they're read back, breaking the style-profile listing/generation routes entirely. Convert
-- in place instead of resetting so the existing example survives as the new array's one entry.
update public.content_style_profiles
set style_rules = (style_rules - 'exampleInput' - 'exampleOutput') || jsonb_build_object(
  'examples',
  case
    when coalesce(style_rules->>'exampleInput', '') <> '' or coalesce(style_rules->>'exampleOutput', '') <> ''
      then jsonb_build_array(jsonb_build_object(
        'input', coalesce(style_rules->>'exampleInput', ''),
        'output', coalesce(style_rules->>'exampleOutput', '')
      ))
    else '[]'::jsonb
  end
)
where style_rules ? 'exampleInput' or style_rules ? 'exampleOutput';

update public.platform_style_personas
set style_rules = (style_rules - 'exampleInput' - 'exampleOutput') || jsonb_build_object(
  'examples',
  case
    when coalesce(style_rules->>'exampleInput', '') <> '' or coalesce(style_rules->>'exampleOutput', '') <> ''
      then jsonb_build_array(jsonb_build_object(
        'input', coalesce(style_rules->>'exampleInput', ''),
        'output', coalesce(style_rules->>'exampleOutput', '')
      ))
    else '[]'::jsonb
  end
)
where style_rules ? 'exampleInput' or style_rules ? 'exampleOutput';

commit;
