# ADR-008: Personenbezogenes Mitgliederverzeichnis

Status: angenommen · 7. August 2026

Bis Paket 014 war das System bewusst personenarm: `consent_records.pseudonymous_subject_ref` ist eine freie Kennung, `face_regions.subject_kind` unterscheidet `adult`/`minor`/`unknown` nur als manuelle Angabe je Bildregion. Ohne ein Verzeichnis lässt sich nicht nachvollziehbar sagen, ob für die Person auf einem bestimmten Foto eine gültige Einwilligung existiert — jede Markierung ist eine Einzelentscheidung ohne Gedächtnis.

`public.directory_people` führt Klarnamen, Geburtsjahr und Elternkontakt für Personen, die auf Vereinsmedien vorkommen können. Das ist eine bewusste Erweiterung des Datenschutzumfangs, kein Automatismus.

## Entscheidung

- Nur die im Plan aufgeführten Felder werden **importiert**: Vorname, Nachname, Geburtsjahr (nicht das vollständige Geburtsdatum), Abteilung/Mannschaft, Status/Ein- und Austrittsdatum, Elternkontakt (Name, E-Mail). Adresse, Bankverbindung, Geschlecht, Nationalität, Gesundheitsdaten, Spielberechtigungen und Freitextnotizen werden nicht importiert, auch wenn eine Quelle sie liefert. `PersonExternalSchema` (`packages/member-directory`) ist diese Grenze im Code: was dort nicht steht, kann eine Feldzuordnung nicht hereinholen.
- Darüber hinaus führt `directory_people` drei Felder, die **nicht** aus einer Quelle stammen, sondern intern entstehen. Sie unterliegen denselben Lese- und Löschregeln wie der Rest der Zeile:
  - `profile_id` — freiwillige Verknüpfung zu einem App-Konto, nur von Hand gesetzt; Zweck ist, eine Verzeichnisperson als vorhandenes Mitglied wiederzuerkennen.
  - `joined_at` — „seit wann dabei", fachlich Teil des Importvertrags, aber auch von Hand pflegbar.
  - `became_adult_at` — Zeitstempel des Übergangs minderjährig → volljährig, gesetzt vom täglichen Abgleich; Zweck ist die Liste „Volljährig geworden — Einwilligung prüfen". Ein Abschlussschritt für diese Liste fehlt bewusst noch und gehört zu Paket 015.
  - `source_id`/`external_id`/`source_updated_at` sind reine Herkunftsangaben, keine Personendaten.
- Keine Gesichtserkennung, kein automatischer Abgleich von Gesicht zu Person, keine biometrischen Merkmale, keine Vektoren, keine Ähnlichkeitssuche. Die Verknüpfung zwischen einer Gesichtsregion und einer Person entsteht ausschließlich, wenn ein Mensch sie herstellt.
- Lesen ist eng begrenzt: `department_admin`/`team_manager` der zugeordneten Einheit sowie `organization_admin`/`organization_owner` — nicht jedes Vereinsmitglied. Elternkontakt ist zusätzlich spaltenweise gesperrt und braucht `department.manage` oder höher.
- Schreiben läuft ausschließlich über die API mit Service Role, nie über eine direkte Policy für `authenticated`.
- Eine aktive minderjährige Person braucht zwingend einen Elternkontakt (Datenbank-CHECK) — sonst kann keine Einwilligung eingeholt werden.
- Löschfristen sind kurz zu halten; das bleibt Aufgabe von Paket 020 (rechtliche Pflichten und Datenschutzbetrieb).

## Konsequenz

Ein Verein kann jetzt nachvollziehbar sagen, wer minderjährig ist und wie ein Elternteil erreichbar ist — die Voraussetzung für Paket 015 (Einwilligungsverwaltung). Im Gegenzug trägt das System jetzt Klarnamen neben pseudonymen Gesichtsregionen, ein Risikoprofil, das es vorher nicht hatte.
