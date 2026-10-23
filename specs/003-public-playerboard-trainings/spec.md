# Feature Specification: Öffentliche Trainings und anonymisierte Veo-Statistiken

**Feature Branch**: `feat/training-public-link-copy`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Jede Mannschaft soll ihre Trainings und Veo-Statistiken öffentlich anzeigen lassen können. Das soll konfigurierbar sein. Wenn Trainings und Veo-Statistiken öffentlich sind, dürfen keine personenbezogenen Daten sichtbar sein; es dürfen ausschließlich Initialen und Trikotnummern erscheinen, niemals Klarnamen. Auf der Trainingsübersichtsseite soll je Training ein Button den öffentlichen Link in die Zwischenablage kopieren."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Öffentliche Inhalte je Mannschaft konfigurieren (Priority: P1)

Eine berechtigte Person möchte für eine Mannschaft unabhängig konfigurieren, ob Trainingsdaten und Veo-Statistiken öffentlich erscheinen. Deaktivierte Inhalte dürfen auch dann nicht über einen direkten öffentlichen Link erreichbar sein.

**Why this priority**: Die Mannschaft entscheidet selbst, welche Daten sie mit Eltern, Fans und Gästen teilt.

**Independent Test**: Zwei Mannschaften mit unterschiedlichen Einstellungen anlegen und die öffentlichen Endpunkte jeweils ohne Anmeldung aufrufen.

**Acceptance Scenarios**:

1. **Given** öffentliche Trainings sind für Mannschaft A aktiviert und die öffentliche Mannschaftsseite ist freigegeben, **When** eine nicht angemeldete Person die Seite öffnet, **Then** ist der Trainingsbereich sichtbar.
2. **Given** öffentliche Trainings sind für Mannschaft B deaktiviert, **When** eine nicht angemeldete Person einen Trainingslink von B aufruft, **Then** erhält sie keine Trainingsdaten und keinen Hinweis, der den Inhalt preisgibt.
3. **Given** öffentliche Veo-Statistiken sind deaktiviert, **When** die öffentliche Seite geladen wird, **Then** wird kein Veo-Bereich angeboten und der direkte Veo-Endpunkt liefert keine Daten.

### User Story 2 - Training öffentlich und anonymisiert teilen (Priority: P1)

Eine Trainerin möchte aus der Trainingsübersicht den öffentlichen Link eines abgeschlossenen Trainings kopieren und an die Mannschaft weitergeben. Gäste sollen das Training ohne Anmeldung ansehen können.

**Why this priority**: Der konkrete Trainingslink ist der eigentliche Anwendungsfall für das Teilen eines Trainings.

**Independent Test**: Ein gespeichertes Training mit Punkten öffnen, den Link aus der Übersicht kopieren und ihn in einem anonymen Browser aufrufen.

**Acceptance Scenarios**:

1. **Given** ein gespeichertes Training und aktivierte öffentliche Trainings, **When** die Trainerin den Kopier-Button betätigt, **Then** landet der öffentliche Trainingslink in der Zwischenablage und zeigt eine erfolgreiche Rückmeldung.
2. **Given** ein Entwurf oder deaktivierte öffentliche Trainings, **When** die Übersicht angezeigt wird, **Then** ist kein nutzbarer öffentlicher Trainingslink verfügbar.
3. **Given** ein öffentliches Training mit mehreren Punktzeilen, **When** ein Gast es öffnet, **Then** sieht er Datum, Kategorien, Punktwerte sowie je Spieler ausschließlich eine Darstellung aus Trikotnummer und Initialen.
4. **Given** ein öffentliches Training, **When** ein Gast die Antwort oder die Seite untersucht, **Then** enthält sie keine Spieler-ID, Verzeichnis-ID, E-Mail-Adresse, Geburtsdaten, Profil-URL oder Klarname.

### User Story 3 - Veo-Statistiken anonymisiert veröffentlichen (Priority: P1)

Eine Mannschaft möchte ihre Veo-Spiele und Kennzahlen öffentlich zeigen, ohne einzelne Spieler namentlich zu identifizieren.

**Why this priority**: Veo-Daten sind besonders sensibel, weil sie detaillierte Leistungswerte enthalten.

**Independent Test**: Veo-Statistiken für eine Mannschaft aktivieren und die öffentliche Antwort auf technische und personenbezogene Felder prüfen.

**Acceptance Scenarios**:

1. **Given** öffentliche Veo-Statistiken sind aktiviert, **When** ein Gast den Veo-Bereich öffnet, **Then** sieht er Mannschaftswerte und Spielerwerte nur mit Trikotnummer und Initialen.
2. **Given** eine Veo-Zuordnung ohne Spieler, **When** sie öffentlich erscheint, **Then** wird höchstens die Trikotnummer ohne Initialen gezeigt.
3. **Given** öffentliche Veo-Statistiken sind deaktiviert, **When** ein Gast den bekannten Veo-Endpunkt direkt aufruft, **Then** werden keine Daten ausgeliefert.

### Edge Cases

