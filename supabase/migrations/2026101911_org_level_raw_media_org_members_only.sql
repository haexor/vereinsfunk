begin;

-- Rohmedien auf Vereinsebene (media_assets.department_id null, Storage-Pfad
-- organizations/<org>/assets/...) waren seit 2026082504/2026082505 fuer authz.is_any_member_of_organization
-- lesbar -- also auch fuer reine Team- oder Abteilungsmitglieder ohne Vereinsrolle, darunter die
-- Rolle 'player' (2026100801), in der Praxis oft Minderjaehrige. Ein Spieler konnte damit
-- ungepruefte Originalfotos samt face_regions jedes Vereinsbeitrags lesen und herunterladen.
-- Genau diesen Radius hat 2026080901 fuer den Abteilungszweig von storage_read_raw_media schon
-- einmal zurueckgenommen ("nur Text und freigegebene Derivate, nie Rohmedien"). Der Abteilungszweig
-- nutzt authz.is_department_member, das ausser der Abteilung nur eine Vereinsrolle anerkennt; das
-- Gegenstueck fuer die Vereinsebene ist authz.is_organization_member. Wer ein Vereinsmedium anlegen
-- oder bearbeiten darf (has_organization_permission), haelt ohnehin eine Vereinsrolle.

alter policy media_assets_select on public.media_assets using (
  authz.is_department_member(department_id)
  or (department_id is null and authz.is_organization_member(organization_id))
);

alter policy face_regions_select on public.face_regions using (
  exists (
    select 1 from public.media_assets asset
    where asset.id = media_asset_id
      and asset.organization_id = face_regions.organization_id
      and (
        authz.is_department_member(asset.department_id)
        or (asset.department_id is null and authz.is_organization_member(asset.organization_id))
      )
  )
);

-- Unveraendert gegenueber 2026082504 bis auf den 'assets'-Zweig.
alter policy storage_read_raw_media on storage.objects using (
  bucket_id = 'raw-media'
  and (storage.foldername(name))[1] = 'organizations'
  and case (storage.foldername(name))[3]
    when 'compliance' then authz.has_organization_permission(((storage.foldername(name))[2])::uuid, 'organization.manage')
    when 'exports' then authz.has_organization_permission(((storage.foldername(name))[2])::uuid, 'organization.manage')
    when 'consents' then
      (storage.foldername(name))[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and authz.can_read_consent_evidence_object(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[4])::uuid)
    when 'departments' then
      (storage.foldername(name))[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and authz.is_department_member(((storage.foldername(name))[4])::uuid)
    when 'brand' then authz.is_any_member_of_organization(((storage.foldername(name))[2])::uuid)
    when 'assets' then authz.is_organization_member(((storage.foldername(name))[2])::uuid)
    else false
  end
);

commit;
