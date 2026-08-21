# Paket 049: KI-gestützte Markenerkennung auf Abteilungsebene

## Ausgangslage

Paket 048 hat die Homepage-Analyse ("Automatisch aus der Homepage übernehmen" auf `/marke`)
bewusst auf die Vereinsebene beschränkt. Abteilungen haben aber schon seit Paket 013 ihr eigenes
Branding (`department_brand_profiles`: Primär-/Akzentfarbe, Logo, Schriftpaar) und können — genau
wie der Verein — eine eigene Website haben. Dieses Paket öffnet dieselbe Analyse für Abteilungen.

Bewusst außerhalb des Umfangs: Mannschaften (Teams). Nur Abteilungen wurden angefragt; ein
späteres Folgepaket kann das bei Bedarf ergänzen.

Bewusst keine Schema-Erweiterung für Hintergrund-/Text-/Auf-Primär-Farbe auf Abteilungsebene:
`packages/domain/src/brand.ts` legt offen, dass das eine bestehende, explizite Designentscheidung
ist ("bewusst Vereinssache"), keine Lücke — diese drei Farben fließen ohnehin nicht in die echte
Bildgenerierung ein (`apps/api/src/routes/imageStyle.ts` nutzt nur primary/accent), sondern sind
nur ein Vorschau-/Kontrast-Hinweis auf `/marke` selbst. Der KI-Vorschlag für eine Abteilung
übernimmt deshalb nur `primaryColor`, `accentColor`, Font-Paar-Hinweis (nicht anwendbar, siehe
unten) und Logo — exakt die Felder, die eine Abteilung heute schon manuell setzen kann.

## Umsetzung

**Datenmodell** (`supabase/migrations/2026082102_brand_website_analysis_department_scope.sql`):
`brand_website_analysis_jobs` bekommt eine nullable `department_id`-Spalte; der bisherige
`unique(organization_id)` wird durch zwei partielle Unique-Indizes ersetzt (`... where department_id
is null` für den Vereinsfall, `... where department_id is not null` für Abteilungen). Die RPC
`start_brand_website_analysis` bekommt einen neuen, ans Ende angehängten Parameter
`p_department_id uuid default null` (Postgres behandelt eine zusätzliche Parameterzahl als eigenen
Overload — die alte 3-Parameter-Fassung wird deshalb explizit gedroppt). Neue Prüfung: die
übergebene Abteilung muss tatsächlich zur übergebenen Organisation gehören (Muster: FK-Referenz
braucht Scope-Prüfung). Der Advisory-Lock-Schlüssel schließt die Abteilung ein, damit ein
laufender Vereins-Job eine parallele Abteilungs-Analyse nicht blockiert. Die
Select-Policy prüft bei einer Abteilungs-Zeile `authz.has_department_permission(department_id,
'brand.manage')` statt der vereinsweiten Berechtigung.

**API** (`apps/api/src/routes/brand.ts`): zwei neue Routen `POST`/`GET
/v1/departments/:id/brand/website-analysis`, gespiegelt an den bestehenden Vereins-Routen. Die
gemeinsame Ergebnis-Abbildung (Signed-URL-Minting für den Logo-Kandidaten) wurde in
`mapBrandWebsiteAnalysisRow()` extrahiert, um sie nicht zweimal zu pflegen. Die bestehende
Vereins-GET-Route filtert jetzt zusätzlich `is('department_id', null)` — ohne diese Ergänzung
hätte `maybeSingle()` gescheitert, sobald eine Abteilung ihren eigenen Job bekommt.

**Worker**: keine Änderung nötig. `loadJob`/`markRunning`/`markSucceeded`/`markFailed` arbeiten
über die Job-`id`, nicht über `department_id` — der Worker ist von der Abteilungs-Unterscheidung
vollständig entkoppelt.

