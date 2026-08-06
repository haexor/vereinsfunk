begin;

-- Paket 023, Teil 1: reine RLS-Aenderung ohne neues Schema -- bewusst von der Policy-Grundlage
-- (naechste Migration) getrennt, damit ein Fehler hier nicht mit neuem Schema vermischt ist
-- (Plan 023, "Risiken": "Die Sichtbarkeitsmigration fasst Policies an, auf denen alles
-- aufsetzt.").

-- "Vereinsweit" fuer Sichtbarkeit heisst jede Mitgliedschaft im Verein -- Organisationsrolle,
-- Abteilung oder Team --, nicht nur eine Organisationsrolle wie authz.is_organization_member:
-- die meisten Vereinsmitglieder haben ausschliesslich eine Abteilungs- oder Teamrolle, keine
-- Organisationsrolle. Mit authz.is_organization_member allein bliebe die vereinsweite
-- Sichtbarkeit auf organization_admin/owner & Co. beschraenkt und wuerde den in Plan 023
-- genannten Zweck ("die Leute im Verein erfahren so mehr ueber die anderen Abteilungen und
-- Teams") verfehlen. Eine eigene, engere Funktion statt is_organization_member breiter zu
-- fassen: die bestehende Funktion sichert bereits organizations_select_member,
-- brand_profiles_select, consent_records_select sowie
-- media_derivatives/social_connections/publications_select -- deren Sichtbarkeitsradius
-- aendert dieses Paket nicht mit.
create or replace function authz.is_any_member_of_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select authz.is_organization_member(target_organization_id)
    or exists (
      select 1 from public.department_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = auth.uid()
        and (membership.expires_at is null or membership.expires_at > now())
    )
    or exists (
      select 1 from public.team_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = auth.uid()
        and (membership.expires_at is null or membership.expires_at > now())
    );
$$;
revoke all on function authz.is_any_member_of_organization(uuid) from public;
grant execute on function authz.is_any_member_of_organization(uuid) to authenticated, service_role;

-- Sichtbarkeit, drei Aenderungen (Plan 023, "Datenmodell"):
-- 1. veroeffentlichte/geplante Beitraege werden vereinsweit sichtbar (posts_select).
-- 2. ein reines Teammitglied sieht zusaetzlich die Entwuerfe des eigenen Teams
--    (posts_select, submissions_select) -- vorher griff nur is_department_member, das eine
--    department_memberships-Zeile oder eine Organisationsrolle voraussetzt.
-- 3. post_versions_select folgt derselben Regel wie posts_select, damit die Ebene nicht wieder
--    auseinanderlaeuft: vorher war post_versions_select mit is_organization_member fuer JEDEN
--    Status breiter als posts_select (Fassungstext vereinsweit lesbar, der Beitrag selbst nur
--    fuer Abteilungs-/Teammitglieder auflistbar).
alter policy posts_select on public.posts
  using (
    (status in ('published', 'scheduled') and authz.is_any_member_of_organization(organization_id))
    or authz.is_department_member(department_id)
    or (team_id is not null and authz.has_team_membership(team_id))
  );

alter policy submissions_select on public.submissions
  using (
    authz.is_department_member(department_id)
    or (team_id is not null and authz.has_team_membership(team_id))
  );

alter policy post_versions_select on public.post_versions
  using (
    exists (
      select 1 from public.posts post
      where post.id = post_versions.post_id
        and post.organization_id = post_versions.organization_id
        and (
          (post.status in ('published', 'scheduled') and authz.is_any_member_of_organization(post.organization_id))
          or authz.is_department_member(post.department_id)
          or (post.team_id is not null and authz.has_team_membership(post.team_id))
        )
    )
  );

-- Ruckbau (Plan 023, "4. Rueckbau"): die viewer-Zeile in der Elternabteilung war der einzige Weg,
-- wie ein reines Teammitglied ueberhaupt Inhalte sah (Plan 010, "Risiken") -- posts_select und
-- submissions_select decken das jetzt direkt ueber has_team_membership ab, ohne dass daraus eine
-- vollwertige Abteilungsmitgliedschaft entsteht (die z. B. auch is_department_member fuer JEDE
-- andere Abteilungsfunktion ausloesen wuerde).
create or replace function public.accept_invitation(raw_token text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation record;
  actor_email text;
  actor_profile_id uuid;
begin
  actor_profile_id := auth.uid();
  if actor_profile_id is null then
    raise exception 'accept_invitation requires an authenticated user';
  end if;

  select * into invitation from public.invitations
    where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
    for update;

  if not found
    or invitation.accepted_at is not null
    or invitation.revoked_at is not null
    or invitation.expires_at < now()
  then
    raise exception 'invitation_not_found_or_expired';
  end if;

  select email into actor_email from auth.users where id = actor_profile_id;
  if actor_email is null or lower(actor_email) <> lower(invitation.email) then
    raise exception 'invitation_email_mismatch';
  end if;

  if invitation.team_id is not null then
    insert into public.team_memberships (organization_id, department_id, team_id, user_id, role)
      values (invitation.organization_id, invitation.department_id, invitation.team_id, actor_profile_id, invitation.role::public.team_role)
      on conflict (team_id, user_id, role) do nothing;
  elsif invitation.department_id is not null then
    insert into public.department_memberships (organization_id, department_id, user_id, role)
      values (invitation.organization_id, invitation.department_id, actor_profile_id, invitation.role::public.department_role)
      on conflict (department_id, user_id, role) do nothing;
  else
    insert into public.organization_memberships (organization_id, user_id, role)
      values (invitation.organization_id, actor_profile_id, invitation.role::public.organization_role)
      on conflict (organization_id, user_id, role) do nothing;
  end if;

  update public.invitations set accepted_at = now() where id = invitation.id;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id)
    values (invitation.organization_id, actor_profile_id, 'invitation.accepted', 'invitations', invitation.id, gen_random_uuid());

  return jsonb_build_object(
    'organizationId', invitation.organization_id,
    'departmentId', invitation.department_id,
    'teamId', invitation.team_id,
    'role', invitation.role
  );
end;
$$;

-- Rueckwirkende Bereinigung zum Rueckbau oben: die accept_invitation-Fassung vor diesem Paket
-- (Plan 010) legte fuer jede Team-Einladung zusaetzlich eine viewer-Zeile in der Elternabteilung
-- an. Diese Zeile macht authz.is_department_member() fuer die GESAMTE Abteilung wahr (nicht nur
-- fuer das eigene Team) und gaebe betroffenen Nutzern damit ueber posts_select/submissions_select
-- weiterhin die vollstaendige Abteilungssicht, die dieses Paket bewusst auf has_team_membership
-- einschraenkt. Geloescht wird nur, wo dieselbe Person eine Teammitgliedschaft in genau dieser
-- Abteilung hat -- also exakt die Kombination, die ausschliesslich durch den alten Nebeneffekt
-- entstehen konnte; eine eigenstaendig vergebene Abteilungsmitgliedschaft ohne Teambezug bleibt
-- unangetastet.
delete from public.department_memberships viewer_row
  using public.team_memberships team_row
  where viewer_row.role = 'viewer'
    and viewer_row.department_id = team_row.department_id
    and viewer_row.user_id = team_row.user_id;

commit;
