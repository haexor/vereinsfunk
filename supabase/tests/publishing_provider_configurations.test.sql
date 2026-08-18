begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Die Provider-Konfiguration ist global und niemals fuer Vereinsmitglieder sichtbar. Diese
-- Negativtests pruefen Privilegien UND den fehlenden RPC-Grant, nicht nur eine leere RLS-Antwort.
set local role authenticated;
select throws_ok(
  $$select * from public.publishing_provider_configurations$$,
  '42501', null, 'authenticated cannot read publishing provider configurations'
);
select throws_ok(
  $$select * from public.publishing_provider_secrets$$,
  '42501', null, 'authenticated cannot read publishing provider secrets'
);
select throws_ok(
  $$insert into public.publishing_provider_configurations (provider, client_id) values ('meta', 'untrusted-client')$$,
  '42501', null, 'authenticated cannot write publishing provider configurations'
);
select throws_ok(
  $$select public.upsert_publishing_provider_configuration('meta', 'untrusted-client', null, '\x00'::bytea, 'v1', null)$$,
  '42501', null, 'authenticated cannot execute the atomic provider update RPC'
);

-- Die API verwendet ausschließlich die Service Role. Ihr positiver Zugriff bleibt möglich,
-- während die atomare Funktion die Konfiguration und das Secret gemeinsam schreibt.
set local role service_role;
select lives_ok(
  $$select public.upsert_publishing_provider_configuration('meta', 'service-client', 'v21.0', '\x00'::bytea, 'v1', null)$$,
  'service_role can atomically store a publishing provider configuration'
);
set local role postgres;
select is(
  (select client_id from public.publishing_provider_configurations where provider = 'meta'),
  'service-client',
  'atomic provider update stores the public client metadata'
);
select is(
  (select key_version from public.publishing_provider_secrets where provider = 'meta'),
  'v1',
  'atomic provider update stores the secret record'
);
select * from finish();
rollback;
