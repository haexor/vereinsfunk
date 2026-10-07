-- Paket 051, PR 3: dieselbe Absicherung wie set_scope_enabled_modules() und
-- update_subscription_plan(), aber fuer den Tarifwechsel EINES Vereins. Sowohl der
-- Self-Service-Wechsel (POST /v1/subscription/plan) als auch die Zuweisung durch den
-- Plattform-Admin (PUT /v1/platform-admin/organizations/:id/subscription) schreiben
-- organization_subscriptions direkt -- ein Trigger deckt beide Wege und jeden kuenftigen ab.
--
-- Verliert der Verein durch den Wechsel social_media, wird er verweigert, solange Veroeffentlichungen
-- aktiv sind (module_has_active_publications, DETAIL: JSON-Liste {publicationId, postId}). Der Lock
-- ist derselbe wie im Claim (claim_publication_for_execution): ein paralleler Start wartet und sieht
-- danach den neuen Tarif.
create or replace function public.guard_subscription_module_change() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  had_social_media boolean;
  has_social_media boolean;
  affected jsonb;
begin
  if tg_op = 'UPDATE' and new.plan_key = old.plan_key then
    return new;
  end if;

  -- Ohne bisherige Zeile schraenkt der Tarif nichts ein (wie authz.module_enabled).
  had_social_media := tg_op = 'INSERT' or exists (
    select 1 from public.subscription_plans p where p.key = old.plan_key and 'social_media' = any(p.included_modules)
  );
  has_social_media := exists (
    select 1 from public.subscription_plans p where p.key = new.plan_key and 'social_media' = any(p.included_modules)
  );
  if not had_social_media or has_social_media then
    return new;
  end if;

  perform authz.lock_organization_modules(new.organization_id);
  -- BEFORE-Trigger: active_social_publications sieht noch den bisherigen Tarif, liefert also genau
  -- die Veroeffentlichungen, die social_media durch den Wechsel verloeren.
  select coalesce(jsonb_agg(jsonb_build_object('publicationId', active.publication_id, 'postId', active.post_id) order by active.publication_id), '[]'::jsonb)
    into affected
    from authz.active_social_publications(new.organization_id, 'organization', null, null) active;
  if jsonb_array_length(affected) > 0 then
    raise exception 'module_has_active_publications' using detail = affected::text;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_subscription_module_change() from public;

create trigger organization_subscriptions_module_guard
  before insert or update of plan_key on public.organization_subscriptions
  for each row execute function public.guard_subscription_module_change();
