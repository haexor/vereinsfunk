# ADR-005: Flexible Inhalte und belegte Aussagen

Status: angenommen · 3. August 2026

Anlass (`preset_slug`), Kommunikationsziel und Ausgabeformate werden unabhängig gespeichert. Presets sind Registry-Daten und kein Datenbank-Enum; gespeicherte unbekannte Slugs bleiben lesbar.

Ein `GroundedContentBrief` enthält ausschließlich bestätigte Fakten, Beobachtungen und explizit freigegebene Zitate. Jede generierte Aussage und jede Plattformvariante referenziert Source-IDs aus diesem Brief. Fehlende Pflichtangaben werden als offen ausgegeben; sie dürfen nicht durch plausible Ausschmückung ersetzt werden.
