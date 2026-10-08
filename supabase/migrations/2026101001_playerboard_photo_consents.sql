-- Paket 052, PR 3: Einwilligungsstand des Kaders fuer oeffentliche Trainingsfotos.
--
-- Die Trainer-Oberflaeche braucht je Kaderspieler die Einwilligung, die beim Foto-Review gilt
-- (Hinweis an der Punkteeingabe, Liste auf der Einstellungsseite, Vorauswahl im Review). Die
-- Pruefung bleibt in authz.playerboard_photo_consent_valid -- dieselbe Funktion, die der Review
-- verwendet --, damit Oberflaeche und Review nie auseinanderlaufen.
--
-- Nur fuer die API (service_role): sie prueft vorher Modul und training.manage auf der Mannschaft
-- bzw. consent.manage in der Abteilung, wie playerboard_review_photo_consent.
create or replace function public.playerboard_team_photo_consents(target_team_id uuid)
returns table (player_id uuid, directory_person_id uuid, consent_record_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select player.id, player.directory_person_id, valid_record.id
    from public.playerboard_players player
    join public.teams team on team.id = player.team_id
    left join lateral (
      -- Juengste gueltige Einwilligung zuerst: ein spaeterer Nachweis ersetzt in der Praxis den
      -- frueheren, auch wenn superseded_by (noch) nicht gesetzt ist.
      select record.id
        from public.consent_records record
       where record.organization_id = player.organization_id
         and record.directory_person_id = player.directory_person_id
         and authz.playerboard_photo_consent_valid(record.id, player.directory_person_id, team.department_id)
       order by coalesce(record.signed_at::timestamptz, record.created_at) desc, record.created_at desc
       limit 1
    ) valid_record on true
   where player.team_id = target_team_id;
$$;
revoke all on function public.playerboard_team_photo_consents(uuid) from public;
grant execute on function public.playerboard_team_photo_consents(uuid) to service_role;
