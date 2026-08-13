begin;

-- Plan 037: a globally-scoped, admin-curated persona catalogue, distinct from
-- content_style_profiles. organization_id there is not null and part of every composite foreign
-- key (composition_sessions -> content_style_profiles(organization_id, id)); making it nullable
-- to host global rows would break that FK for a caller whose organizationId is never null. Style
-- profiles/personas are frozen into composition_sessions.style_profile_snapshot purely by value
-- (like the five hardcoded system modes today), so no foreign key is needed here at all.
create table public.platform_style_personas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$' and char_length(slug) <= 64),
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 500),
  style_rules jsonb not null check (jsonb_typeof(style_rules) = 'object'),
  avoid_rules text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(avoid_rules) <= 30 and public.text_array_elements_within_length(avoid_rules, 160)),
  -- Dieselben fuenf reservierten Slugs wie content_style_profiles (2026081003, Zeile 48): eine
  -- Persona darf keinen Basismodus verdecken.
  check (slug not in ('klar_erklaerend', 'warm_gemeinschaftlich', 'lebendig_sportlich', 'leicht_humorvoll', 'feierlich_wertschaetzend'))
);

alter table public.platform_style_personas enable row level security;
alter table public.platform_style_personas force row level security;
-- Keine Sonderbehandlung von organization_id noetig -- es gibt keine. Sichtbarkeit ist bewusst
-- nicht auf is_active eingeschraenkt (das filtert wie bei content_style_profiles die Anwendung),
-- sondern rein "kann ueberhaupt lesen": jeder authentifizierte Nutzer, kein Vereinsbezug.
create policy platform_style_personas_select on public.platform_style_personas
  for select to authenticated using (true);
grant select on public.platform_style_personas to authenticated;
grant all privileges on public.platform_style_personas to service_role;

create trigger set_platform_style_personas_updated_at before update on public.platform_style_personas
  for each row execute function public.set_updated_at();

-- Beidseitiger Kollisionsschutz: ein Slug darf nicht gleichzeitig ein Vereinsprofil und eine
-- Persona benennen (verwirrende Dopplung im zusammengefuehrten Auswahl-Ergebnis). Eine CHECK-
-- Constraint kann keine Subquery enthalten (siehe Kommentar in 2026081003 zu
-- text_array_elements_within_length), deshalb zwei kleine Trigger statt eines CHECKs.
create or replace function public.reject_persona_slug_collision() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.content_style_profiles where slug = new.slug) then
    raise exception 'slug % is already used by a club style profile', new.slug;
  end if;
  return new;
end; $$;
create trigger platform_style_personas_reject_collision before insert or update of slug
  on public.platform_style_personas for each row execute function public.reject_persona_slug_collision();

create or replace function public.reject_tenant_slug_collision_with_persona() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_style_personas where slug = new.slug) then
    raise exception 'slug % is reserved by a platform persona', new.slug;
  end if;
  return new;
end; $$;
create trigger content_style_profiles_reject_persona_collision before insert or update of slug
  on public.content_style_profiles for each row execute function public.reject_tenant_slug_collision_with_persona();

commit;