**Frontend** (`apps/web/app/pages/marke.vue`, `useBrandWebsiteAnalysis.ts`): Die Karte erscheint
jetzt auch auf Abteilungsebene. `useBrandWebsiteAnalysis` nimmt statt einer festen
`organizationId` einen `scope`-Computed (`{ organizationId, departmentId }`) und leitet daraus den
Endpunkt-Pfad ab; ein interner Watcher setzt Status/Ergebnis zurück und ruft
`resumeRunningAnalysis()` neu auf, sobald sich der Scope ändert (Verein↔Abteilung, oder zwischen
zwei Abteilungen), mit derselben Fencing-Generation wie beim bestehenden Unmount-Fall. Das
URL-Feld selbst ist zwei getrennte Refs (`orgWebsiteUrl`/`departmentWebsiteUrl`) hinter einem
schreibbaren Computed statt eines einzelnen Werts — eine Abteilung hat keine gespeicherte Adresse
zum Vorbelegen und startet deshalb bei jedem Betreten leer, während der Verein seinen
Impressum-Vorschlag oder eine eigene Eingabe über Ebenenwechsel hinweg behält. Aus demselben Grund
setzt ein eigener `scopeKey`-Watcher das "Vorschlag übernommen"-Flag bei *jedem* Scope-Wechsel
zurück, nicht nur beim Betreten einer Abteilung — sonst zeigte ein Rückwechsel zum Verein den
Hinweis der zuletzt betrachteten Abteilung weiter an (echter Fund während der Browser-Verifikation
unten, vor dem Merge behoben).

Logo-Übernahme auf Abteilungsebene läuft anders als beim Verein: der Verein merkt die Logo-Datei
nur vor und lädt sie erst bei "Änderungen speichern" hoch (`saveOrgLogoIfSelected`). Eine Abteilung
hat diesen Staging-Mechanismus nicht — ihr Logo läuft ausschließlich über die geteilte
Asset-Bibliothek (`POST /v1/brand/assets` + `logoAssetId`-Zuweisung, wie beim manuellen "als
Logo"-Button). Der heruntergeladene KI-Kandidat wird deshalb sofort als neues Asset hochgeladen;
die eigentliche Übernahme (Persistenz der Override-Zeile) bleibt trotzdem an "Änderungen
speichern" gebunden. Ein voller `loadAll()`/`reload()` nach diesem Upload hätte die im selben
Funktionsaufruf gerade gesetzten, noch ungespeicherten Farb-Overrides sofort wieder verworfen
(`loadAll()` ersetzt `departmentOverrides` komplett durch den DB-Stand) — die neue Asset-Zeile wird
deshalb lokal an `assets` angehängt statt per Reload nachgeladen.

## Verifikation

- pgTAP-Äquivalent per direktem RPC-Test gegen die lokale Dev-DB: Vereins-Lauf und
  Abteilungs-Lauf unabhängig, Kreuzzugriff auf eine fremde Abteilung abgewiesen
  (`department_not_in_organization`), zwei verschiedene Abteilungen blockieren sich nicht
  gegenseitig, dieselbe Abteilung zweimal gleichzeitig scheitert an `analysis_in_progress`.
- `apps/api/src/brand.routes.test.ts`: 6 neue Tests für die beiden Abteilungs-Routen (Berechtigung,
  404, RPC-Parameter, `analysis_in_progress`-Mapping, Filterung nach `department_id`).
- `apps/web/app/composables/useBrandWebsiteAnalysis.test.ts`: 3 neue Tests (Abteilungs-Endpunkt,
  abteilungsspezifische Fehlermeldung, Poll-Stop/Resume bei Scope-Wechsel inkl. Fencing).
- `pnpm typecheck` in `apps/api`, `apps/web`, `apps/worker` grün; alle bestehenden Testsuiten
  weiterhin grün (504 API-, 48 Web-, 50 Worker-Tests).
- Echter Playwright-Lauf gegen den lokalen Stack (`lena@example.local`, `/marke`, Abteilung
  „Fußball" von „SV Nordstadt 1921"): Karte erscheint auf Abteilungsebene mit abteilungsspezifischem
  Text, Analyse gestartet, Erfolgspfad über einen während des laufenden Polls manuell auf
  `succeeded` gesetzten DB-Datensatz verifiziert — Primär-/Akzentfarbe wurden korrekt in die
  Abteilungsfelder übernommen, die Vereinsfarben blieben beim Zurückwechseln unverändert (kein
  Cross-Talk), ein Reload ohne Speichern verwarf die Übernahme wieder. Demo-Datenbank danach
  zurückgesetzt (geteilte lokale Instanz).
