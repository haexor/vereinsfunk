begin;

-- Nachtrag zu 2026082504: media_assets darf seit dieser Migration department_id null tragen
-- (Medien auf Vereinsebene), face_regions haengt seine Sichtbarkeit und sein Schreibrecht aber
-- weiterhin allein an der Abteilung des Assets. authz.is_department_member(null) und
-- authz.has_department_permission(null, ...) sind beide false -- ein Foto ohne Abteilung liess sich
-- dadurch nicht markieren (PhotoAttachment.vue schreibt face_regions direkt aus dem Browser, und
-- das insert ... returning braucht zusaetzlich die SELECT-Policy). Damit war der ganze Weg "Foto
-- mit abgebildeten Personen an einen Vereinsbeitrag haengen" gesperrt, denn
-- confirm_media_people_review(faces_present => true) verlangt mindestens eine Markierung.
-- Dieselbe Fallback-Verzweigung wie media_assets_select/media_assets_insert in 2026082504, mit
-- derselben Berechtigung wie der jeweils bestehende Abteilungszweig.

alter policy face_regions_select on public.face_regions using (
  exists (
    select 1 from public.media_assets asset
    where asset.id = media_asset_id
      and asset.organization_id = face_regions.organization_id
      and (
        authz.is_department_member(asset.department_id)
        or (asset.department_id is null and authz.is_any_member_of_organization(asset.organization_id))
      )
  )
);

alter policy face_regions_write on public.face_regions using (
  exists (
    select 1 from public.media_assets asset
    where asset.id = media_asset_id
      and asset.organization_id = face_regions.organization_id
      and (
        authz.has_department_permission(asset.department_id, 'post.edit')
        or (asset.department_id is null and authz.has_organization_permission(asset.organization_id, 'post.edit'))
      )
  )
) with check (
  exists (
    select 1 from public.media_assets asset
    where asset.id = media_asset_id
      and asset.organization_id = face_regions.organization_id
      and (
        authz.has_department_permission(asset.department_id, 'post.edit')
        or (asset.department_id is null and authz.has_organization_permission(asset.organization_id, 'post.edit'))
      )
  )
);

commit;
