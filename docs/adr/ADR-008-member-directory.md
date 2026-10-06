# ADR-008: Personenbezogenes Mitgliederverzeichnis

Status: angenommen · ursprüngliche Entscheidung 7. August 2026; Datenmodell durch Paket 054 aktualisiert

Bis Paket 014 war das System bewusst personenarm: `consent_records.pseudonymous_subject_ref` ist eine freie Kennung, `face_regions.subject_kind` unterscheidet `adult`/`minor`/`unknown` nur als manuelle Angabe je Bildregion. Ohne ein Verzeichnis lässt sich nicht nachvollziehbar sagen, ob für die Person auf einem bestimmten Foto eine gültige Einwilligung existiert — jede Markierung ist eine Einzelentscheidung ohne Gedächtnis.

`public.directory_people` führt Klarnamen, Geburtsjahr und optional die eigene E-Mail-Adresse für Personen, die auf Vereinsmedien vorkommen können. Das ist eine bewusste Erweiterung des Datenschutzumfangs, kein Automatismus.

Paket 054 (6. Oktober 2026) hat die ursprünglich hier beschlossenen Elternkontakt-Spalten und den zugehörigen Datenbank-Check ersetzt. Elternkontakte werden nicht mehr im Verzeichnis gespeichert; die Einwilligungsverwaltung verlangt für Minderjährige weiterhin die Rolle `guardian`, deren Nachweis beim Vereinseintritt oder über eine Einwilligungsanfrage geführt wird.

## Entscheidung

- Nur die im Plan aufgeführten Felder werden **importiert**: Vorname, Nachname, Geburtsjahr (nicht das vollständige Geburtsdatum), Abteilung/Mannschaft, Status/Ein- und Austrittsdatum und die eigene E-Mail-Adresse. Adresse, Bankverbindung, Geschlecht, Nationalität, Gesundheitsdaten, Spielberechtigungen und Freitextnotizen werden nicht importiert, auch wenn eine Quelle sie liefert. `PersonExternalSchema` (`packages/member-directory`) ist diese Grenze im Code: was dort nicht steht, kann eine Feldzuordnung nicht hereinholen.
- Darüber hinaus führt `directory_people` drei Felder, die **nicht** aus einer Quelle stammen, sondern intern entstehen. Sie unterliegen denselben Lese- und Löschregeln wie der Rest der Zeile:
  - `profile_id` — freiwillige Verknüpfung zu einem App-Konto, nur von Hand gesetzt; Zweck ist, eine Verzeichnisperson als vorhandenes Mitglied wiederzuerkennen.
  - `joined_at` — „seit wann dabei", fachlich Teil des Importvertrags, aber auch von Hand pflegbar.
  - `became_adult_at` — Zeitstempel des Übergangs minderjährig → volljährig, gesetzt vom täglichen Abgleich; Zweck ist die Liste „Volljährig geworden — Einwilligung prüfen". Ein Abschlussschritt für diese Liste fehlt bewusst noch und gehört zu Paket 015.
  - `source_id`/`external_id`/`source_updated_at` sind reine Herkunftsangaben, keine Personendaten.
- Keine Gesichtserkennung, kein automatischer Abgleich von Gesicht zu Person, keine biometrischen Merkmale, keine Vektoren, keine Ähnlichkeitssuche. Die Verknüpfung zwischen einer Gesichtsregion und einer Person entsteht ausschließlich, wenn ein Mensch sie herstellt.
- Lesen ist eng begrenzt: `department_admin`/`team_manager` der zugeordneten Einheit sowie `organization_admin`/`organization_owner` — nicht jedes Vereinsmitglied. Die eigene E-Mail-Adresse folgt derselben Scope-Berechtigung wie die übrigen Verzeichnisdaten.
- Schreiben läuft ausschließlich über die API mit Service Role, nie über eine direkte Policy für `authenticated`.
- Eine aktive minderjährige Person braucht keinen gespeicherten Elternkontakt. Die Einwilligung für Minderjährige muss weiterhin von einer erziehungsberechtigten Person erteilt und als `signer_role = 'guardian'` nachgewiesen werden.
- Löschfristen sind kurz zu halten; das bleibt Aufgabe von Paket 020 (rechtliche Pflichten und Datenschutzbetrieb).

## Konsequenz

Ein Verein kann jetzt nachvollziehbar sagen, wer minderjährig ist und welche eigene E-Mail-Adresse optional hinterlegt ist — die Eltern-E-Mail wird nicht gespeichert. Die Einwilligungsverwaltung bewahrt weiterhin den Nachweis einer guardian-Einwilligung. Im Gegenzug trägt das System jetzt Klarnamen neben pseudonymen Gesichtsregionen, ein Risikoprofil, das es vorher nicht hatte.
