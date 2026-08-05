# 003 – Kreative Gesichtsverdeckung für Bilder

## Ergebnis

Das System lokalisiert Gesichter automatisch, erlaubt manuelle Korrekturen und erzeugt kreative, vollständig deckende Bildvarianten. Fehlende Einwilligungen führen nicht automatisch zur Ablehnung eines guten Vereinsfotos, aber niemals zu einem unverdeckten Publishingpfad.

## Abhängigkeit und Ausgangslage

Plan 002 muss mindestens Schema, private Assets und Gate-Vertrag bereitstellen. Der aktuelle Code besitzt weder Media-Paket noch Detektor/Anonymizer. `202608020002_private_storage.sql` erlaubt private JPG/PNG/WebP-Dateien; `apps/web/app/pages/erstellen.vue:53-58` zeigt nur Uploadhinweis und Minderjährigenwarnung.

Baseline:

```text
2f001e9e7baac3f76d9cbc14d856666a3d068d2a04fd4d53d4e14d6e40f6cf78  supabase/migrations/202608020002_private_storage.sql
28dc50f3bec1cc32a9e8925d82ff67c712ab15632ea28313c380264b5d082194  apps/web/app/pages/erstellen.vue
b2990427ebcb00454cdf90db26c1b3839b126840e2cda5008df4028197177302  apps/worker/src/workflows.ts
```

## Scope

- neues Workspace-Paket `packages/media-processing/`
- Detektor- und Anonymizer-Adapter
- Worker-Aufgaben für Normalisierung, Detektion und Derivate
- API-Endpunkte/Contracts für manuelle Regionen und Renderauftrag
- visueller Face-Review-Editor in Nuxt
- sichere kreative Stile für Bilder
- Tests mit synthetischen bzw. eindeutig lizenzierten Erwachsenen-Fixtures

Nicht enthalten: Personenidentifikation, Face Embeddings, Video-Tracking, generative Veränderung von Personen oder automatische Rechtsfreigabe.

## Verdeckungsstile

MVP-Stile: `club_mascot`, `sports_ball`, `emoji`, `confetti_badge`, `brand_shape`, `scribble`, `pixelate`, `solid_blur`.

Für fehlende Einwilligung sind nur nachweislich opake Stile zulässig. Ein normaler Gauß-Blur ist wegen möglicher Rekonstruktion/Erkennbarkeit nicht Standard; `solid_blur` bedeutet starke Kombination aus Pixelierung, Farbfläche und Deckkraft. Jeder Stil bekommt eine maschinenlesbare Sicherheitsklasse.

## Umsetzung

### 1. Technologie-Spike mit Exit-Kriterien

- Definiere zuerst `FaceDetector` und `ImageAnonymizer`; Providerdetails bleiben hinter Adaptern.
- Prüfe einen lokal ausführbaren, aktiv gepflegten Detector (bevorzugt MediaPipe-kompatibler Runtime) unter Node 22/Linux. Keine Bilder verlassen die eigene Infrastruktur.
- Messe an mindestens 30 lizenzierten Erwachsenenbildern: Einzel-/Gruppenfoto, Profil, Teilverdeckung, dunkle Hauttöne, Brille, Bewegung, große Distanz. Kinderbilder werden für den Techniktest nicht benötigt.
- Exit-Kriterium: Der Detector ist Hilfe, nie alleinige Freigabe. Unabhängig von Recall muss ein Mensch Boxen ergänzen und „keine weiteren Gesichter“ bestätigen können.
- Dokumentiere Version, Modellquelle/Lizenz, CPU/RAM, p95-Laufzeit und bekannte Ausfälle in `docs/evidence/face-detector-spike.md`.

STOP: Modelllizenz, Serverkompatibilität oder Datenschutz ist unklar. Dann MVP mit manuellen Boxen starten und Auto-Erkennung hinter Feature-Flag deaktivieren.

### 2. Deterministisches Media-Paket

Paketgrenzen:

```ts
interface FaceDetector {
  detect(image: Buffer): Promise<Array<{ box: NormalizedBox; confidence: number }>>
}
interface ImageAnonymizer {
  render(input: { image: Buffer; regions: RegionDecision[]; recipeVersion: string }): Promise<{
    bytes: Buffer; mimeType: string; sha256: string
  }>
}
```

