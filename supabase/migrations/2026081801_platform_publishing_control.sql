begin;

-- Globaler, fail-closed Betriebs-Schalter für externe Aktionen. Er gehört nicht zu einem
-- Verein: im Sicherheits- oder Provider-Incident muss ein Plattform-Admin jeden Tenant zugleich
-- schützen können. RLS/Grants bleiben die bereits in 2026080502 eingerichtete deny-all-Policy;
-- ausschließlich die service-role-gatete API liest oder verändert diesen Wert.
insert into public.platform_settings (key, value)
values ('publishing_enabled', 'false'::jsonb)
on conflict (key) do nothing;

commit;
