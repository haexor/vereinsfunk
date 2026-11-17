# ADR-013: Öffentliche PlayerBoard-Namensanzeige und Mannschafts-URLs

Status: angenommen · Betreiberentscheidung 17. November 2026

## Kontext

Die öffentliche PlayerBoard-Seite verwendete bisher einen manuell gepflegten Slug und zeigte Spieler ausschließlich mit Rückennummer und Initialen. Die Adresse sollte Verein, Abteilung und Mannschaft erkennen lassen und ohne manuelle Pflege eindeutig bleiben. Abteilungsleiter sollen die Namensanzeige ihrer Mannschaft anpassen können.

## Entscheidung

- Die Vereinsadresse nutzt weiterhin den Vereins-Slug. Der Mannschafts-Slug wird automatisch aus Abteilungsname und Mannschaftsname gebildet und erhält die vollständige Team-ID als eindeutigen Suffix. Er ist nicht über API oder Oberfläche editierbar. Änderungen der Abteilungs- oder Mannschaftsnamen aktualisieren den generierten Slug.
- Jede Mannschaft kann für alle öffentlichen Spielerlabels eine dieser Formen einstellen:
  - Rückennummer und Initialen, zum Beispiel `#7 M. K.` (Standard)
  - Rückennummer, Vorname und Nachnamensinitiale, zum Beispiel `#7 Max K.`
  - Rückennummer und vollständiger Name, zum Beispiel `#7 Max König`
- Die Einstellung wird in der Datenbank ausgewertet und gilt einheitlich für Rangliste, Trainingsdetails und öffentliche Veo-Werte. IDs, Geburtsjahre, Positionen und E-Mail-Adressen werden weiterhin nicht öffentlich ausgegeben.
- Abteilungsleiter mit `playerboard.manage` dürfen die Anzeige für Mannschaften in ihrer Abteilung konfigurieren. Die bestehenden Freigaben für öffentliche Seiten und die einzelnen Datenbereiche gelten unverändert.

## Folgen

- Eine öffentliche Namensanzeige mit Vorname oder vollständigem Namen ist eine bewusste zusätzliche Offenlegung personenbezogener Daten. Die Betreiber wählen die Einstellung je Mannschaft; die öffentliche Freigabe bleibt zusätzlich durch Verein und Abteilung beschränkbar.
- Bestehende manuell gesetzte Mannschafts-URLs ändern sich bei der Migration zu den generierten Adressen. Bereits geteilte alte Links müssen mit der neuen Adresse ersetzt werden.
- Der Team-ID-Suffix macht auch gleichnamige Mannschaften innerhalb derselben Abteilung eindeutig. Der lesbare Teil bleibt auf je 20 Zeichen pro Abteilungs- und Mannschaftsname begrenzt.
