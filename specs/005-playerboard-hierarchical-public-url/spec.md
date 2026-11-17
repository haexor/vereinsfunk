# Feature Specification: Hierarchische öffentliche PlayerBoard-URLs

**Feature Branch**: `feat/playerboard-hierarchical-public-url`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Öffentliche PlayerBoard-URLs verwenden /mannschaft/<verein>/<abteilung>/<mannschaft>. Der Vereins-Slug, die Abteilungs-Slug und der Mannschafts-Slug sind je ein eigenes lesbares URL-Segment. Der letzte Segment bleibt je Team eindeutig. Freigabe der öffentlichen Namensformate und sonstigen Datenschutzgrenzen bleiben unverändert. Öffentliche Seiten, API-Endpunkte, Middleware, Share-Links, Migrationen, Tests und Doku müssen dem neuen Pfad folgen."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Öffentliche Mannschaftsseite unter dreiteiliger Adresse erreichen (Priority: P1)

Eltern, Fans und Gäste öffnen ohne Anmeldung die Seite einer Mannschaft unter `/mannschaft/<verein>/<abteilung>/<mannschaft>`. Aus der Adresse ist erkennbar, zu welchem Verein, welcher Abteilung und welcher Mannschaft die Seite gehört.

**Why this priority**: Die Adresse ist der Einstiegspunkt aller öffentlichen PlayerBoard-Inhalte. Ohne sie ist weder Seite noch Trainings- oder Veo-Ansicht erreichbar.

**Independent Test**: Eine freigegebene Mannschaft anlegen und ihre dreiteilige Adresse in einem anonymen Browser öffnen; Tabs, Namen, Saison und Vereinsfarben müssen wie bisher erscheinen.

**Acceptance Scenarios**:

1. **Given** eine Mannschaft mit freigegebener öffentlicher Seite, **When** eine nicht angemeldete Person `/mannschaft/<verein>/<abteilung>/<mannschaft>` öffnet, **Then** sieht sie die öffentliche Mannschaftsseite mit denselben Tabs und Inhalten wie bisher.
2. **Given** dieselbe Mannschaft, **When** die Seite über die bisherige zweiteilige Adresse `/mannschaft/<verein>/<mannschaft>` aufgerufen wird, **Then** sind weder Seite noch Daten verfügbar, und die Antwort unterscheidet sich nicht von der einer unbekannten Mannschaft.
3. **Given** eine bekannte Mannschaft, **When** Vereins-, Abteilungs- oder Mannschaftssegment durch ein anderes, nicht dazu passendes Segment ersetzt wird, **Then** sind weder Seite noch Daten verfügbar, und die Antwort unterscheidet sich nicht von der einer unbekannten Mannschaft.
4. **Given** zwei Abteilungen oder Vereine mit gleichnamigen Mannschaften, **When** deren Adressen aufgerufen werden, **Then** liefert jede Adresse ausschließlich die Daten ihrer eigenen Mannschaft.
5. **Given** eine Abteilung hat bereits eine Mannschaft mit demselben normalisierten Namen, **When** eine weitere Mannschaft mit diesem Namen angelegt oder umbenannt wird, **Then** wird die Änderung abgelehnt, bevor ein mehrdeutiger öffentlicher Pfad entsteht.

---

### User Story 2 - Adresse und Share-Links in der Verwaltung verwenden (Priority: P1)

Eine berechtigte Person kopiert in den PlayerBoard-Einstellungen die öffentliche Adresse einer Mannschaft und die Links einzelner Trainings und gibt sie weiter. Alle angezeigten und kopierten Links verwenden den dreiteiligen Pfad.

**Why this priority**: Share-Links sind der Weg, auf dem Gäste die Seite erreichen. Ein Link im alten Format wäre nach der Umstellung nicht nutzbar.

**Independent Test**: In den Einstellungen und der Trainingsübersicht jeden öffentlichen Link kopieren und prüfen, dass er dreiteilig ist und anonym funktioniert.

**Acceptance Scenarios**:

1. **Given** eine Mannschaft mit freigegebener öffentlicher Seite, **When** die Einstellungsseite angezeigt wird, **Then** zeigt sie die dreiteilige Adresse an und kopiert sie unverändert in die Zwischenablage.
2. **Given** ein gespeichertes Training mit freigegebenen öffentlichen Trainings, **When** der Trainings-Share-Link kopiert wird, **Then** enthält er den dreiteiligen Pfad und führt anonym zum Training.
3. **Given** eine Mannschaft ohne generierte Adresse, **When** die Einstellungen angezeigt werden, **Then** wird keine Adresse und kein Kopier-Button angeboten.

