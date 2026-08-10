# ADR-010: Beschreibbare Stilprofile und versionierte Textgenerierung

Status: angenommen · 10. August 2026

Die Textwerkstatt generiert ausschließlich Text. Fotos und Videos bleiben private Anhänge
und werden weder an ein LLM übertragen noch von ihm ausgewertet. Es gibt keine Video- oder
Bildgenerierung, keinen Videoschnitt, keine Gesichtserkennung und kein Face-Tracking.

Stilprofile bestehen aus überprüfbaren redaktionellen Eigenschaften (Satzlänge, Energie,
Humor, Formalität, Perspektive, verbotene Formulierungen und begrenzte Zusatzhinweise).
Sie dürfen keine Person imitieren, keine Namen als Nachahmungsziel führen und keinen freien
Systemprompt enthalten. Die fünf kuratierten Systemprofile bleiben versionierte Registry-Daten;
Vereine speichern ausschließlich eigene, tenant-scoped Profile.

Die Prompt-Reihenfolge ist fest: Faktenbindung/Sicherheits- und Plattformgrenzen,
Stilprofil, bestätigte Fakten und schließlich eine begrenzte Änderungsanweisung. Stilprofil
und Änderungsanweisung sind Daten niedriger Priorität. Jede akzeptierte KI-Version erhält
einen unveränderlichen Provenienzdatensatz mit Stil-Snapshot, Prompt-Template-Version,
Provider-Modell und -Konfigurations-ID sowie Eingabehash. Der Datensatz enthält keinen
Rohprompt, kein Secret, keine Medienbytes und keine Gedankenkette.

LLM-Aufrufe erfolgen ausschließlich über die transaktionale Outbox und den ID-only Worker.
Generierungskandidaten bleiben von `post_versions` getrennt; erst eine explizite Übernahme
erzeugt eine neue unveränderliche Version.
