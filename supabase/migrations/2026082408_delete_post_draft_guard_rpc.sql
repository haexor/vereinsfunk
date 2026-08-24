begin;

-- Bislang gibt es keinen Weg, einen verworfenen Entwurf aus /beitraege wieder loszuwerden.
-- Loeschbar ist nur, was noch keine Freigabeanfrage durchlaufen hat -- ab awaiting_approval ist der
-- Beitrag Teil eines laufenden Freigabeprozesses, den ein stilles Verschwinden verwirren wuerde.
-- Der Status wird innerhalb derselben Transaktion per SELECT ... FOR UPDATE gegen ein
-- nebenlaeufiges Aendern (z.B. Einreichen zur Freigabe) gesperrt geprueft, bevor geloescht wird.
create or replace function public.delete_post_if_deletable(target_post_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target record;
  deleted_id uuid;
begin
  select status into target from public.posts where id = target_post_id for update;

  if not found then
    return null;
  end if;

  if target.status not in ('draft', 'facts_required', 'generating', 'draft_ready', 'changes_requested') then
    raise exception 'post_not_deletable: %', target.status;
  end if;

  delete from public.posts where id = target_post_id returning id into deleted_id;

  return deleted_id;
end;
$$;
revoke all on function public.delete_post_if_deletable(uuid) from public;
grant execute on function public.delete_post_if_deletable(uuid) to service_role;

commit;
