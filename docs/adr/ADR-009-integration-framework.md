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

Eine hinterlegte Feed-Adresse wird aus dem Netz der API abgerufen, also aus einer Position, die ein Verein von außen nicht hat. `apps/api/src/outboundFetch.ts` ist deshalb die einzige Stelle, an der das passieren darf. Bereits beim Speichern der Quelle prüft `isAllowedOutboundUrl` die URL selbst: nur `https`, kein Loopback-/`.local`-/`.internal`-Name, keine als Literal angegebene private/Loopback-/Link-Local-Adresse. Bei jedem Lauf löst `fetchPublicUrl` den Namen zusätzlich auf und prüft jede aufgelöste Adresse (auch über einen Namen, der erst zur Laufzeit dorthin auflöst) sowie jede Weiterleitung erneut, dazu feste Zeit- und Größengrenze — ein beim Speichern unauffälliger Name kann später auf eine andere Adresse zeigen. Die Namensauflösung der Prüfung ist dabei ein eigener Aufruf, kein an die Verbindung gebundenes Ergebnis — siehe „Bekannte Grenzen“.

## Bekannte Grenzen

- **Der Lauf ist nicht transaktional.** Anlage, Änderung und Stilllegung sind einzelne Schreibvorgänge; es gibt keine Klammer darum. Bricht einer ab, bleiben die vorherigen bestehen. Der Lauf wird deshalb *vor* dem ersten Schreibvorgang angelegt und im Fehlerfall auf `failed` gesetzt — die halb angewandte Änderung ist damit nachweisbar, aber nicht zurückgenommen. Aufräumen ist Handarbeit.
- **Serialisierung und Idempotenz (seit Paket 026).** `acquire_integration_sync_run` legt den Lauf atomar an und prüft dabei, dass die Quelle zur Organisation gehört. Ein `Idempotency-Key` bindet Quelle, Bereich und Request an exakt eine Laufzeile: Wiederholungen geben diese Zeile zurück, ohne die Quelle erneut zu lesen. Pro Quelle und Bereich kann zugleich höchstens ein `apply`-Lauf den Status `running` haben; Dry-Runs bleiben parallel, weil sie keine Fachdaten ändern. Dieselbe Service-Role-RPC ist auch für den künftigen `sync_cron` verbindlich.
- **Wiederherstellung eines hängen gebliebenen Laufs.** Ein berechtigter Quellenverwalter kann einen `running`-Lauf über `POST /v1/integration-sources/:id/sync-runs/:runId/cancel` erst nach bestätigtem Prozessabbruch als `cancelled` abschließen. Das schreibt `finished_at`, aktualisiert den Quellenstatus und erzeugt einen Audit-Eintrag. Die Abschlusshelfer verändern nur noch `running`-Läufe, damit ein alter Prozess einen bewusst abgebrochenen Status nicht nachträglich überschreibt. Der Endpunkt ist kein Interrupt für einen tatsächlich noch laufenden Request: ihn bei einem lebenden Prozess zu benutzen kann die im folgenden Punkt beschriebene Teilanwendung nicht zurücknehmen.
- **Rebinding-Fenster zwischen Adressprüfung und Verbindung.** `fetchPublicUrl` löst den Namen vor der Anfrage auf und verwirft jede private/interne Adresse (`assertResolvesPublicly`); der nachfolgende `fetch()`-Aufruf löst denselben Namen für den tatsächlichen Verbindungsaufbau ein zweites Mal auf, ohne an die zuvor geprüfte Adresse gebunden zu sein. Ein Name mit sehr kurzer TTL könnte zwischen beiden Auflösungen auf eine interne Adresse wechseln (DNS-Rebinding) und die Prüfung damit umgehen. Ein Schließen bräuchte eine Verbindung, die an die geprüfte Adresse gebunden ist (eigener Dispatcher/Lookup statt des globalen `fetch`) — nicht Teil dieses Pakets.
- **Eine stillgelegte Person wird nicht automatisch reaktiviert.** Taucht jemand, der als `left` markiert wurde, in einer späteren Datei wieder auf, ohne dass die Quelle eine Statusspalte liefert, bleibt der Status stehen — die Quelle sagt dazu nichts, und stillschweigend zu reaktivieren wäre eine Aussage, die sie nicht gemacht hat. Wer das ändern will, pflegt den Status von Hand oder nimmt eine Statusspalte in den Export auf.

## Konsequenz

Ein neuer Anbieter kostet künftig einen Adapter (Transport + Bereichs-Schema), nicht ein Teilsystem. Der erste Bereich auf diesem Rahmen ist das Mitgliederverzeichnis (ADR-008); Mannschaften, Spielpläne und Veranstaltungen folgen in Paket 019 auf demselben Rahmen.