- Ein gespeichertes Training besitzt keine Punkte; der öffentliche Trainingslink zeigt das Datum sowie eine verständliche Leermeldung.
- Ein Training wird nach dem Kopieren wieder zum Entwurf; der zuvor kopierte Link liefert keine Trainingsdaten mehr.
- Eine Mannschaft hat keine öffentliche Mannschaftsseite oder die Freigabe wird auf einer übergeordneten Ebene entzogen; sämtliche öffentlichen Trainings- und Veo-Aufrufe bleiben geschlossen.
- Ein Spieler hat keine Trikotnummer; öffentlich erscheint nur die anonymisierte Initialendarstellung ohne erfundene Nummer.
- Gleiche Initialen werden nicht durch zusätzliche personenbezogene Angaben aufgelöst.
- Clipboard-Zugriff ist im Browser nicht verfügbar oder wird abgelehnt; die Seite zeigt eine verständliche Fehlermeldung, ohne den Link zu verlieren.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS öffentliche Trainings je Mannschaft separat von öffentlichen Veo-Statistiken aktivierbar und deaktivierbar machen.
- **FR-002**: Öffentliche Trainings und öffentliche Veo-Statistiken MÜSSEN zusätzlich von der bestehenden öffentlichen Mannschaftsfreigabe und Modulfreigabe abhängen.
- **FR-003**: Das System MUSS auf der internen Trainingsübersicht für jedes gespeicherte Training mit verfügbarer öffentlicher Freigabe einen Button zum Kopieren seines öffentlichen Links anbieten.
- **FR-004**: Entwürfe und deaktivierte öffentliche Inhalte DÜRFEN keinen öffentlich nutzbaren Trainingslink ausliefern.
- **FR-005**: Ein öffentlicher Trainingslink MUSS ohne Anmeldung Datum, Kategorien und Punktwerte des gespeicherten Trainings anzeigen können; freie Titel und Notizen bleiben vollständig intern.
- **FR-006**: Öffentliche Trainings- und Veo-Antworten DÜRFEN ausschließlich eine anonymisierte Spielerbezeichnung aus Initialen und, sofern vorhanden, Trikotnummer enthalten.
- **FR-007**: Öffentliche Trainings- und Veo-Antworten DÜRFEN keine Klarname, Spieler-ID, Verzeichnis-ID, Profil-ID, E-Mail-Adresse, Geburtsdaten, Positionsdaten oder internen Links enthalten.
- **FR-008**: Nicht zugeordnete Veo-Spieler DÜRFEN öffentlich nur über ihre Trikotnummer erscheinen.
- **FR-009**: Jede direkte öffentliche Anfrage MUSS Mannschaft, Freigaben, gespeicherten Status und Teamzugehörigkeit des Trainings serverseitig prüfen.
- **FR-010**: Das System MUSS bei erfolgreichem Kopieren eine sichtbare Rückmeldung geben und bei verweigertem Clipboard-Zugriff eine verständliche Fehlermeldung anzeigen.
- **FR-011**: Änderungen an den öffentlichen Einstellungen MÜSSEN ohne Veröffentlichung einer neuen Trainingsversion wirksam werden.
- **FR-012**: Die öffentlichen Endpunkte MÜSSEN bei geschlossenen Inhalten eine nicht unterscheidbare Nichtverfügbarkeitsantwort verwenden, ohne interne Daten oder Existenzdetails preiszugeben.

### Key Entities

- **Mannschaftsfreigaben**: Konfigurierbare öffentliche Schalter für Trainings und Veo-Statistiken neben der bestehenden öffentlichen Mannschaftsfreigabe.
- **Öffentliches Training**: Ein gespeichertes Training mit Datum, Kategorien und anonymisierten Punktzeilen; freie Titel und Notizen werden nicht veröffentlicht.
- **Anonymisierte Spielerbezeichnung**: Eine ausschließlich aus Trikotnummer und Initialen gebildete Darstellung ohne Personen- oder Kontokennung.
- **Öffentlicher Trainingslink**: Eine anmeldungsfreie, auf genau ein gespeichertes Training bezogene URL.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Eine berechtigte Person kann die öffentlichen Trainings- und Veo-Schalter einer Mannschaft in höchstens 30 Sekunden ändern und die Wirkung ohne erneute Anmeldung prüfen.
- **SC-002**: In 100 % der anonymen Trainings- und Veo-Antworten der Sicherheitstests erscheinen keine Klar-, Konto- oder Verzeichnisdaten.
- **SC-003**: Ein Trainer kann den öffentlichen Trainingslink aus der Übersicht mit einem Klick kopieren; die Rückmeldung erscheint innerhalb von 1 Sekunde nach erfolgreichem Clipboard-Zugriff.
- **SC-004**: Direkte Aufrufe geschlossener Trainings- und Veo-Inhalte liefern in 100 % der negativen Isolationstests keine Nutzdaten.
- **SC-005**: Öffentliche Darstellungen zeigen bei zugeordneten Spielern immer Initialen und Trikotnummer, bei nicht zugeordneten Veo-Spielern höchstens die Trikotnummer.

## Assumptions

- Die bestehende öffentliche Mannschaftsseite und ihr öffentlicher Slug bleiben die Basis für öffentliche Links.
- Öffentliche Trainings zeigen keine Trainingsnotizen; diese bleiben intern.
- Das bestehende Veo-Modell und seine bereits anonymisierte öffentliche Ausgabe werden erweitert bzw. abgesichert, nicht durch einen zweiten Personenabgleich ersetzt.
- Öffentliche Trainings enthalten nur gespeicherte Trainings; ein öffentlich gemachter Link wird bei späterem Zurücksetzen auf Entwurf ungültig.
- Spieler ohne Trikotnummer werden nicht durch weitere Merkmale unterscheidbar gemacht.
