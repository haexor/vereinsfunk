begin;

-- 2026082602_source_material_forbidden_topics.sql normalizes public.submissions.source_material
-- to the new shape (facts/observations/quotes/forbiddenTopics) *before* dropping the old
-- submissions_material_check constraint, which still requires the old 'doNotMention' key. Any row
-- whose source_material isn't already in the new shape violates that still-active old constraint
-- the moment the UPDATE rewrites it -- crash-looping vereinsfunk-api/-worker in production, since
-- migrations run on every startup and the whole file is one transaction that never commits.
--
-- Fix: drop the constraint first, then normalize, then add+validate the new constraint. Written to
-- converge regardless of whether 2026082602 already succeeded elsewhere (e.g. a fresh local/CI db
-- with no offending rows) -- "drop if exists" plus the same idempotent UPDATE and "add if not
-- exists" make every statement here a no-op on an environment that's already in the target state.
alter table public.submissions drop constraint if exists submissions_material_check;

update public.submissions
set source_material = jsonb_build_object(
  'facts', case when jsonb_typeof(source_material->'facts') = 'object' then source_material->'facts' else '{}'::jsonb end,
  'observations', case when jsonb_typeof(source_material->'observations') = 'array' then source_material->'observations' else '[]'::jsonb end,
  'quotes', case when jsonb_typeof(source_material->'quotes') = 'array' then source_material->'quotes' else '[]'::jsonb end,
  'forbiddenTopics', case
    when jsonb_typeof(source_material->'forbiddenTopics') = 'array' then source_material->'forbiddenTopics'
    when jsonb_typeof(source_material->'doNotMention') = 'array' then source_material->'doNotMention'
    else '[]'::jsonb
  end
)
where not (
  jsonb_typeof(source_material) = 'object'
  and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']
  and jsonb_typeof(source_material->'facts') = 'object'
  and jsonb_typeof(source_material->'observations') = 'array'
  and jsonb_typeof(source_material->'quotes') = 'array'
  and jsonb_typeof(source_material->'forbiddenTopics') = 'array'
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'submissions_material_check'
  ) then
    alter table public.submissions add constraint submissions_material_check check (
      jsonb_typeof(source_material) = 'object'
      and source_material ?& array['facts', 'observations', 'quotes', 'forbiddenTopics']
      and jsonb_typeof(source_material->'facts') = 'object'
      and jsonb_typeof(source_material->'observations') = 'array'
      and jsonb_typeof(source_material->'quotes') = 'array'
      and jsonb_typeof(source_material->'forbiddenTopics') = 'array'
    ) not valid;
  end if;
end $$;

alter table public.submissions validate constraint submissions_material_check;

commit;
