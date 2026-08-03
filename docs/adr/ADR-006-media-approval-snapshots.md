# ADR-006: Medienentscheidungen und Freigabe-Snapshots

Status: angenommen · 3. August 2026

Originale, normalisierte Dateien und veröffentlichbare Derivate sind getrennte private Objekte. Es werden keine Gesichtsembeddings oder Identitätsabgleiche gespeichert. Gesichtslokalisierung liefert nur Regionen; jede Region benötigt eine explizite Entscheidung.

Freigaben referenzieren eine konkrete Post-Version und eine geordnete Liste von Derivat-IDs samt SHA-256. Fertige Derivate sind unveränderlich. Änderungen an Derivaten oder Medienzuordnungen invalidieren abhängige Freigaben. Minderjährige benötigen auch nach Verdeckung eine explizite zusätzliche Prüfung.
