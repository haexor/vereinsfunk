-- Paket 052, PR 1: neue Team-Rolle 'player' (Spielerin/Spieler einer Mannschaft im Modul
-- PlayerBoard). Eigene, vorgelagerte Migration: ein per ADD VALUE ergaenzter Enum-Wert ist erst
-- nach dem Commit verwendbar, die Kernmigration 2026100802_playerboard_core.sql darf ihn also nicht
-- in derselben Transaktion nutzen.
alter type public.team_role add value if not exists 'player';
