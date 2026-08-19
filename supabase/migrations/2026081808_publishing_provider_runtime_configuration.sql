begin;

create table public.publishing_provider_configurations (
  provider text primary key check (provider in ('meta', 'twitter', 'linkedin')),
  client_id text not null check (char_length(client_id) between 1 and 500),
  graph_version text check (graph_version is null or char_length(graph_version) between 1 and 80),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.publishing_provider_configurations enable row level security;
create trigger set_publishing_provider_configurations_updated_at before update on public.publishing_provider_configurations
  for each row execute function public.set_updated_at();

create table public.publishing_provider_secrets (
  provider text primary key references public.publishing_provider_configurations(provider) on delete cascade,
  client_secret_ciphertext bytea not null,
  key_version text not null,
  updated_at timestamptz not null default now()
);
alter table public.publishing_provider_secrets enable row level security;
alter table public.publishing_provider_secrets force row level security;

grant all privileges on public.publishing_provider_configurations, public.publishing_provider_secrets to service_role;

commit;
