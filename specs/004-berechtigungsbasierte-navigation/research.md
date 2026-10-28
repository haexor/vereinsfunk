# Research: Berechtigungsbasierte Navigation

## Entscheidung

Jeder Sidebar-Link in Rahmen-, Social-Media- und PlayerBoard-Gruppen erhält die Berechtigungen, die für die jeweilige Seite erforderlich sind. Modulgruppen bleiben nur sichtbar, wenn das Modul für die Person und mindestens eine ihrer Ankerebenen freigeschaltet ist; Links innerhalb der Gruppen werden zusätzlich nach ihren Seitenberechtigungen gefiltert. Seiten, die direkt den aktiven Vereins- oder Abteilungsscope verwenden, verlangen das Recht genau dort; Bereiche mit eigener Scope-Auswahl dürfen Rechte in ihren verwaltbaren Scopes berücksichtigen.

Der Link `Mitglieder` erhält ausschließlich `organization.manage`, weil die Seite vereinsweite Mitglieder und Einladungen lädt. Einladungs- oder Entfernungsrechte nur auf Abteilungs- oder Teamebene reichen dafür nicht. Social-Media-Links wie Freigaben, Auswertung, Kanäle, Bildstil und Textwerkstatt werden jeweils an `post.approve`, `analytics.view`, `social_account.manage`, `brand.manage` beziehungsweise `post.create` gebunden. PlayerBoard-Leseansichten erfordern `training.view`; Verwaltungsseiten erfordern `playerboard.manage`.

## Begründung

Die Seitenregistry enthält bereits Berechtigungsfelder, und die Shell filtert Einträge anhand dieser Felder. Bisher fehlten diese Angaben bei mehreren Social-Media- und PlayerBoard-Seiten, sodass nach Freischaltung eines Moduls alle Links der Gruppe erschienen. Die vorhandenen Permission- und Moduleinträge sind die passende Quelle. `canUseAtActiveScope` prüft bereits Permission und Modulzustand am aktiven Scope; es wird für die betreffenden Links wiederverwendet. Für Seiten mit eigener Scope-Auswahl bleibt die vorhandene Any-Scope-Prüfung. Es gibt keine neue Berechtigung und keine Änderung der API-/RLS-Sicherheit.

## Betrachtete Alternativen

- Nur den Mitglieder-Link korrigieren: behebt den gemeldeten Einzelfall, lässt aber unberechtigte Links in anderen Modulen sichtbar.
- Neue Autorisierungsabstraktion einführen: unnötig, weil die Sidebar vorhandene Permission-Metadaten bereits auswertet.
- API-/RLS-Verhalten verändern: nicht Teil dieser UX-Änderung und würde Sicherheitsgrenzen unnötig ausweiten.