---

### User Story 3 - Öffentliche API-Endpunkte und Zugriffsschutz folgen dem neuen Pfad (Priority: P1)

Die anonymen Datenabfragen der öffentlichen Seite (Mannschaftsinfo, Trainingsliste, Trainingsdetail, Veo-Werte, Fotos, Rangliste) lösen die Mannschaft über Verein, Abteilung und Mannschaft auf. Die Anmeldeweiche lässt genau die dreiteilige Seitenadresse ohne Anmeldung durch. Die gültige alte zweiteilige Adresse bleibt ebenfalls ohne Anmeldung erreichbar, liefert aber öffentlich eine 404 ohne Weiterleitung.

**Why this priority**: Die serverseitige Prüfung ist die eigentliche Datenschutzgrenze. Sie darf durch die Umstellung weder aufgeweicht noch umgangen werden.

**Independent Test**: Alle öffentlichen Endpunkte anonym mit gültigem und mit ungültigem Segmentsatz aufrufen; die alte zweiteilige Adresse anonym als 404 ohne Weiterleitung prüfen und alle anderen ungültigen Pfade unter `/mannschaft` ohne Anmeldung aufrufen.

**Acceptance Scenarios**:

1. **Given** eine freigegebene Mannschaft, **When** jeder öffentliche Endpunkt mit den drei Segmenten aufgerufen wird, **Then** liefert er dieselben Daten wie vor der Umstellung.
2. **Given** ein ungültiger Pfad unter `/mannschaft` mit weniger oder mehr als drei Segmenten, einem leeren Segment, Großbuchstaben, abschließendem Schrägstrich oder `..`, **When** er ohne Anmeldung aufgerufen wird, **Then** leitet die Anmeldeweiche zur Anmeldung um. Die Ausnahme ist genau die gültige alte zweiteilige Adresse `/mannschaft/<verein>/<mannschaft>`; sie liefert ohne Anmeldung eine 404 ohne Weiterleitung.
3. **Given** eine Mannschaft, deren öffentliche Seite oder deren Datenbereich auf Vereins-, Abteilungs- oder Mannschaftsebene nicht freigegeben ist, **When** ein öffentlicher Endpunkt mit den drei Segmenten aufgerufen wird, **Then** liefert er keine Nutzdaten und keinen Hinweis auf die Existenz.

---

### User Story 4 - Bestehende Mannschaften auf den neuen Pfad umstellen (Priority: P2)

Bestehende Mannschaften erhalten bei der Migration automatisch ihre dreiteilige Adresse. Neue Mannschaften und Namensänderungen erzeugen sie ohne manuelle Pflege.

**Why this priority**: Ohne Migration hätten Bestandsmannschaften keine funktionierende öffentliche Adresse; die Umstellung ist aber einmalig und nur mit vorhandenen Daten prüfbar.

**Independent Test**: Migration auf einer Datenbank mit Bestandsmannschaften ausführen, danach Mannschaft anlegen und umbenennen und jeweils die Adresse prüfen.

**Acceptance Scenarios**:

1. **Given** Bestandsmannschaften mit freigegebener öffentlicher Seite, **When** die Migration läuft, **Then** erhält jede genau eine dreiteilige Adresse, und die Freigaben, Namensformate und Datenschalter bleiben unverändert.
2. **Given** eine Mannschaft mit einem Namen, dessen normalisierter URL-Slug in derselben Abteilung schon vergeben ist, **When** die Mannschaft angelegt oder umbenannt wird, **Then** wird die Änderung abgelehnt.
3. **Given** eine Mannschaft wird umbenannt, **When** die Adresse neu erzeugt wird, **Then** ist sie unter dem neuen Pfad erreichbar, und alle Seiten und Links der Anwendung verwenden ihn.
4. **Given** eine Mannschaft hat keine öffentliche Freigabe, **When** die Migration läuft, **Then** wird dadurch keine öffentliche Freigabe erzeugt.

---

### Edge Cases

