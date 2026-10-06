-- Paket 051: Modulrahmen. Vereinsfunk ist die Rahmenanwendung, fachliche Anwendungen sind Module.
--
-- Wirksame Module einer Ebene = Tarif.included_modules
--                              ∩ Verein.enabled_modules      (null = alles aus dem Tarif)
--                              ∩ Abteilung.enabled_modules   (null = erben)
--                              ∩ Mannschaft.enabled_modules  (null = erben)
-- Eine untere Ebene kann ein Modul nur abwaehlen, nie eines hinzunehmen -- dieselbe
-- Schnittmengen-Semantik wie allowed_channel_ids (mergeAllowedList, Paket 011).
--
-- Kein eigener Katalog: die Modulmenge ist Code (Routen, Seiten, Worker). Ein neues Modul ist immer
-- ein Deploy, deshalb ein Enum, gespiegelt in packages/domain (appModules), packages/contracts
-- (AppModuleSchema) und packages/authorization (permissionModule).
create type public.app_module as enum ('social_media', 'playerboard');

alter table public.subscription_plans
  add column included_modules public.app_module[] not null default '{social_media}';

-- Bestand: jeder heutige Tarif enthaelt beide Module, damit kein Verein durch die Migration etwas
-- verliert und PlayerBoard sofort nutzbar ist.
update public.subscription_plans set included_modules = '{social_media,playerboard}';

alter table public.policy_settings
  add column enabled_modules public.app_module[];      -- null = erben, '{}' = kein Modul
-- Spaltenweise Leserechte wie bei default_target_platforms (Paket 044); geschrieben wird ueber
-- die API (Paket 051, PR 2), nicht direkt.
grant select (enabled_modules) on public.policy_settings to authenticated;

-- Fuer RLS kuenftiger Modultabellen (PlayerBoard ab Paket 052) und fuer die API. Ohne jede
-- organization_subscriptions-Zeile beschraenkt der Tarif nichts -- dieselbe Ausnahme wie in
-- effective_limits()/enforce_structure_limit()/schedule_publication() (Paket 021). Der Status des
-- Abos zaehlt hier wie dort nicht. policy_settings-Zeilen ohne enabled_modules (null) und
-- fehlende Zeilen sind neutral.
create or replace function authz.module_enabled(
  target_organization_id uuid, target_department_id uuid, target_team_id uuid, target_module public.app_module
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
           ps.scope = 'organization'
           or (ps.scope = 'department' and target_department_id is not null and ps.department_id = target_department_id)
           or (ps.scope = 'team' and target_team_id is not null and ps.team_id = target_team_id)
         )
    );
$$;
revoke all on function authz.module_enabled(uuid, uuid, uuid, public.app_module) from public;
grant execute on function authz.module_enabled(uuid, uuid, uuid, public.app_module) to authenticated, service_role;
