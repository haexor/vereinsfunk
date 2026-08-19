begin;

-- Plan 045, PR 1: 'frame' als neue brand_asset_kind fuer eigene Rahmengrafiken (neben dem bereits
-- bestehenden, bislang toten 'watermark'). Eigene Migration VOR jeder Referenz auf den neuen Wert:
-- ALTER TYPE ... ADD VALUE darf zwar in einer eigenen Transaktion laufen, der neue Wert ist aber
-- erst nach deren Commit verwendbar (Postgres-Doku zu ALTER TYPE). Die nachfolgende Migration
-- 2026081916 referenziert 'frame' und muss deshalb in einer eigenen, spaeteren Transaktion stehen.
alter type public.brand_asset_kind add value 'frame';

commit;