- Ein Segment (Verein, Abteilung oder Mannschaft) besteht nach der Normalisierung nur aus Sonderzeichen oder Umlauten; die Adresse muss trotzdem gültig und lesbar bleiben.
- Zwei Abteilungen eines Vereins oder zwei Vereine besitzen jeweils eine gleichnamige Mannschaft; die Adressen dürfen sich nie überschneiden.
- Zwei Mannschaftsnamen innerhalb derselben Abteilung normalisieren zum selben URL-Slug (zum Beispiel durch Groß-/Kleinschreibung, Leerzeichen, Bindestriche oder Umlaute); diese Namenskollision wird abgelehnt.
- Eine Abteilung wird archiviert oder die Mannschaft archiviert; die Adresse liefert keine Daten mehr.
- Eine Mannschaft wird in eine andere Abteilung verschoben, sofern das System dies erlaubt; die Adresse folgt der neuen Abteilung und die alte liefert keine Daten.
- Alte, bereits geteilte Links im zweiteiligen Format werden nicht weitergeleitet und liefern keine Daten; sie müssen durch die neue Adresse ersetzt werden.
- Segmentlänge: Ein überlanger Segmentwert wird vor jedem Datenzugriff abgelehnt.
- Ein Trainingslink verweist auf ein Training einer anderen Mannschaft als der im Pfad genannten; er liefert keine Daten.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS die öffentliche Mannschaftsseite ausschließlich unter `/mannschaft/<verein>/<abteilung>/<mannschaft>` bereitstellen.
- **FR-002**: Vereins-, Abteilungs- und Mannschaftssegment MÜSSEN je ein eigenes, lesbares Segment im Slug-Format sein (Kleinbuchstaben, Ziffern, einfache Bindestriche) und aus dem jeweiligen Namen bzw. bestehenden Slug abgeleitet werden.
- **FR-003**: Das letzte Segment MUSS ausschließlich aus dem normalisierten Mannschaftsnamen bestehen. Es DARF keinen UUID-, ID- oder Zähler-Präfix beziehungsweise -Suffix enthalten.
- **FR-004**: Die Auflösung einer öffentlichen Adresse MUSS Verein, Abteilung und Mannschaft gemeinsam prüfen; ein Segmentsatz, dessen Segmente nicht zur selben Verein-Abteilung-Mannschaft-Kette gehören, MUSS wie eine unbekannte Mannschaft behandelt werden.
- **FR-005**: Alle öffentlichen API-Endpunkte (Mannschaftsinfo, Trainingsliste, Trainingsdetail, Rangliste, Veo- und Fotoendpunkte) MÜSSEN die Mannschaft über die drei Segmente identifizieren.
- **FR-006**: Die Anmeldeweiche MUSS Pfade mit genau drei nicht leeren Slug-Segmenten unter `/mannschaft` ohne Anmeldung zur öffentlichen Seite durchlassen. Genau zweiteilige Pfade mit gültigen Vereins- und Mannschaftsslugs im bisherigen Format MUSS sie ebenfalls ohne Anmeldung zur 404 ohne Weiterleitung durchlassen; jeder andere ungültige Pfad unter `/mannschaft` MUSS hinter der Anmeldung bleiben.
- **FR-007**: Alle in der Anwendung erzeugten und kopierten öffentlichen Links (Mannschaftsadresse, Trainings-Share-Links) MÜSSEN den dreiteiligen Pfad verwenden.
- **FR-008**: Der bisherige zweiteilige Pfad MUSS keine Daten mehr liefern und DARF keine Weiterleitung auf den neuen Pfad enthalten.
- **FR-009**: Die Migration MUSS für alle Bestandsmannschaften die neue Adresse erzeugen und bestehende Freigaben, Datenschalter und Namensformate unverändert lassen.
- **FR-010**: Die Adresse MUSS bei Namensänderungen von Abteilung (soweit sie in die Adresse einfließt) oder Mannschaft automatisch aktualisiert werden.
- **FR-011**: Die öffentlichen Namensformate (Rückennummer mit Initialen, Vorname mit Nachnamensinitiale, vollständiger Name) und ihre Wirkung auf Rangliste, Trainingsdetails und Veo-Werte MÜSSEN unverändert bleiben.
- **FR-012**: Die bestehenden Freigaben (Modul, öffentliche Mannschaftsseite, Trainings, Punkte, Veo, Fotos) und Datenschutzgrenzen MÜSSEN unverändert gelten; öffentliche Antworten DÜRFEN keine zusätzlichen Felder enthalten, insbesondere keine IDs, Geburtsjahre, Positionen oder E-Mail-Adressen.
- **FR-013**: Geschlossene oder unbekannte Adressen MÜSSEN eine nicht unterscheidbare Nichtverfügbarkeitsantwort liefern, ohne Existenzdetails preiszugeben.
- **FR-014**: Die Segmente MÜSSEN vor jedem Datenzugriff auf Format und Länge geprüft werden.
- **FR-015**: Tests (Datenbank-, API-, Web- und Middleware-Tests) und Dokumentation (ADR-013, Spezifikationsartefakte, Einstellungs-Hinweise) MÜSSEN den neuen Pfad widerspiegeln und positive wie negative Isolationsfälle über Vereins-, Abteilungs- und Mannschaftsgrenzen abdecken.
- **FR-016**: Mannschaftsnamen MÜSSEN innerhalb derselben Abteilung eines Vereins eindeutig sein. Die Eindeutigkeit MUSS nach derselben Normalisierung geprüft werden, aus der das URL-Segment entsteht; eine Kollision MUSS beim Anlegen und Umbenennen abgelehnt werden. Derselbe Name in einer anderen Abteilung oder einem anderen Verein bleibt zulässig.

