begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

set local role postgres;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '42000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@pgtap-reservation.local', '', '{}', '{}', now(), now());

insert into public.organizations (id, name, slug) values
  ('42000000-1000-4000-8000-000000000001', 'PGTAP Reservation Verein', 'pgtap-reservation-verein'),
  ('42000000-1000-4000-8000-000000000002', 'PGTAP Reservation Verein Ohne Abo', 'pgtap-reservation-verein-ohne-abo');
insert into public.departments (id, organization_id, name, slug) values
  ('42000000-1100-4000-8000-000000000001', '42000000-1000-4000-8000-000000000001', 'Fußball', 'fussball'),
  ('42000000-1100-4000-8000-000000000002', '42000000-1000-4000-8000-000000000002', 'Fußball', 'fussball');

insert into public.subscription_plans (key, display_name, storage_bytes) values ('pgtap_reservation_plan', 'PGTAP Reservierungstarif', 1000);
insert into public.organization_subscriptions (organization_id, plan_key) values ('42000000-1000-4000-8000-000000000001', 'pgtap_reservation_plan');
-- 42000000-...-000002 bleibt bewusst ohne organization_subscriptions-Zeile.

-- 1-2: eine Reservierung unter der Vereinsgrenze legt eine echte media_assets-Zeile an, die
-- storage_usage_bytes() ab jetzt mitzaehlt.
select is(
  (select upload_status from public.reserve_storage_upload(
    '42000000-1000-4000-8000-000000000001', '42000000-1100-4000-8000-000000000001', '42000000-2000-4000-8000-000000000001',
    'raw-media', 'organizations/x/departments/y/assets/1/a.jpg', 'image/jpeg', 400, '42000000-0000-4000-8000-000000000001'
  )),
  'initiated', 'reserve_storage_upload inserts a media_assets row with upload_status initiated'
);
select is(
  public.storage_usage_bytes('42000000-1000-4000-8000-000000000001'),
  400::bigint, 'the reservation is immediately visible to storage_usage_bytes()'
);

-- 3: eine zweite Reservierung, die die Vereinsgrenze (1000) ueberschreiten wuerde, wird abgelehnt
-- und legt keine Zeile an.
select throws_ok(
  $$select public.reserve_storage_upload(
    '42000000-1000-4000-8000-000000000001', '42000000-1100-4000-8000-000000000001', '42000000-2000-4000-8000-000000000002',
    'raw-media', 'organizations/x/departments/y/assets/2/b.jpg', 'image/jpeg', 700, '42000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'storage_limit_reached: organization/1000/400', 'a reservation that would exceed the organization limit is rejected, naming the limit and the current usage'
);
select is((select count(*)::integer from public.media_assets where id = '42000000-2000-4000-8000-000000000002'), 0, 'the rejected reservation left no media_assets row behind');

-- 4: eine Abteilungsgrenze greift, obwohl die Vereinsgrenze noch Platz haette.
insert into public.storage_limits (organization_id, scope, department_id, storage_bytes, set_by) values
  ('42000000-1000-4000-8000-000000000001', 'department', '42000000-1100-4000-8000-000000000001', 500, '42000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.reserve_storage_upload(
    '42000000-1000-4000-8000-000000000001', '42000000-1100-4000-8000-000000000001', '42000000-2000-4000-8000-000000000003',
    'raw-media', 'organizations/x/departments/y/assets/3/c.jpg', 'image/jpeg', 200, '42000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'storage_limit_reached: department/500/400', 'a reservation blocked by the department limit is rejected even though the organization limit still has room'
);

-- 5: ohne jede organization_subscriptions-Zeile gilt weiterhin "keine Grenze aus diesem Paket" --
-- dieselbe Ausnahme wie beim Struktur-Trigger und bei schedule_publication().
select is(
  (select upload_status from public.reserve_storage_upload(
    '42000000-1000-4000-8000-000000000002', '42000000-1100-4000-8000-000000000002', '42000000-2000-4000-8000-000000000004',
    'raw-media', 'organizations/x/departments/y/assets/4/d.jpg', 'image/jpeg', 999999999, '42000000-0000-4000-8000-000000000001'
  )),
  'initiated', 'an organization without any subscription row is not restricted by reserve_storage_upload'
);

-- 6-8: set_subscription_plan_content_limits ersetzt die komplette Zeilenmenge atomar.
insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month) values
  ('pgtap_reservation_plan', 'own_upload', 5), ('pgtap_reservation_plan', 'ai_image', 5), ('pgtap_reservation_plan', 'ai_video', 5);
select public.set_subscription_plan_content_limits('pgtap_reservation_plan', '[
  {"mediaOrigin":"own_upload","maxPerMonth":40,"maxDurationSeconds":null},
  {"mediaOrigin":"ai_image","maxPerMonth":null,"maxDurationSeconds":null},
  {"mediaOrigin":"ai_video","maxPerMonth":6,"maxDurationSeconds":20}
]'::jsonb);
select is(
  (select max_per_month from public.subscription_plan_content_limits where plan_key = 'pgtap_reservation_plan' and media_origin = 'own_upload'),
  40, 'set_subscription_plan_content_limits replaces an existing row with the new value'
);
select is(
  (select max_duration_seconds from public.subscription_plan_content_limits where plan_key = 'pgtap_reservation_plan' and media_origin = 'ai_video'),
  20, 'set_subscription_plan_content_limits writes the new max_duration_seconds for ai_video'
);
-- Ein Duplikat verletzt den Primary Key (plan_key, media_origin) mitten im insert -- die
-- Transaktion rollt komplett zurueck, die alten Zeilen bleiben unangetastet (anders als bei einem
-- delete()+insert() ueber zwei getrennte PostgREST-Aufrufe, das einen Tarif ohne jedes Kontingent
-- zurueckgelassen haette).
select throws_ok(
  $$select public.set_subscription_plan_content_limits('pgtap_reservation_plan', '[
    {"mediaOrigin":"own_upload","maxPerMonth":1,"maxDurationSeconds":null},
    {"mediaOrigin":"own_upload","maxPerMonth":2,"maxDurationSeconds":null}
  ]'::jsonb)$$,
  '23505', null, 'a duplicate media_origin in the payload violates the primary key and rolls back the whole replacement'
);
select is(
  (select max_per_month from public.subscription_plan_content_limits where plan_key = 'pgtap_reservation_plan' and media_origin = 'own_upload'),
  40, 'after the rolled-back attempt, the plan still has its previous content limits, not zero'
);

select * from finish();
rollback;
