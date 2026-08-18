begin;

-- Metadaten und zugehöriges Secret werden von der API als eine fachliche Konfiguration
-- behandelt. Ein einzelnes RPC hält beide Writes in derselben Transaktion: ein fehlgeschlagener
-- Secret-Write darf keine neue Client-ID ohne passendes Secret (oder umgekehrt) hinterlassen.
create function public.upsert_publishing_provider_configuration(
  target_provider text,
  target_client_id text,
  target_graph_version text,
  target_client_secret_ciphertext bytea,
  target_key_version text,
  actor_user_id uuid
)
returns public.publishing_provider_configurations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  saved_configuration public.publishing_provider_configurations;
begin
  insert into public.publishing_provider_configurations (
    provider, client_id, graph_version, updated_by
  )
  values (
    target_provider, target_client_id, target_graph_version, actor_user_id
  )
  on conflict (provider) do update
  set
    client_id = excluded.client_id,
    graph_version = excluded.graph_version,
    updated_by = excluded.updated_by
  returning * into saved_configuration;

  insert into public.publishing_provider_secrets (
    provider, client_secret_ciphertext, key_version
  )
  values (
    target_provider, target_client_secret_ciphertext, target_key_version
  )
  on conflict (provider) do update
  set
    client_secret_ciphertext = excluded.client_secret_ciphertext,
    key_version = excluded.key_version,
    updated_at = now();

  return saved_configuration;
end;
$$;

revoke all on function public.upsert_publishing_provider_configuration(text, text, text, bytea, text, uuid) from public;
grant execute on function public.upsert_publishing_provider_configuration(text, text, text, bytea, text, uuid) to service_role;

commit;
