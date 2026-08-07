# ADR-009: Integrationsrahmen statt Einzelimporten

Status: angenommen · 7. August 2026

Vereine pflegen Personen, Mannschaften, Spielpläne und Veranstaltungen oft schon in einem Vereinsverwaltungssystem, Verbandsportal oder Mannschaftskalender. Ein Import pro Quelle und Bereich skaliert nicht: fünf Quellen mal vier Bereiche wären zwanzig Mal dieselbe Frage nach Abgleich, Konflikt, Trockenlauf und Löschschutz.

## Entscheidung

Transport (woher: Datei, HTTP, iCal, Webhook), Bereich (was: Personen, Mannschaften, Spiele, Veranstaltungen) und Abgleich (was passiert damit) werden getrennt. Nur Transport und Bereich sind pro Quelle verschieden; der Abgleich (`planSync` in `packages/integrations`) wird einmal geschrieben und gilt für jeden Bereich.

Feste Sicherungen gelten für jeden Bereich, nicht nur für Personen:

- Nichts wird gelöscht. Ein fehlender Datensatz wird stillgelegt, nie entfernt.
- Eine Verlustschwelle (Standard 30 %) bricht einen Lauf ab, statt Massenänderungen zu erzeugen.
- Ein unscharfer Treffer ohne eindeutige externe ID wird ein Konflikt, nie eine Vermutung.
- Ein unbekannter Struktur-Bezug (z. B. unbekannte Abteilung) erzeugt einen Konflikt, ändert nie die Vereinsstruktur.
- Eine lokale Korrektur gewinnt, wenn sie neuer ist als die Quelle.
- Jeder Lauf ist zweistufig: `dry_run` schreibt nur Vorschau und Konflikte, `apply` erst nach ausdrücklicher Bestätigung.

Herkunft wird inline auf jeder synchronisierbaren Tabelle geführt (`source_id`, `external_id`, `source_updated_at` mit zusammengesetztem Fremdschlüssel), nicht über eine zentrale polymorphe `integration_links`-Tabelle — ein polymorpher Verweis kann keinen Fremdschlüssel auf sein Ziel haben und würde die in AGENTS.md verlangte Fremdschlüsselsicherung gegen Cross-Tenant-Referenzen unterlaufen.

## Umfang in Paket 014

Nur Datei-Import (CSV/XLSX) und iCal sind implementiert. Ein HTTP-API-Adapter für ein konkretes Drittsystem (easyVerein, SpielerPlus, ClubDesk, …) ist ein eigener, späterer Spike mit dokumentiertem Testzugang — analog zum Meta-App-Review-Gate aus Paket 012. Webhook ist als Transportart vorgesehen, aber ohne Anbieter, der ihn nutzen könnte, nicht sinnvoll implementierbar.

Scraping von Verbandsportalen (fussball.de, nuLiga) kommt nicht in Betracht. Angeboten wird ausschließlich, was ein Anbieter als Export oder Feed bereitstellt.

## Konsequenz

Ein neuer Anbieter kostet künftig einen Adapter (Transport + Bereichs-Schema), nicht ein Teilsystem. Der erste Bereich auf diesem Rahmen ist das Mitgliederverzeichnis (ADR-008); Mannschaften, Spielpläne und Veranstaltungen folgen in Paket 019 auf demselben Rahmen.
