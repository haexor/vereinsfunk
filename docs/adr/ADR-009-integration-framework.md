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

Eine hinterlegte Feed-Adresse wird aus dem Netz der API abgerufen, also aus einer Position, die ein Verein von außen nicht hat. `apps/api/src/outboundFetch.ts` ist deshalb die einzige Stelle, an der das passieren darf: nur `https`, keine Loopback-/privaten/Link-Local-Ziele (auch nicht über einen Namen, der dorthin auflöst, und nicht über eine Weiterleitung), feste Zeit- und Größengrenze. Die Prüfung greift beim Speichern der Quelle **und** bei jedem Lauf — ein Name kann später auf eine andere Adresse zeigen. Die Namensauflösung der Prüfung ist dabei ein eigener Aufruf, kein an die Verbindung gebundenes Ergebnis — siehe „Bekannte Grenzen“.

## Bekannte Grenzen

- **Der Lauf ist nicht transaktional.** Anlage, Änderung und Stilllegung sind einzelne Schreibvorgänge; es gibt keine Klammer darum. Bricht einer ab, bleiben die vorherigen bestehen. Der Lauf wird deshalb *vor* dem ersten Schreibvorgang angelegt und im Fehlerfall auf `failed` gesetzt — die halb angewandte Änderung ist damit nachweisbar, aber nicht zurückgenommen. Aufräumen ist Handarbeit.
- **Kein Schutz gegen gleichzeitige oder wiederholte Läufe.** `POST /v1/integration-sources/:id/sync` führt Lesen und Schreiben synchron im Request aus. Zwei parallele `apply`-Läufe auf derselben Quelle, oder eine Wiederholung nach einem Timeout auf der Leitung, sind heute nicht ausgeschlossen. Der unscharfe Abgleich und der Unique-Index auf `(organization_id, source_id, external_id)` begrenzen den Schaden, verhindern ihn aber nicht. Eine echte Absicherung (Sperre je Quelle und Bereich, Idempotenzschlüssel über den ganzen Lauf) muss den gemeinsamen Schreibpfad schützen, den dieser Endpunkt schon heute synchron ausführt und den `sync_cron` später zusätzlich aufruft — eine Sperre nur für `sync_cron` würde die parallelen oder wiederholten API-Läufe von heute nicht schließen. Umsetzung mit Paket 004.
- **Rebinding-Fenster zwischen Adressprüfung und Verbindung.** `fetchPublicUrl` löst den Namen vor der Anfrage auf und verwirft jede private/interne Adresse (`assertResolvesPublicly`); der nachfolgende `fetch()`-Aufruf löst denselben Namen für den tatsächlichen Verbindungsaufbau ein zweites Mal auf, ohne an die zuvor geprüfte Adresse gebunden zu sein. Ein Name mit sehr kurzer TTL könnte zwischen beiden Auflösungen auf eine interne Adresse wechseln (DNS-Rebinding) und die Prüfung damit umgehen. Ein Schließen bräuchte eine Verbindung, die an die geprüfte Adresse gebunden ist (eigener Dispatcher/Lookup statt des globalen `fetch`) — nicht Teil dieses Pakets.
- **Eine stillgelegte Person wird nicht automatisch reaktiviert.** Taucht jemand, der als `left` markiert wurde, in einer späteren Datei wieder auf, ohne dass die Quelle eine Statusspalte liefert, bleibt der Status stehen — die Quelle sagt dazu nichts, und stillschweigend zu reaktivieren wäre eine Aussage, die sie nicht gemacht hat. Wer das ändern will, pflegt den Status von Hand oder nimmt eine Statusspalte in den Export auf.

## Konsequenz

Ein neuer Anbieter kostet künftig einen Adapter (Transport + Bereichs-Schema), nicht ein Teilsystem. Der erste Bereich auf diesem Rahmen ist das Mitgliederverzeichnis (ADR-008); Mannschaften, Spielpläne und Veranstaltungen folgen in Paket 019 auf demselben Rahmen.
