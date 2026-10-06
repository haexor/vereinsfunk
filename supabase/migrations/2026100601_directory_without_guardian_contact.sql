-- Paket 054: Verzeichnis ohne Elternkontakt, eigene E-Mail je Person.
--
-- Betreiberentscheidung 2026-10-06: Wer einem Verein beitritt, hat die Erlaubnis der Eltern; die
-- Einwilligung zu Fotos geben die Eltern beim Eintritt ab (consent_records, origin 'paper',
-- signer_role 'guardian') -- dafuer braucht es keine gespeicherte Elternadresse. Die Spalten
-- verschwinden deshalb ersatzlos, mit ihnen die vorhandenen Werte (gewollt, Datenminimierung).
--
-- DROP COLUMN entfernt auch den unbenannten Tabellen-CHECK aus 2026080703
-- ("not is_minor or guardian_email is not null or status <> 'active'"), weil er guardian_email
-- referenziert -- PostgreSQL loescht Tabellen-Constraints, die eine geloeschte Spalte verwenden,
-- automatisch mit.
alter table public.directory_people
  drop column guardian_name,
  drop column guardian_email,
  add column email text check (email = lower(email) and email = btrim(email) and char_length(email) between 3 and 254);

-- Die Adresse der Person selbst ist kein besonders geschuetztes Feld wie zuvor der Elternkontakt:
-- Wer die Person ueber directory_people_select sehen darf (directory.read im Scope), braucht sie zum
-- Einladen. Die uebrigen Spaltenrechte aus 2026080703 bleiben unveraendert.
grant select (email) on public.directory_people to authenticated;

-- Ohne den CHECK kann der Abgleich in beide Richtungen schreiben. Die Richtung volljaehrig ->
-- minderjaehrig tritt nur nach einer Korrektur des Geburtsjahrs auf, die nicht ueber die API lief
-- (die API leitet is_minor beim Aendern selbst ab); dann ist die Person ab sofort wieder
-- minderjaehrig und became_adult_at wird zurueckgesetzt.
create or replace function public.recompute_directory_minor_status()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected record;
begin
  for affected in
    select person.id, person.organization_id
    from public.directory_people person
    join public.organizations org on org.id = person.organization_id
    where person.is_minor = true
      and person.birth_year is not null
      and extract(year from (now() at time zone org.timezone))::int > person.birth_year + 18
  loop
    update public.directory_people
    set is_minor = false, became_adult_at = now(), updated_at = now()
    where id = affected.id;
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (affected.organization_id, null, 'directory_person.became_adult', 'directory_people', affected.id, gen_random_uuid(), '{}'::jsonb);
  end loop;

  for affected in
    select person.id, person.organization_id
    from public.directory_people person
    join public.organizations org on org.id = person.organization_id
    where person.is_minor = false
      and person.birth_year is not null
      and extract(year from (now() at time zone org.timezone))::int <= person.birth_year + 18
  loop
    update public.directory_people
    set is_minor = true, became_adult_at = null, updated_at = now()
    where id = affected.id;
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (affected.organization_id, null, 'directory_person.minor_status_corrected', 'directory_people', affected.id, gen_random_uuid(), '{}'::jsonb);
  end loop;
end;
$$;
revoke all on function public.recompute_directory_minor_status() from public;
grant execute on function public.recompute_directory_minor_status() to service_role;
