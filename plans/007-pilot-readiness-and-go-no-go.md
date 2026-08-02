# 007 – Pilotbetrieb, Messung und Go/No-Go

## Ergebnis

Vereinswerk läuft mit ein bis zwei Abteilungen sicher im echten Alltag. Das Team misst, ob die Content-Werkstatt regelmäßig genutzt wird, Zeit spart und genügend Zahlungsbereitschaft erzeugt. Erst diese Evidenz entscheidet über Ausbau, externe Publishingplattform oder Stopp.

## Abhängigkeiten

Pläne 001–006 sind mit ihren MVP-Done-Kriterien abgeschlossen. Für den Pilot bleiben alle Veröffentlichungen menschlich freigabepflichtig. Instagram und Facebook sind die einzigen automatisierten Netzwerke; nicht bestätigte Formate werden exportiert.

## Scope

- Produkt-/Kundenvalidierung mit 5–10 Vereinen
- ein bis zwei operative Pilotabteilungen
- sichere Produktionsumgebung, Migration/Backup/Restore und Runbooks
- Onboarding, Rollen, Brand-Profil, Einwilligungsprozess und Support
- Produkt-, Sicherheits-, Workflow- und Publishingmetriken
- vierwöchiger Pilot mit wöchentlicher Review
- dokumentierte Go/No-Go-/Pivot-Entscheidung

Nicht enthalten: Self-Service-Billing, breiter Public Launch, weitere Netzwerke, unbeaufsichtigtes Publishing, Video-Face-Tracking oder Enterprise-Funktionen.

## Umsetzung

### 1. Kommerzielle Vorvalidierung

- Führe 5–10 strukturierte Gespräche mit unterschiedlichen Vereinen/Abteilungen, darunter Kinderangebot/Ballschule, klassischer Spielbetrieb und nicht sportlicher Vereinsalltag.
- Lass reale bisherige Workflows zeigen: Wer liefert Material? Wer formuliert? Wer darf Personen freigeben? Wo scheitert Regelmäßigkeit? Welche Tools/Kosten existieren?
- Bitte nicht nur um Gefallen, sondern um konkrete Pilotzusage mit Preisrahmen. Gate: mindestens zwei unterschriebene oder bezahlte Pilotzusagen mit benannter verantwortlicher Person und wöchentlichem Nutzungsszenario.
- Dokumentiere anonymisiert in `docs/research/pilot-discovery.md`; personenbezogene Gesprächsnotizen nicht ins Repo.

STOP: Keine zwei belastbaren Zusagen nach 10 passenden Gesprächen. Dann nicht Infrastruktur skalieren; Problem, Zielgruppe oder Angebot neu schneiden.

### 2. Produktions-Readiness

- Trenne dev/staging/prod für Supabase, Hatchet, Meta-App und Secrets. Keine echten Vereinsmedien in dev.
- CI führt Lint, Typecheck, Unit, Build und migrationsbezogene Tests aus; Deployment braucht erfolgreiche Migration/Smoke-Checks.
- Dokumentiere Backups, Point-in-Time/Restore-Fähigkeit und führe vor Pilot einen Restore-Test in isolierter Umgebung durch.
- Rotiere alle initialen Secrets; Least-Privilege für Service Role, Hatchet, LLM, Meta und Deployment.
- Runbooks: Login/Rollen, Upload/Storage, Consent-Widerruf, Workflowstau, Providerfehler, Doppelpost, Löschung, Incident und Pilot-Offboarding.
- Datenschutz-/Einwilligungs-/Auftragsverarbeitungsfragen werden fachlich bzw. juristisch für den konkreten Pilot geprüft. Technik ersetzt diese Prüfung nicht.

### 3. Pilot-Onboarding

- Starte mit maximal zwei Abteilungen und klaren Rollen: Org Admin, Editor, Approver; Publishing benötigt Approver, Kinderinhalte den strengeren Reviewpfad.
- Richte Brand-Profil, Meta-Verbindungen, Zeitzone, Kommunikationsziele und zwei bis drei bevorzugte Layoutfamilien gemeinsam ein.
- Importiere keine Altbestände. Erstelle in einer begleiteten Session echte Beiträge: Ballschultraining, Vereinsleben/Ehrenamt und optional Spiel/Event.
- Liefere eine einseitige Mediencheckliste: Einwilligung, manuelle Gesichtskontrolle, kreative Verdeckung, Kontext-Risiko, Widerruf.
- Definiere Supportkanal und Reaktionszeit; Produktfehler landen mit correlation/publication ID, niemals mit Token/Originalfoto im Ticket.

### 4. Messinstrumentierung

Ereignisse werden tenantbezogen aggregiert und datensparsam erfasst. Keine Captions, Fotos, Namen oder Face-Boxen im Analyticsdienst.

Kernmetriken:

| Metrik | Definition | Pilot-Signal |
|---|---|---|
| Time-to-publish | erste Eingabe bis erfolgreiche Plattformveröffentlichung, aktive Wartezeit separat | Median sinkt gegenüber Ausgangswert |
| Weekly active departments | Abteilung erstellt/bearbeitet/freigibt/veröffentlicht | jede Pilotabteilung in ≥3/4 Wochen |
| Veröffentlichte Beiträge | erfolgreich je Plattform und Format | regelmäßige statt einmalige Nutzung |
| Approval cycle time | Freigabeanfrage bis Entscheidung | Engpass sichtbar und akzeptabel |
| Content diversity | unterschiedliche Presetfamilien | mindestens 3, nicht nur Spiele |
| Grounding corrections | sachliche Korrekturen vor Freigabe | sinkender Verlauf; keine veröffentlichten Erfindungen |
| Media safety blocks | offene Einwilligung/Gesicht verhindert Publish | Gate wirkt, kein Bypass |
| Duplicate/unknown rate | externe unklare Resultate/Dubletten | 0 Dubletten; Unknowns vollständig geklärt |
| Manual edit distance | Umfang der Caption-Änderung | Qualitätsindikator, kein Selbstzweck |