- Nutze Sharp oder eine gleichwertige serverseitige Pipeline zur Autorotation, Metadatenentfernung und Komposition.
- Erweitere jede Gesichtsbox konfiguriert (Startwert 20 %) und clippe sie an Bildgrenzen.
- Opake Overlays füllen die erweiterte Fläche vollständig. Mascot-/Ball-Assets erhalten eine deckende Grundform; transparente Details liegen nur darüber.
- Ausgabe ist deterministisch für Originalhash + Regionenrevisionen + Rezeptversion + Stilparameter. Genau dieser Schlüssel wird idempotent gespeichert.
- Bei Fehler bleibt das alte Derivat unverändert; ein teilgerendertes Objekt erhält nie Status `ready`.

Unit-Tests: Randboxen, überlappende Gesichter, sehr kleine Gesichter, Rotation, Transparenz, Rezept-Hash, EXIF-Entfernung und Pixelprobe, die vollständige Opazität in der Sicherheitsmaske beweist.

### 3. Hatchet-fähige Worker-Aufgaben

- Implementiere zunächst unabhängig testbare Handler `normalize-media`, `detect-faces`, `render-obscured-image` und `verify-derivative`.
- Handler laden alle Fachdetails anhand der IDs aus Supabase; Payloads enthalten nur `organizationId`, `departmentId`, `mediaAssetId`, `sourceRevision`, `correlationId`.
- Persistiere automatisch gefundene Regionen als Vorschläge. Ein neuer Detectorlauf darf manuelle Regionen/Entscheidungen nicht überschreiben.
- `verify-derivative` prüft Format, Maße, Hash, vollständige Regionabdeckung und Gate; erst dann Status `ready`.
- Die echte Hatchet-Registrierung folgt der in Plan 004 etablierten Factory.

### 4. Face-Review-Editor

- Canvas/Overlay zeigt nummerierte Boxen; Nutzer können hinzufügen, verschieben, vergrößern und löschen.
- Pro Box: erwachsen/minderjährig/unbekannt und Einwilligung/verdecken/ausschließen. „Unbekannt“ nimmt den strengeren Pfad.
- Live-Vorschau für Stile, aber die Freigabe referenziert nur das serverseitig erzeugte Derivat.
- Zeige einen deutlichen Rest-Risiko-Hinweis: Gesicht verdeckt; Kleidung, Ort oder Situation können erkennbar bleiben.
- Mobile Bedienung, Zoom, Tastatur und Screenreader-Alternative testen. Nie ungeprüft automatisch „alle Gesichter erkannt“ anzeigen.

### 5. Kreativassets und Markenbezug

- Liefere neutrale, lizenzierte SVG-Grundassets im Paket; Vereinslogo/Maskottchen wird aus privaten Brand Assets geladen.
- Kein Drittanbieter-Emoji- oder Stickerpaket ohne dokumentierte kommerzielle Lizenz.
- Halte Farbkontrast und respektvolle Darstellung ein; bei Kinderangeboten keine beschämenden oder irreführenden Sticker-Voreinstellungen.

## Verifikation

```bash
pnpm --filter @vereinsfunk/media-processing test
pnpm --filter @vereinsfunk/worker test
pnpm --filter @vereinsfunk/api test
pnpm --filter @vereinsfunk/web test
pnpm check
```

Manuelle Abnahme mit mindestens: Einzelportrait, 12-Personen-Gruppe, Randgesicht, manuell ergänztes Gesicht, consented + obscure gemischt, Bild mit als minderjährig markierter Person. Prüfe das fertige heruntergeladene Derivat, nicht nur die Browservorschau.

## Done-Kriterien

- Automatische Vorschläge und manuelle Boxen koexistieren verlustfrei.
- Alle acht Stile erzeugen serverseitige, private, hashgebundene Derivate.
- Sicherheitsboxen sind vollständig opak abgedeckt; Standard ist nicht bloß leichter Blur.
- Kein offenes/unknown Gesicht kann das Mediengate passieren.
- Originale werden nie verändert oder veröffentlicht; EXIF/GPS fehlen im Derivat.
- Detector-Lizenz, Grenzen und Benchmarks sind dokumentiert.

## STOP-Bedingungen

- Kein Mensch bestätigt die Vollständigkeit der Gesichtsregionen: Publishing bleibt blockiert.
- Die kreative Grafik deckt nicht die komplette erweiterte Box: Stil nicht freischalten.
- Der Anonymizer benötigt einen externen Bilddienst: vor Nutzung gesonderte Datenschutz-/AVV-Entscheidung einholen.

## Pflegehinweis

Detector und Transformationsrezepte nur versioniert aktualisieren. Quartalsweise Fehlerraten aus manuellen Ergänzungen auswerten; keine alten freigegebenen Bilder automatisch mit neuem Modell überschreiben.
