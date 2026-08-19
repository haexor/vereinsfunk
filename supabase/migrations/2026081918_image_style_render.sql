begin;

-- Plan 045, PR 2: schreibt das Ergebnis der Sharp-Kompositierung atomar fest -- ein neues,
-- sofort 'ready' medias_derivatives-Rezept-Snapshot plus die Aktualisierung der post_media-Zeile
-- auf dessen ID, in einer Transaktion. Die eigentliche Bildverarbeitung und der Storage-Schreib-
-- vorgang laufen vorher in TypeScript (Service Role) -- eine reine SQL-Funktion kann kein Sharp
-- ausfuehren und keine Storage-Bytes schreiben, siehe der wortgleiche Kommentar bei
-- accept_text_generation_candidate (2026081803). Analog dazu: service_role-only, aber der
-- aufrufende Akteur wird trotzdem explizit als Parameter uebergeben und der Post-Status hier
-- erneut geprueft -- Verteidigung gegen einen Race zwischen der Berechtigungspruefung in der
-- Route (User-Client, RLS via has_department_permission/has_team_permission) und diesem
-- Schreibvorgang. Die Berechtigungspruefung selbst wird hier NICHT erneut hergeleitet: anders als
-- accept_text_generation_candidate braeuchte das die volle, mehrfach kaskadierende
-- Rollen-Berechtigungs-CASE-Anweisung aus authz.has_department_permission (auth.uid()-basiert,
-- unter Service Role nicht auswertbar) in SQL dupliziert -- ein Wartungsrisiko, das die Route
-- schon vermeidet, indem sie 'post.edit' ueber den User-Client (echter auth.uid()-Kontext) prueft,
-- bevor sie diese Funktion ueberhaupt erreicht.
create or replace function public.apply_image_style_render(
  p_post_media_id uuid,
  p_actor_user_id uuid,
  p_style_preset_id uuid,
  p_expected_media_derivative_id uuid,
  p_media_asset_id uuid,
  p_object_path text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_recipe jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  media public.post_media%rowtype;
  version_row public.post_versions%rowtype;
  post_row public.posts%rowtype;
  derivative_id uuid;
begin
  select * into media from public.post_media where id = p_post_media_id for update;
  if not found then raise exception 'post_media_not_found'; end if;

  select * into version_row from public.post_versions where id = media.post_version_id and organization_id = media.organization_id;
  if not found then raise exception 'post_version_not_found'; end if;

  select * into post_row from public.posts where id = version_row.post_id and organization_id = version_row.organization_id for update;
  if not found then raise exception 'post_not_found'; end if;

  -- "Noch nicht zur Freigabe eingereicht" wie request_approval() sie versteht (2026081702): die
  -- drei Quellstatus, aus denen heraus ueberhaupt eingereicht werden kann, plus die fruehen,
  -- generierenden Zustaende davor. Alles ab awaiting_approval ist tabu -- eine bereits
  -- freigegebene/veroeffentlichte Version darf dieser Aufruf nicht mehr veraendern.
  if post_row.status not in ('draft', 'facts_required', 'generating', 'draft_ready', 'render_queued', 'rendering', 'changes_requested') then
    raise exception 'post_not_editable';
  end if;

  -- Compare-and-Set auf den Derivat-Zeiger: das 'for update' oben reiht zwei gleichzeitige
  -- Renderlaeufe zwar hintereinander, ohne diesen Vergleich entschiede aber die Commit-Reihenfolge
  -- statt der Anfragereihenfolge, welches Preset am Ende haengt. Wer Preset A anklickt und
  -- waehrenddessen Preset B, saehe in der Oberflaeche B (beide Antworten sind 201 mit der jeweils
  -- eigenen Derivat-ID), gespeichert waere aber A. Der Verlierer bekommt stattdessen
  -- 'post_media_changed' und die Route daraus einen 409. Deckt zugleich den Fall ab, dass sich der
  -- Zeiger zwischen dem Lesen in der Route und diesem Schreibvorgang ueberhaupt geaendert hat.
  -- Der Vergleich nimmt der Wiederholung unten nichts: die Route liest den Zeiger bei JEDEM
  -- Aufruf frisch, ein wiederholter Aufruf traegt also den inzwischen gestylten Stand als
  -- Erwartung -- und nicht mehr den, den der erste Aufruf vorfand.
  if media.media_derivative_id is distinct from p_expected_media_derivative_id then
    raise exception 'post_media_changed';
  end if;

  -- on conflict do nothing statt eines gewoehnlichen insert: object_path traegt den Hash des
  -- Rendering-Ergebnisses (Preset + Quellbild sind fuer Sharp deterministisch), ein Retry nach
  -- einem Netzwerkfehler erzeugt also denselben Pfad. Ein echtes upsert waere hier falsch --
  -- media_derivative_immutable (202608030001) verweigert jedes UPDATE einer bereits 'ready'-Zeile,
  -- ein on-conflict-do-update wuerde also am eigenen Retry scheitern.
  insert into public.media_derivatives (
    organization_id, media_asset_id, recipe, recipe_version, object_path, sha256, mime_type, byte_size, width, height, status, ready_at
  ) values (
    media.organization_id, p_media_asset_id, p_recipe, 'image-style-v1', p_object_path, p_sha256, p_mime_type, p_byte_size, p_width, p_height, 'ready', now()
  )
  on conflict (bucket_id, object_path) do nothing
  returning id into derivative_id;

  if derivative_id is null then
    select id into derivative_id from public.media_derivatives where bucket_id = 'rendered-media' and object_path = p_object_path;
  end if;

  update public.post_media set media_derivative_id = derivative_id where id = p_post_media_id;

  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
    values (media.organization_id, p_actor_user_id, 'post_media.style_rendered', 'post_media', p_post_media_id, gen_random_uuid(), jsonb_build_object('stylePresetId', p_style_preset_id, 'mediaDerivativeId', derivative_id));

  return derivative_id;
end;
$$;

revoke all on function public.apply_image_style_render(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_image_style_render(uuid, uuid, uuid, uuid, uuid, text, text, text, bigint, integer, integer, jsonb) to service_role;

commit;