### Key Entities

- **Öffentliche Mannschaftsadresse**: Die dreiteilige Kennung `<verein>/<abteilung>/<mannschaft>` einer Mannschaft, automatisch erzeugt und nicht manuell editierbar.
- **Vereins-Segment**: Der bestehende Slug des Vereins.
- **Abteilungs-Segment**: Der lesbare Slug der Abteilung innerhalb des Vereins.
- **Mannschafts-Segment**: Der lesbare, je Mannschaft eindeutige letzte Teil der Adresse.
- **Öffentlicher Trainings-Share-Link**: Eine anmeldungsfreie URL auf genau ein gespeichertes Training, aufgebaut auf der dreiteiligen Mannschaftsadresse.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 % der Bestandsmannschaften mit öffentlicher Freigabe ist nach der Migration genau eine dreiteilige Adresse erreichbar.
- **SC-002**: 100 % der in der Anwendung angezeigten und kopierten öffentlichen Links verwenden den dreiteiligen Pfad.
- **SC-003**: In 100 % der negativen Isolationstests (falsche Abteilung, falscher Verein, alter zweiteiliger Pfad, fremdes Training) werden keine Nutzdaten ausgeliefert.
- **SC-004**: In 100 % der Testfälle werden Namens-Slug-Kollisionen innerhalb einer Abteilung vor dem Speichern abgelehnt; derselbe Mannschaftsname in anderen Abteilungen oder Vereinen bleibt zulässig.
- **SC-005**: Die öffentlichen Antwortinhalte sind für Namensformate, Freigaben und Datenfelder identisch zu den Antworten vor der Umstellung.
- **SC-006**: Eine berechtigte Person kann die Mannschaftsadresse mit einem Klick kopieren und in einem anonymen Browser öffnen.

## Assumptions

- Das Vereins-Segment ist der bestehende, eindeutige Vereins-Slug; das Abteilungs-Segment ist der bestehende Abteilungs-Slug, der innerhalb eines Vereins eindeutig ist und bei einer Umbenennung der Abteilung stabil bleibt.
- Der letzte Pfadteil ist der Slug des Mannschaftsnamens ohne UUID-, sonstigen ID- oder Zähler-Präfix beziehungsweise -Suffix. Damit er innerhalb der Abteilung eindeutig ist, werden Teamnamen nach derselben Slug-Normalisierung auf Eindeutigkeit geprüft.
- Alte zweiteilige Links werden nicht weitergeleitet, analog zur Entscheidung in ADR-013, dass geteilte Links bei einer Adressänderung ersetzt werden müssen.
- Der Mannschafts-Slug bleibt nicht manuell editierbar und wird bei Namensänderung neu erzeugt; alte Adressen derselben Mannschaft werden dabei nicht aufbewahrt. Die Abteilung erlaubt keine zwei Teamnamen, die denselben normalisierten Slug ergeben.
- Die Datenmodelle für Freigaben, Namensformate und Datenschalter bleiben bestehen; die Umstellung betrifft Adressbildung, Adressauflösung, Routing, Links, Tests und Dokumentation.
- Die Spezifikation legt keine Implementierungsdetails fest; Entscheidungen zu Datenbank-Funktionen, Routen und Migrationsreihenfolge fallen in die Planungsphase.
