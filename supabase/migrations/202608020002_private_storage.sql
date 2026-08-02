insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('raw-media', 'raw-media', false, 104857600, array['image/jpeg','image/png','image/webp','video/mp4']),
  ('rendered-media', 'rendered-media', false, 524288000, array['image/jpeg','image/png','video/mp4']),
  ('brand-assets', 'brand-assets', false, 20971520, array['image/svg+xml','image/png','image/jpeg','font/woff2'])
on conflict (id) do nothing;

create policy storage_read_own_organization on storage.objects for select to authenticated
using (
  bucket_id in ('raw-media', 'rendered-media', 'brand-assets')
  and (storage.foldername(name))[1] = 'organizations'
  and authz.is_organization_member(((storage.foldername(name))[2])::uuid)
);

create policy storage_upload_department on storage.objects for insert to authenticated
with check (
  bucket_id = 'raw-media'
  and (storage.foldername(name))[1] = 'organizations'
  and (storage.foldername(name))[3] = 'departments'
  and authz.is_organization_member(((storage.foldername(name))[2])::uuid)
  and authz.has_department_permission(((storage.foldername(name))[4])::uuid, 'post.create')
);
