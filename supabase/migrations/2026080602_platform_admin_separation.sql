begin;

-- Der Plattform-Admin ist der Betreiber der Plattform, kein Kunde: dasselbe Konto darf nicht
-- gleichzeitig Vereinsmitglied sein. Paket 022 hatte "orthogonal zu allen vereinsbezogenen
-- Rollen" (2026080502_platform_administration.sql) rein additiv umgesetzt -- ein Admin-Konto
-- konnte weiterhin Vereine anlegen, Beitraege schreiben und Einladungen annehmen. Ein
-- Sicherheitsloch war das nie (platform_admins vergibt kein einziges Vereinsrecht, jede
-- Vereinsroute prueft ausschliesslich Mitgliedschaften) -- aber die Vermischung von Betreiber-
-- und Kundenrolle in einem Konto ist fuer ein Mehrmandanten-SaaS die falsche Grundlage.
--
-- Durchgesetzt wird symmetrisch an beiden Seiten, damit die Reihenfolge egal ist: weder kann
-- ein Admin Mitglied werden noch ein Mitglied Admin. Trigger statt Constraint, weil die
-- Bedingung ueber zwei Tabellen laeuft.
--
-- Bestehende Ueberschneidungen bereinigt diese Migration bewusst nicht: welches der beiden
-- Konten Vorrang hat, ist eine Betreiber-, keine Migrationsentscheidung. Ein solches Altkonto
-- wird von der Oberflaeche ab jetzt als Betreiber behandelt (middleware/auth.global.ts) und
-- kommt an seinen Verein nicht mehr heran.
--
-- Kein Advisory-Lock wie in create_organization(): die einzige Race ist "Admin wird angelegt,
-- waehrend derselbe Mensch eine Einladung annimmt". Das Ergebnis waere eine geduldete
-- Ueberschneidung wie oben, kein Rechteproblem -- der Aufwand einer Serialisierung jedes
-- Mitgliedschafts-Inserts steht dazu in keinem Verhaeltnis.
--
-- Security definer, weil der Trigger sonst mit den Rechten des Einfuegenden laeuft: eine
-- Mitgliedschaft entsteht auch als gewoehnlicher Insert des Nutzer-Clients (POST
-- /v1/memberships, Policies organization_memberships_insert & Co.), und authenticated hat auf
-- platform_admins bewusst kein einziges Privileg (2026080502_platform_administration.sql:141).
-- Ohne definer-Rechte scheitert jeder solche Insert an "permission denied for table
-- platform_admins" (42501) statt an der eigentlichen Bedingung. Ein blosses GRANT SELECT waere
-- die falsche Antwort: platform_admins hat RLS ohne Policy, die Pruefung saehe null Zeilen und
-- wuerde die Trennung still durchwinken -- genau umgekehrt zum Zweck dieser Migration.
create or replace function public.reject_membership_for_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.platform_admins where user_id = new.user_id) then
    raise exception 'platform_admin_cannot_hold_membership';
  end if;
  return new;
end;
$$;

-- Alle drei Mitgliedschaftstabellen: accept_invitation() legt je nach Scope der Einladung nur
-- eine department_memberships- oder team_memberships-Zeile an, ohne organization_memberships
-- (2026080601_structure_and_invitations.sql) -- ein Trigger allein auf der Vereinsebene waere
-- ueber eine Abteilungs- oder Teameinladung umgehbar.
create trigger organization_memberships_reject_platform_admin
  before insert or update of user_id on public.organization_memberships
  for each row execute function public.reject_membership_for_platform_admin();

create trigger department_memberships_reject_platform_admin
  before insert or update of user_id on public.department_memberships
  for each row execute function public.reject_membership_for_platform_admin();

create trigger team_memberships_reject_platform_admin
  before insert or update of user_id on public.team_memberships
  for each row execute function public.reject_membership_for_platform_admin();

-- Gegenrichtung: bootstrap_platform_admin()/add_platform_admin() duerfen kein Konto zum
-- Betreiber machen, das irgendwo Mitglied ist. Beide sind security definer und umgehen RLS,
-- der Trigger greift trotzdem.
create or replace function public.reject_platform_admin_with_membership()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.organization_memberships where user_id = new.user_id)
    or exists (select 1 from public.department_memberships where user_id = new.user_id)
    or exists (select 1 from public.team_memberships where user_id = new.user_id)
  then
    raise exception 'member_cannot_become_platform_admin';
  end if;
  return new;
end;
$$;

create trigger platform_admins_reject_member
  before insert on public.platform_admins
  for each row execute function public.reject_platform_admin_with_membership();

commit;
