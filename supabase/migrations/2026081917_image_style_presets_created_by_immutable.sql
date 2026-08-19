begin;

-- created_by ist die Herkunftsangabe eines Presets, wie bei brand_assets. Die update-Policy prueft
-- nur brand.manage auf der Ebene des Presets, nicht welche Spalten sich aendern -- ohne diese
-- Sperre koennte jede Person mit brand.manage created_by auf eine beliebige andere profiles.id
-- umbiegen und so die Urheberschaft eines fremden Presets faelschen.
create or replace function public.enforce_immutable_image_style_preset_created_by()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'image style preset created_by is immutable';
  end if;
  return new;
end;
$$;
create trigger image_style_presets_created_by_immutable before update on public.image_style_presets
  for each row execute function public.enforce_immutable_image_style_preset_created_by();

commit;
