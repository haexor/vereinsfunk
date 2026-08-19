-- Plattform-Admin-Einladungsflow: add_platform_admin() verlangt ein bereits existierendes
-- auth.users-Konto und wirft sonst sofort einen Fehler -- es gab keinen Weg, eine noch nie
-- registrierte Person als Plattform-Admin einzuladen. Dieser Flow spiegelt den bestehenden
-- Vereinsmitglieder-Einladungsflow (create_invitation/accept_invitation/resend_invitation in
-- 2026080601_structure_and_invitations.sql), aber ohne Organisationsbezug und ohne das globale
-- Rate-Limit ueber invitation_send_counters: anders als Abteilungs-/Team-Verantwortliche
-- potenziell vieler Vereine ist der Kreis der Aufrufer hier auf bereits bestehende
-- Plattform-Admins beschraenkt, ein Pro-Zeile-Limit reicht.
create table public.platform_admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_sent_at timestamptz not null default now(),
  send_count int not null default 1 check (send_count between 1 and 10),
  created_at timestamptz not null default now()
);
create unique index platform_admin_invitations_open_unique on public.platform_admin_invitations (email)
  where accepted_at is null and revoked_at is null;
alter table public.platform_admin_invitations enable row level security;
-- Kein Grant fuer authenticated/anon, keine Policy: analog zu platform_admins selbst
-- (2026080502_platform_administration.sql) ausschliesslich ueber den Service-Role-Client der
-- API erreichbar, gated durch requirePlatformAdmin -- ausser accept_platform_admin_invitation()
-- unten, die bewusst an authenticated vergeben wird.
grant all privileges on public.platform_admin_invitations to service_role;

-- Nur service_role darf sie ausfuehren, aufgerufen von platformAdmin.ts erst nachdem
-- requirePlatformAdmin bereits geprueft hat -- deshalb keine eigene Berechtigungspruefung noetig
-- (anders als create_invitation(), das ueber den User-Client aufgerufen wird und deshalb seine
-- eigene Pruefung wiederholen muss).
create or replace function public.create_platform_admin_invitation(
  target_email text,
  target_token_hash text,
  added_by uuid
) returns public.platform_admin_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text := lower(trim(target_email));
  target_user_id uuid;
  existing record;
  result public.platform_admin_invitations;
begin
  select id into target_user_id from auth.users where email = normalized_email;

  if target_user_id is not null then
    if exists (select 1 from public.platform_admins where user_id = target_user_id) then
      raise exception 'already_platform_admin';
    end if;
    -- Gleiche Ausschlussregel wie reject_platform_admin_with_membership (2026080602), hier
    -- vorab geprueft, damit eine zum Scheitern bestimmte Einladung nicht erst beim
    -- Annahmeversuch der eingeladenen Person auffaellt.
    if exists (select 1 from public.organization_memberships where user_id = target_user_id)
      or exists (select 1 from public.department_memberships where user_id = target_user_id)
      or exists (select 1 from public.team_memberships where user_id = target_user_id)
    then
      raise exception 'member_cannot_become_platform_admin';
    end if;
  end if;

  select * into existing from public.platform_admin_invitations
    where email = normalized_email and accepted_at is null and revoked_at is null
    for update;

  if found then
    if existing.expires_at >= now() then
      raise exception 'invitation_already_open';
    end if;
    delete from public.platform_admin_invitations where id = existing.id;
  end if;

  begin
    insert into public.platform_admin_invitations (email, token_hash, invited_by, expires_at)
      values (normalized_email, target_token_hash, added_by, now() + interval '14 days')
      returning * into result;
  exception when unique_violation then
    raise exception 'invitation_already_open';
  end;

  return result;
end;
$$;
revoke all on function public.create_platform_admin_invitation(text, text, uuid) from public;
grant execute on function public.create_platform_admin_invitation(text, text, uuid) to service_role;

create or replace function public.resend_platform_admin_invitation(
  target_invitation_id uuid,
  target_token_hash text
) returns public.platform_admin_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invitation record;
  result public.platform_admin_invitations;
begin
  select * into invitation from public.platform_admin_invitations where id = target_invitation_id for update;
  if not found or invitation.accepted_at is not null or invitation.revoked_at is not null then
    raise exception 'not_found';
  end if;
  if invitation.last_sent_at > now() - interval '1 hour' then
    raise exception 'resent at most once per hour';
  end if;
  if invitation.send_count >= 10 then
    raise exception 'resend_limit_reached';
  end if;
  update public.platform_admin_invitations
    set token_hash = target_token_hash, last_sent_at = now(), send_count = send_count + 1
    where id = target_invitation_id
    returning * into result;
  return result;
end;
$$;
revoke all on function public.resend_platform_admin_invitation(uuid, text) from public;
grant execute on function public.resend_platform_admin_invitation(uuid, text) to service_role;

-- Einladung annehmen ist keine rollenbasierte Berechtigung, sondern durch den Rohtoken selbst
-- autorisiert -- deshalb security definer statt RLS-Policy, analog zu accept_invitation(). Die
-- annehmende Person ist zu diesem Zeitpunkt noch kein Plattform-Admin, deshalb Grant an
-- authenticated statt service_role; der Aufrufer wird ueber auth.uid() ermittelt, nie vom
-- Client uebernommen.
create or replace function public.accept_platform_admin_invitation(raw_token text) returns uuid
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
    raise exception 'accept_platform_admin_invitation requires an authenticated user';
  end if;

  select * into invitation from public.platform_admin_invitations
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

  -- platform_admins_reject_member (2026080602) wirft weiterhin member_cannot_become_platform_admin,
  -- falls die Person zwischen Einladung und Annahme doch noch einem Verein beigetreten ist.
  insert into public.platform_admins (user_id, created_by) values (actor_profile_id, invitation.invited_by)
    on conflict (user_id) do nothing;

  update public.platform_admin_invitations set accepted_at = now() where id = invitation.id;

  return actor_profile_id;
end;
$$;
revoke all on function public.accept_platform_admin_invitation(text) from public;
grant execute on function public.accept_platform_admin_invitation(text) to authenticated;
