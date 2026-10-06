-- Paket 051, PR 2: Modulauswahl schreiben und das Abschalten von social_media gegen laufende
-- Veroeffentlichungen absichern.
--
-- Beide Schreibwege, die ueber eine Veroeffentlichung entscheiden, nehmen denselben
-- transaktionalen Advisory-Lock je Verein:
--   * set_scope_enabled_modules() aendert die Modulauswahl einer Ebene und verweigert das
--     Abschalten von social_media, solange darunter Veroeffentlichungen aktiv sind;
--   * claim_publication_for_execution() prueft unmittelbar vor dem Start (queued -> uploading),
--     ob social_media fuer den Beitrag noch aktiv ist, und bricht sonst mit module_disabled ab.
-- Damit kann das Abschalten nicht zwischen Pruefung und Start einer Veroeffentlichung committen,
-- und nach seinem Commit startet keine Veroeffentlichung mehr. Die Betreiberentscheidung vom
-- 2026-10-06 sprach von einem Worker -- Veroeffentlichungen startet heute ausschliesslich
-- POST /v1/publications/:id/execute, deshalb sitzt die Pruefung im Claim dieses Endpunkts.

create or replace function authz.lock_organization_modules(target_organization_id uuid) returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtextextended('app_module:' || target_organization_id::text, 0));
$$;
revoke all on function authz.lock_organization_modules(uuid) from public;

-- Wie authz.module_enabled(), aber nur Tarif und die Ebenen OBERHALB von target_scope -- was eine
-- Ebene ueberhaupt auswaehlen darf. Ohne Mitgliedschaftspruefung und ohne Grant: nur aus den
-- security-definer-Funktionen unten aufgerufen, die den Aufrufer vorher selbst pruefen.
create or replace function authz.module_enabled_above(
  target_organization_id uuid, target_scope public.policy_scope, target_department_id uuid, target_module public.app_module
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
      not exists (select 1 from public.organization_subscriptions s where s.organization_id = target_organization_id)
      or exists (
        select 1
          from public.organization_subscriptions s
          join public.subscription_plans p on p.key = s.plan_key
         where s.organization_id = target_organization_id
           and target_module = any(p.included_modules)
      )
    )
    and not exists (
      select 1
        from public.policy_settings ps
       where ps.organization_id = target_organization_id
         and ps.enabled_modules is not null
         and not (target_module = any(ps.enabled_modules))
         and (
           (ps.scope = 'organization' and target_scope in ('department', 'team'))
           or (ps.scope = 'department' and target_scope = 'team' and ps.department_id = target_department_id)
         )
    );
$$;
revoke all on function authz.module_enabled_above(uuid, public.policy_scope, uuid, public.app_module) from public;

