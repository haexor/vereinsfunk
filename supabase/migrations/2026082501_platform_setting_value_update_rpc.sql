begin;

-- PUT /v1/platform-settings/:key konnte einen Schluessel wie agent_llm_provider_configuration_id
-- nie wieder auf "kein Override" (das jsonb-Literal null) zuruecksetzen: PostgREST bildet ein
-- JSON-null im Update-Body IMMER auf SQL-NULL ab, unabhaengig vom Spaltentyp -- value ist aber
-- `not null`, jede solche Anfrage schlug mit einem 500er fehl. Diese RPC nimmt den Wert deshalb
-- als text entgegen und castet ihn selbst zu jsonb; ein text-Parameter unterliegt derselben
-- Null-Mehrdeutigkeit nicht, solange der Aufrufer den JSON-String selbst kodiert (z.B. "null" fuer
-- das Literal, statt eines echten JSON-null).
create or replace function public.update_platform_setting_value(
  target_key text,
  target_value_json text,
  actor_user_id uuid
)
returns public.platform_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  result_row public.platform_settings;
begin
  update public.platform_settings
  set value = target_value_json::jsonb, updated_by = actor_user_id
  where key = target_key
  returning * into result_row;

  return result_row;
end;
$$;
revoke all on function public.update_platform_setting_value(text, text, uuid) from public;
grant execute on function public.update_platform_setting_value(text, text, uuid) to service_role;

commit;
