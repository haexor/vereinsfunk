# Feature Specification: Berechtigungsbasierte Navigation

**Feature Branch**: `fix/hide-unauthorized-navigation`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: Vereinsmitglieder sollen keine Links zu Bereichen sehen, für die ihre Berechtigungen nicht ausreichen. Dazu zählen insbesondere die vereinsweite Mitgliederseite, Social-Media-Funktionen und Verwaltungsseiten innerhalb aktivierter Module.

## User Scenarios & Testing

### User Story 1 - Nicht verfügbare Verwaltungsbereiche ausblenden (Priority: P1)

Als Vereinsmitglied möchte ich in der Navigation ausschließlich Seiten sehen, für die meine Rollen im aktiven Verein oder Bereich die benötigten Berechtigungen mitbringen, damit ich nicht auf Seiten ohne Zugriffsmöglichkeit geleitet werde.

**Why this priority**: Mehrere Navigationsbereiche zeigen Links zu Seiten, deren konkrete Berechtigung der Person fehlt. Beispielsweise darf ein Team- oder Abteilungsrecht für Mitgliederaktionen keinen Zugang zur vereinsweiten Mitgliederseite vortäuschen. Auch Social-Media- und PlayerBoard-Links müssen an die jeweilige Seitenberechtigung gebunden sein.

**Independent Test**: Die Navigationslinks für Rollen mit unterschiedlichen Berechtigungen prüfen: nicht berechtigte Seiten fehlen, erlaubte Seiten bleiben sichtbar und leere Gruppen erscheinen nicht.

**Acceptance Scenarios**:

1. **Given** eine Person hat Mitgliederrechte nur in einer Abteilung oder einem Team, **When** sie die Navigation öffnet, **Then** erscheint kein Link zur vereinsweiten Mitgliederseite.
2. **Given** eine Person hat keine Berechtigung für Social-Media-Funktionen, **When** sie die Navigation öffnet, **Then** erscheinen keine Links der Social-Media-Bereiche.
3. **Given** eine Person hat Zugriff auf einen Bereich eines Moduls, aber nicht auf eine bestimmte Verwaltungsseite darin, **When** sie die Navigation öffnet, **Then** erscheint der nicht erlaubte Link nicht.
4. **Given** eine Person besitzt die erforderliche Berechtigung für eine Seite, **When** sie die Navigation öffnet, **Then** erscheint der zugehörige Link.
5. **Given** eine Person ist zugleich Abteilungs- und Teamleitung, aber hat keine Vereinsrolle, **When** sie die Navigation öffnet, **Then** erscheint kein Link zur vereinsweiten Mitgliederseite.
6. **Given** ein Bereich enthält keine für die Person erreichbaren Seiten, **When** die Navigation gerendert wird, **Then** erscheint weder die leere Gruppe noch deren Überschrift.

### Edge Cases

- Eine Person besitzt Rollen auf mehreren Ebenen: Der Link wird nur gezeigt, wenn die Berechtigung für den tatsächlichen Umfang der Seite ausreicht.
- Ein Mitglied hat keine Verwaltungsrechte: Es sieht keinen Verwaltungslink zur Mitgliederseite.
- Ein Berechtigter wechselt in einen anderen Verein: Die Navigation folgt den Rechten des aktuell gewählten Vereins.

## Requirements

### Functional Requirements

- **FR-001**: Jeder geschützte Navigationslink MUST anhand der Berechtigungen angezeigt werden, die für die verlinkte Seite und deren Nutzungsumfang erforderlich sind.
- **FR-002**: Die Navigation MUST Links für Module oder Seiten ausblenden, für die die Person im aktiven Verein oder Bereich keine erforderliche Berechtigung besitzt.
- **FR-003**: Die Navigation MUST den Link zur vereinsweiten Mitgliederverwaltung für Personen ohne vereinsweite Mitgliederberechtigung ausblenden, auch wenn diese Personen Mitgliederrechte in einer Abteilung oder einem Team besitzen.
- **FR-004**: Die Navigation MUST Seitenlinks für Personen mit ausreichender Berechtigung weiterhin anzeigen.
- **FR-005**: Die Anwendung MUST ihre serverseitigen Berechtigungsprüfungen unabhängig von der Sichtbarkeit der Navigation beibehalten.

### Key Entities

- **Berechtigung**: Ein auf Vereins-, Abteilungs- oder Teamebene gewährtes Recht, das den Zugriff auf Funktionen begrenzt.
- **Navigationslink**: Ein Zugang zu einer Seite, deren erforderlicher Berechtigungsumfang bestimmt, ob sie angezeigt wird.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In allen geprüften Rollenfällen sehen Personen keine geschützten Links ohne die dafür nötige Berechtigung, einschließlich Social-Media- und PlayerBoard-Seiten.
- **SC-002**: In allen geprüften Rollenfällen sehen berechtigte Vereinsadministratoren den Mitglieder-Link weiterhin.
- **SC-003**: Nutzer ohne Seitenberechtigung erreichen über die sichtbare Navigation keine Seite, die wegen genau dieser fehlenden Berechtigung einen Ladefehler zeigt.

## Assumptions

- Die Mitgliederseite ist in diesem Änderungsschritt eine vereinsweite Verwaltungsseite, da sie Mitglieder und Einladungen des Vereins lädt.
- Das Ausblenden eines Links ist eine Bedienungshilfe und ersetzt keine serverseitigen oder datenbankseitigen Zugriffskontrollen.
- Die Vereinsübersicht und der Kalender bleiben als für Vereinsmitglieder allgemein verfügbare Seiten sichtbar; die vorhandenen API- und RLS-Prüfungen bleiben maßgeblich.