-- Aktive Veroeffentlichungen (queued, uploading, processing) eines Teilbaums, fuer die social_media
-- derzeit wirksam ist -- gemessen am Beitrag (Abteilung/Mannschaft des posts), nicht am Kanal.
create or replace function authz.active_social_publications(
  target_organization_id uuid, target_scope public.policy_scope, target_department_id uuid, target_team_id uuid
) returns table (publication_id uuid, post_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select publication.id, version.post_id
    from public.publications publication
    join public.post_versions version
      on version.organization_id = publication.organization_id and version.id = publication.post_version_id
    join public.posts post
      on post.organization_id = version.organization_id and post.id = version.post_id
   where publication.organization_id = target_organization_id
     and publication.status in ('queued', 'uploading', 'processing')
     and (
       target_scope = 'organization'
       or (target_scope = 'department' and post.department_id = target_department_id)
       or (target_scope = 'team' and post.team_id = target_team_id)
     )
     and authz.module_enabled(publication.organization_id, post.department_id, post.team_id, 'social_media');
$$;
revoke all on function authz.active_social_publications(uuid, public.policy_scope, uuid, uuid) from public;

-- Schreibt policy_settings.enabled_modules einer Ebene. Rechte wie set_policy_rules():
-- organization.manage / department.manage / team.manage auf genau dieser Ebene.
--   * module_not_available (DETAIL: JSON-Liste der Module): die Auswahl nennt ein Modul, das
--     oberhalb (Tarif, Verein, Abteilung) nicht aktiv ist -- eine Ebene kann nur abwaehlen.
--   * module_has_active_publications (DETAIL: JSON-Liste {publicationId, postId}): die Aenderung
--     wuerde social_media fuer mindestens eine aktive Veroeffentlichung abschalten.
create or replace function public.set_scope_enabled_modules(
  target_organization_id uuid, target_scope text, target_department_id uuid, target_team_id uuid,
  target_modules public.app_module[]
) returns public.policy_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authorized boolean;
  existing_id uuid;
  result public.policy_settings;
  normalized public.app_module[];
  unavailable public.app_module[];
  active_before uuid[];
  affected jsonb;
begin
  if target_scope = 'organization' then
    if target_department_id is not null or target_team_id is not null then
      raise exception 'invalid_scope';
    end if;
    authorized := authz.has_organization_permission(target_organization_id, 'organization.manage');
  elsif target_scope = 'department' then
    if target_team_id is not null or not exists (
      select 1 from public.departments d where d.id = target_department_id and d.organization_id = target_organization_id
    ) then
      raise exception 'invalid_scope';
    end if;
    authorized := authz.has_department_permission(target_department_id, 'department.manage');
  elsif target_scope = 'team' then
    if not exists (
      select 1 from public.teams t
       where t.id = target_team_id and t.department_id = target_department_id and t.organization_id = target_organization_id
    ) then
      raise exception 'invalid_scope';
    end if;
    authorized := authz.has_team_permission(target_team_id, 'team.manage');
  else
    raise exception 'invalid_scope';
  end if;
  if not authorized then
    raise exception 'insufficient_permission';
  end if;

  perform authz.lock_organization_modules(target_organization_id);

  if target_modules is not null then
    select coalesce(array_agg(distinct module order by module), '{}') into normalized from unnest(target_modules) module;
    select coalesce(array_agg(module order by module), '{}') into unavailable
      from unnest(normalized) module
     where not authz.module_enabled_above(target_organization_id, target_scope::public.policy_scope, target_department_id, module);
    if cardinality(unavailable) > 0 then
      raise exception 'module_not_available' using detail = array_to_json(unavailable)::text;
    end if;
  end if;

  select coalesce(array_agg(active.publication_id), '{}') into active_before
    from authz.active_social_publications(target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id) active;

  select id into existing_id from public.policy_settings
    where organization_id = target_organization_id
      and scope = target_scope::public.policy_scope
      and department_id is not distinct from target_department_id
      and team_id is not distinct from target_team_id
    for update;

  if existing_id is null then
    insert into public.policy_settings (organization_id, scope, department_id, team_id, enabled_modules, updated_by)
      values (target_organization_id, target_scope::public.policy_scope, target_department_id, target_team_id, normalized, auth.uid())
      returning * into result;
  else
    update public.policy_settings set enabled_modules = normalized, updated_by = auth.uid(), updated_at = now()
      where id = existing_id
      returning * into result;
  end if;

  -- Vorher/Nachher unter demselben Lock: jede Veroeffentlichung, die vorher social_media hatte und
  -- jetzt nicht mehr, blockiert die Aenderung. Die Exception rollt das Schreiben oben zurueck.
  if cardinality(active_before) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('publicationId', publication.id, 'postId', version.post_id) order by publication.id), '[]'::jsonb)
      into affected
      from public.publications publication
      join public.post_versions version
        on version.organization_id = publication.organization_id and version.id = publication.post_version_id
      join public.posts post
        on post.organization_id = version.organization_id and post.id = version.post_id
     where publication.id = any(active_before)
       and not authz.module_enabled(publication.organization_id, post.department_id, post.team_id, 'social_media');
    if jsonb_array_length(affected) > 0 then
      raise exception 'module_has_active_publications' using detail = affected::text;
    end if;
  end if;

  return result;
end;
$$;
revoke all on function public.set_scope_enabled_modules(uuid, text, uuid, uuid, public.app_module[]) from public;
grant execute on function public.set_scope_enabled_modules(uuid, text, uuid, uuid, public.app_module[]) to authenticated;

-- Ersetzt das Compare-and-Set queued -> uploading in POST /v1/publications/:id/execute.
-- Ergebnis: 'claimed', 'module_disabled' (Veroeffentlichung auf cancelled gesetzt, Versuch mit
-- error_class module_disabled protokolliert, kein erneuter Versuch), 'invalid_status' oder
-- 'not_found'. Nur fuer die API (service_role); die Berechtigung des Aufrufers prueft die Route.
create or replace function public.claim_publication_for_execution(target_publication_id uuid) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
begin
  select publication.id, publication.organization_id, post.department_id, post.team_id
    into target
    from public.publications publication
    join public.post_versions version
      on version.organization_id = publication.organization_id and version.id = publication.post_version_id
    join public.posts post
      on post.organization_id = version.organization_id and post.id = version.post_id
   where publication.id = target_publication_id;
  if not found then
    return 'not_found';
  end if;

  perform authz.lock_organization_modules(target.organization_id);

  if not authz.module_enabled(target.organization_id, target.department_id, target.team_id, 'social_media') then
    update public.publications set status = 'cancelled' where id = target.id and status = 'queued';
    if not found then
      return 'invalid_status';
    end if;
    insert into public.publication_attempts (organization_id, publication_id, attempt_number, status, error_class)
      values (
        target.organization_id, target.id,
        (select coalesce(max(attempt.attempt_number), 0) + 1 from public.publication_attempts attempt where attempt.publication_id = target.id),
        'cancelled', 'module_disabled'
      );
    return 'module_disabled';
  end if;

  update public.publications set status = 'uploading' where id = target.id and status = 'queued';
  if not found then
    return 'invalid_status';
  end if;
  return 'claimed';
end;
$$;
revoke all on function public.claim_publication_for_execution(uuid) from public;
grant execute on function public.claim_publication_for_execution(uuid) to service_role;