Vor Pilot Baseline je Abteilung erheben: Beiträge/Woche, aktive Minuten/Beitrag, beteiligte Personen und ausgelassene Beiträge.

### 5. Vierwöchiger Ablauf

- Woche 0: Onboarding, Sandboxpost, Rollen-/Consentübung, Baseline.
- Woche 1: begleitet, mindestens zwei echte Posts pro Abteilung; Fehler innerhalb 24 h triagieren.
- Woche 2: selbstständige Nutzung; qualitative Review zu Authentizität und Gestaltung.
- Woche 3: geplante Posts, Carousel/Story und kreative Verdeckung im realen Fall testen.
- Woche 4: Abschlussdaten, Interviews mit Editor und Approver, Zahlungs-/Fortsetzungsentscheidung.
- Wöchentlich Safety-, Workflow- und Providerfehler reviewen. Kein Experiment lockert Freigabe oder Mediengate.

### 6. Abnahme- und Notfalltests

Vor erstem echten Post:

1. Tenant-A/B-Negativtest in UI/API/Storage.
2. Upload mit EXIF/GPS; fertiges Derivat enthält beides nicht.
3. Manuell übersehenes Gesicht; Gate verlangt Vollständigkeitsbestätigung.
4. Minderjährigenfall mit Verdeckung und Sonderfreigabe.
5. Freigabe danach Bild/Text ändern; Publish blockiert.
6. Hatchet-Worker während Render/Publish neu starten.
7. Veröffentlichung umplanen/stornieren.
8. Meta-Timeout/429/Tokenablauf; kein Doppelpost.
9. Einwilligung widerrufen; geplanter Post wird blockiert und veröffentlichter Fall erhält Runbook-Aktion.
10. Backup in isolierte Staging-Umgebung wiederherstellen und Zugriff prüfen.

### 7. Entscheidungsrahmen

`GO – weiterentwickeln`, wenn nach vier Wochen:

- mindestens zwei Piloten weiterzahlen oder verbindlich in bezahlten Betrieb wechseln,
- beide Pilotabteilungen in mindestens drei Wochen aktiv waren,
- nicht-spielbezogene Inhalte regelmäßig vorkamen,
- Nutzer einen messbaren Zeit-/Qualitätsgewinn bestätigen,
- keine ungeklärte schwere Datenschutz-/Tenant-/Dublettenverletzung besteht,
- Betriebskosten und Supportaufwand in einem tragfähigen Preisrahmen liegen.

`PIVOT`, wenn Bedarf vorhanden ist, aber ein klarer Engpass dominiert, z. B. Materialeinsammlung statt Erstellung, nur Export statt API-Publishing oder nur Medienfreigabe. Dann genau diesen Engpass als neues Paket planen.

`NO-GO/PAUSE`, wenn keine Zahlungsbereitschaft/regelmäßige Nutzung entsteht oder Sicherheitsanforderungen mit Team/Budget nicht verantwortbar sind.

Postiz wird erst neu geprüft, wenn mehrere bezahlte Piloten mindestens drei zusätzliche Plattformen verlangen und die Wartung direkter Adapter den Integrationsbetrieb übersteigt. Hive wird nur für später nachgewiesene komplexe redaktionelle Agentenplanung geprüft, nicht für Scheduling/Publishing.

## Verifikation

Technisch vor Pilot:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm db:reset
pnpm db:test
```

Zusätzlich müssen die E2E-/Sandbox-Nachweise aus Plänen 004 und 006, Restore-Protokoll, Security-/Consent-Checkliste und Incidentkontakte vorliegen.

## Done-Kriterien

- Zwei konkrete Pilotzusagen und benannte Verantwortliche liegen vor.
- Produktions- und Stagingumgebungen, Backups/Restore, Alerts und Runbooks sind geprüft.
- Vier Wochen Nutzungs-, Qualitäts-, Safety-, Workflow- und Publishingdaten sind ausgewertet.
- Editor und Approver jedes Piloten wurden getrennt befragt.
- Go/Pivot/No-Go ist mit Kennzahlen, Kosten, Risiken und nächsten drei Arbeitspaketen dokumentiert.

## STOP-Bedingungen

- Kritische Tenant-Isolation, Originalmedien-Leak, ungeklärter Doppelpost oder unautorisierte Veröffentlichung: Pilot sofort pausieren, Incident-Runbook ausführen.
- Juristische/fachliche Freigabe für den konkreten Kinder-/Einwilligungsprozess fehlt: keine echten Kindermedien verwenden.
- App Review oder Providerzugang fehlt: nur expliziten Export-/Downloadpilot durchführen und Ergebnis getrennt bewerten.

## Pflegehinweis

Nach GO monatliche Produkt-/Safety-Review und quartalsweise Anbieter-/Graph-/Hatchet-Review. Metrikziele nach dem Pilot aus realer Baseline festlegen; keine Vanity-Metriken wie reine Textgenerierungen als Erfolg verwenden.

