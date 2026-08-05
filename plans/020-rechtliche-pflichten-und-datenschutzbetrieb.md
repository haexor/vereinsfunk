# 020 – Rechtliche Pflichten und Datenschutzbetrieb

## Ergebnis

Ein Verein kann das System betreiben, ohne dabei absehbar in ein Problem zu laufen: Verantwortlichkeiten sind benannt, Pflichtangaben für Kanäle sind hinterlegt, Aufbewahrungsfristen werden von Jobs eingehalten statt von Vorsätzen, Betroffenenanfragen sind beantwortbar, und die Verarbeitungen sind dokumentiert. Behauptungen wie „Rohmedien werden nach 90 Tagen gelöscht“ stimmen, weil ein Job sie durchsetzt.

Dieses Paket ist die Voraussetzung dafür, dass die Pakete 014, 015 und 018 produktiv gehen dürfen.

## Was dieses Paket nicht ist

Es ist keine Rechtsberatung und ersetzt keine. Es bringt das System in einen Zustand, in dem ein Verein und seine Beratung die notwendigen Entscheidungen treffen **können** — Felder, Nachweise, Fristen, Exporte, Protokolle. Die Texte selbst sollten anwaltlich geprüft werden, bevor sie ausgeliefert werden. Wo dieser Plan Rechtsnormen nennt, dienen sie der Verortung, nicht als Bewertung.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `apps/web/app/pages/einstellungen.vue:1` behauptet „Rohmedien · Automatische Löschung nach 90 Tagen“. Es existiert **kein Job, keine Frist im Datenmodell und kein Löschpfad.** Das ist die gefährlichste der fünf Dummy-Zeilen, weil sie eine Datenschutzzusage macht, die nichts einhält.
- Es gibt **keine Impressums- oder Datenschutzseite** in `apps/web/app/pages/`, weder für die Anwendung noch für die Vereinskanäle.
- `nuxt.config.ts:14-21` lädt Schriften von `fonts.googleapis.com` bei jedem Seitenaufruf. Paket 013 behebt das durch Selbst-Hosting; hier wird geprüft, dass keine weitere Verbindung zu Dritten übrig ist.
- `media_assets` (`202608030001:21-32`) hat `upload_status` mit dem Wert `'deleted'` und `exif_stripped_at`. Ein Löschzustand ist vorgesehen, wird aber von nichts gesetzt.
- `media_derivatives` hat `status = 'invalidated'` und einen Immutabilitätstrigger (`:108-109`), der Updates auf `ready`-Zeilen verhindert. **Das erschwert das Löschen**: eine Aufbewahrungsroutine muss Zeilen entfernen oder den Trigger gezielt umgehen dürfen. Das ist beim Entwurf zu berücksichtigen und nicht durch Abschalten des Triggers zu lösen.
- `audit_events` (`202608020001:246-256`) ist als Append-only-Protokoll kommentiert (`:451`) und hat keine Löschpolicy. Ein Audit-Log, das personenbezogene Daten enthält und nie gelöscht wird, ist selbst ein Datenschutzthema.
- `idempotency_keys.expires_at` (`:240`) existiert; **kein Job räumt ab.** Dieselbe Lücke bei `invitations.expires_at` (`:112`), `publication_media_grants.expires_at` (`202608030001:104`) und `consent_requests.expires_at` (Paket 015).
- `organization_profiles.responsible_person_profile_id` (Paket 009) und `social_connections.responsible_profile_id` (Paket 012) existieren, aber es gibt keinen Ort, an dem die daraus folgenden Pflichten erklärt werden.
- `apps/api/src/app.ts:44` redigiert `authorization`, `cookie`, `*.access_token`, `*.media` in Logs. Eine gute Grundlage, die um Kommentartexte, Elternkontakte und Einwilligungsnachweise zu erweitern ist.
- `packages/observability/src/index.ts` existiert mit 22 Zeilen; ob und wohin exportiert wird, ist beim Umsetzen zu prüfen — jeder externe Telemetrieempfänger ist ein Empfänger im datenschutzrechtlichen Sinn.

## Scope

- Migration: Aufbewahrungsfristen je Verein, Löschprotokoll, Betroffenenanfragen, Auftragsverarbeitungs- und Verarbeitungsdokumentation
- Aufbewahrungs- und Löschjobs für alle Datenarten mit Frist
- Impressums- und Datenschutzangaben je Verein und je Kanal
- Verantwortlichkeiten sichtbar machen und erzwingen
- Betroffenenrechte: Auskunft, Löschung, Datenexport
- Rechtstexte der Anwendung selbst, Cookie- und Drittanbieterfreiheit
- Rückbau der letzten Einstellungs-Dummy-Zeile

Nicht enthalten: Vertragswerk und Preisgestaltung, Barrierefreiheitserklärung, Steuer- und Gemeinnützigkeitsthemen, Urheberrechtsklärung für Musik in Reels über den Hinweis hinaus.

## Datenmodell

Migration `2026080413_compliance.sql`:

```sql
-- Fristen je Verein, mit belastbaren Obergrenzen.
create table public.retention_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  raw_media_days integer not null default 90 check (raw_media_days between 7 and 730),
  derivative_days integer check (derivative_days between 30 and 3650),
  comment_text_days integer not null default 30 check (comment_text_days between 1 and 90),
  status_event_days integer not null default 730 check (status_event_days between 90 and 3650),
  audit_event_days integer not null default 1095 check (audit_event_days between 365 and 3650),
  consent_evidence_years integer not null default 5 check (consent_evidence_years between 1 and 30),
  delete_media_on_person_leave boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Was gelöscht wurde, bleibt als Tatsache nachweisbar — ohne die Daten selbst.
create table public.retention_deletions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null, entity_count integer not null check (entity_count >= 0),
  rule_key text not null, cutoff_date date not null,
  correlation_id uuid not null,
  executed_at timestamptz not null default now()
);

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('access','deletion','rectification','objection','portability')),
  subject_kind text not null check (subject_kind in ('member','directory_person','guardian','external')),
  directory_person_id uuid,
  subject_label text not null,
  received_at date not null, due_at date not null,
  -- Verlängerung um bis zu zwei Monate, nachweisbar statt stillschweigend.
  extended_until date check (extended_until is null or extended_until > due_at),
  extension_reason text, extension_notified_at timestamptz,
  check (extension_reason is null or extended_until is not null),
  status text not null default 'open'
    check (status in ('open','in_progress','completed','rejected','partially_completed')),
  resolution_note text,
  handled_by uuid references public.profiles(id), completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Spaltenliste bei SET NULL: sonst wuerde auch organization_id genullt.
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete set null (directory_person_id)
);

-- Dokumentation der Verarbeitungen und der Auftragsverarbeiter.
create table public.processing_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null, legal_basis text not null,
  data_categories text[] not null, subject_categories text[] not null,
  recipients text[] not null default '{}',
  third_country_transfer boolean not null default false, transfer_safeguard text,
  retention_note text not null,
  reviewed_at date, reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.processor_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processor_name text not null, purpose text not null,
  signed_at date, valid_until date,
  -- raw-media, nicht brand-assets: dort liegen schon die Einwilligungsnachweise
  -- aus Paket 015, und brand-assets erlaubt nur SVG, PNG, JPEG und WOFF2
  -- (`202608020002:5`) -- ein Vertrag als PDF passt dort nicht hinein.
  document_bucket text not null default 'raw-media'
    check (document_bucket = 'raw-media'),
  document_path text,
  status text not null default 'pending' check (status in ('pending','active','expired','terminated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`due_at` in `data_subject_requests` wird beim Anlegen auf `received_at + interval '1 month'` gesetzt — **ein Monat, keine 30 Tage.** Die DSGVO rechnet in Kalendermonaten, und die beiden Werte fallen je nach Monat auseinander. Ist `extended_until` gesetzt, gilt dieses Datum; die Verlängerung ist auf zwei zusätzliche Monate begrenzt und verlangt eine Begründung und eine Benachrichtigung der betroffenen Person — beides Spalten, damit es belegbar ist und nicht behauptet. Die Frist ist der Grund, warum diese Tabelle existiert: eine Anfrage, die in einem Postfach liegt, wird übersehen.

Verträge liegen unter `organizations/<orgId>/compliance/<agreementId>/…` in `raw-media` — kein vierter Bucket. Paket 015 legt Einwilligungsnachweise nach demselben Muster dort ab und erweitert die MIME-Liste bereits um `application/pdf`; dieses Paket ergänzt `application/vnd.openxmlformats-officedocument.wordprocessingml.document` für DOCX, falls Vereine Verträge als Word-Datei erhalten. Damit greift `storage_read_own_organization` unverändert (`202608020002:8-13`), und die Aufbewahrungsjobs dieses Pakets müssen nur einen Bucket kennen statt zwei.

Ein Bucket für alles Private hat einen Preis: die Zugriffsregeln unterscheiden nicht mehr nach Bucket, sondern nach Pfadpräfix. `compliance/` ist deshalb nur mit `organization.manage` lesbar, `consents/` nur mit `department.manage` oder höher, `media/` nach der bestehenden Regel — durchgesetzt in der Storage-Policy und nicht erst in der API. Jeder Abruf läuft über einen kurzlebigen signierten Link und erzeugt einen `audit_events`-Eintrag.

`retention_deletions` zählt nur — keine IDs, keine Namen. Ein Löschprotokoll, das die gelöschten Daten benennt, hat nichts gelöscht.

Kanalbezogene Pflichtangaben:

```sql
alter table public.social_connections
  add column imprint_url text,
  add column privacy_url text,
  add column editorial_responsible_profile_id uuid references public.profiles(id),
  add column editorial_responsible_note text;
```

Getrennt von `responsible_profile_id` aus Paket 012: dort geht es darum, wer im Verein für den Kanal zuständig ist. Hier geht es um die presserechtliche Verantwortung für redaktionelle Inhalte, die in Deutschland bei journalistisch-redaktionell gestalteten Angeboten eine benannte Person verlangt (§ 18 MStV). Bei vielen Vereinskanälen ist das dieselbe Person; die Unterscheidung muss trotzdem möglich sein.

## Umsetzung

### 1. Aufbewahrung durchsetzen

Ein täglicher Hatchet-Cron `enforce-retention`, je Verein, mit Fairness-Key `organizationId`. Der Workflow-Name muss in `WorkflowNameSchema` (`packages/contracts/src/index.ts:82`) ergänzt werden.

Regeln, je eigener Schritt und einzeln abschaltbar:

| Regel | Wirkung |
|---|---|
| Rohmedien | `media_assets` älter als `raw_media_days`, **die nicht Grundlage eines freigegebenen Derivats sind** → Storage-Objekt löschen, `upload_status = 'deleted'`, Metadaten behalten |
| Derivate | nur wenn `derivative_days` gesetzt und keine `published`-Publikation darauf verweist |
| Kommentartexte | `publication_comments.body = null` (Paket 018) |
| Statushistorie | `post_status_events` älter als `status_event_days` löschen; Aggregate bleiben |
| Audit | `audit_events` älter als `audit_event_days` löschen. **Ausnahme**: Ereignisse zu Einwilligungen, Widerrufen und Zugriffen auf Elternkontakte werden über `consent_evidence_years` gehalten |
| Einwilligungsnachweise | erst nach `consent_evidence_years` **ab Ende der Gültigkeit** — ein Nachweis, den man wegwirft, während der Anspruch noch besteht, ist der schlechteste Fall |
| Abgelaufene Token | `invitations`, `consent_requests`, `publication_media_grants`, `idempotency_keys` mit `expires_at` in der Vergangenheit |

Zwei Punkte, die leicht übersehen werden:

**Rohmedien dürfen nicht gelöscht werden, solange ein freigegebenes Derivat sie als Ursprung braucht.** `media_derivatives` verweist mit `on delete restrict` auf `media_assets` (`202608030001:54`) — die Datenbank verhindert es, und der Job muss die Auswahl entsprechend einschränken statt in einen Fehler zu laufen.

**Der Immutabilitätstrigger** auf `media_derivatives` (`:108-109`) verhindert jedes Update auf `ready`-Zeilen. Eine Aufbewahrungsroutine, die Derivate entfernen soll, muss löschen statt aktualisieren, oder der Trigger braucht eine eng gefasste, ausdrücklich begründete Ausnahme für den Aufbewahrungskontext. Den Trigger allgemein zu lockern würde `ADR-003` und `ADR-006` untergraben.

Jeder Lauf schreibt `retention_deletions` und ist idempotent. Ein Trockenlaufmodus zeigt, was gelöscht würde — vor dem ersten scharfen Lauf ist das obligatorisch.

### 2. Betroffenenrechte bedienbar machen

- `pages/datenschutz/anfragen.vue` für Berechtigte: Anfrage erfassen, Frist sehen, Bearbeitung dokumentieren, abschließen.
- **Auskunft**: `GET /v1/data-subjects/:personId/export` erzeugt ein maschinenlesbares Bündel zu einer Person aus dem Verzeichnis — Stammdaten, Einwilligungen mit Umfang und Historie, Medienverwendungen mit Beitragsbezug, Zugriffsprotokoll. Erzeugt als Job, nicht im Request, und über einen kurzlebigen signierten Link abholbar.
- **Löschung**: `POST /v1/data-subjects/:personId/erase` löscht Verzeichniseintrag, Elternkontakt und Gesichtszuordnungen. Was **nicht** gelöscht wird und warum, muss die Antwort benennen: Einwilligungsnachweise, solange sie zur Rechtsverteidigung gebraucht werden, und veröffentlichte Beiträge, deren Löschung eine Handlung auf der Plattform ist. Eine Löschfunktion, die stillschweigend Teile auslässt, ist schlimmer als eine, die ihre Grenzen nennt.
- **Widerspruch** verweist auf den Widerrufspfad aus Paket 015.
- Alle Vorgänge erzeugen `audit_events` und sind im Nachhinein belegbar.

### 3. Pflichtangaben und Verantwortung

- `pages/einstellungen/recht.vue`: Impressumsangaben des Vereins, Datenschutz-Kontakt, verantwortliche Person für Inhalte, redaktionell verantwortliche Person je Kanal, Links zu Impressum und Datenschutzerklärung.
- Der Verein kann `require_channel_responsible` (Paket 012) verlangen; dann ist ein Kanal ohne benannte Person nicht bespielbar.
- Beim Verbinden eines Kanals erscheint eine kompakte Pflichtenliste: Impressum auf dem Profil verlinken, Datenschutzerklärung erreichbar halten, verantwortliche Person benennen, Bildrechte prüfen, Musikrechte bei Reels beachten. Kurz, konkret, ohne Rechtsberatungston.
- Beim Erstellen eines Beitrags mit fremder Musik oder fremden Bildern ein Hinweisfeld „Rechte geklärt?“ mit Pflichtbestätigung, wenn der Verein das in seiner Richtlinie verlangt. Plattformlizenzen für Musik gelten in der Regel nicht für Konten, die einem Verein zuzurechnen sind.
- Paket 010 verhindert bereits das Entfernen einer benannten verantwortlichen Person; das gilt hier zusätzlich für die redaktionelle Verantwortung.

### 4. Dokumentation der Verarbeitungen

Beim Anlegen eines Vereins werden `processing_records` mit sinnvollen Vorbelegungen erzeugt — Beitragserstellung, Medienverarbeitung, Einwilligungsverwaltung, Reichweitenmessung, Mitgliederverzeichnis, Kommentaranalyse. Jeder Eintrag ist bearbeitbar und muss vom Verein bestätigt werden, statt als fertige Behauptung dort zu stehen.

Ein Verein, der Paket 014 (Personenverzeichnis) oder 018 (Kommentaranalyse) aktiviert, wird durch die passende Ergänzung geführt. Bei Paket 018 ist der Eintrag Voraussetzung für die Aktivierung, nicht Folge.

`processor_agreements` hält die eigene Auftragsverarbeitung und die der eingesetzten Dienste fest — Supabase, Hosting, E-Mail-Versand, LLM-Anbieter, Meta, Quellsysteme aus Paket 014. Ablaufende Vereinbarungen erscheinen als Aufgabe.

### 4b. Manipulationssicherer Audit-Trail

**Anforderung des Nutzers am 2026-08-05**, aufgekommen beim Review von Paket 010: es muss nachvollziehbar sein, wer wann welche Berechtigung vergeben oder entzogen hat, „im besten Fall kryptografisch gesichert“.

Stand heute: `audit_events` ist für Nutzer append-only — `authenticated` hat keinen `insert`/`update`/`delete`-Grant und keine entsprechende Policy, gelesen wird nur mit `organization.manage` (`202608020001:427`). Geschrieben wird ausschließlich privilegiert, über den Service-Client oder aus `security definer`-Funktionen. Alle Rollen- und Mitgliedschaftsänderungen aus Paket 010 landen dort mit `actor_user_id`, `action`, `entity_type`/`entity_id`, `correlation_id` und Metadaten (`fromRole`/`toRole`). Das deckt die Nachvollziehbarkeit ab.

Was fehlt: die Einträge sind **unverkettet und unsigniert**. Wer Datenbankzugriff hat — der Betreiber selbst, oder jemand mit einem geleakten Service-Key — kann sie unbemerkt ändern oder löschen. Für ein System, das genau diesen Betreiber gegenüber einem Verein rechenschaftspflichtig macht, ist das die relevante Lücke.

Umsetzung ohne neue Abhängigkeit, etablierte Bauform (Hash-Kette, wie sie tamper-evident logs allgemein verwenden):

- zwei Spalten `prev_hash text` und `hash text` auf `audit_events`, Kette **je Verein**
- ein `before insert`-Trigger, der `hash = encode(extensions.digest(prev_hash || <kanonische Nutzlast>, 'sha256'), 'hex')` setzt; `extensions.digest` ist bereits im Einsatz (`accept_invitation()` in `2026080601`)
- ein periodischer Lauf, der den aktuellen Kopf-Hash je Verein mit einem Schlüssel signiert, der **nicht** in der Datenbank liegt (`packages/secrets`, `SECRET_BOX_KEYS`) und die Signatur mit Zeitstempel ablegt
- Prüffunktion, die eine Kette nachrechnet, plus ein Export „Berechtigungsverlauf“ für den Verein

Damit ist jede nachträgliche Änderung und jede Löschung erkennbar. Bewusst **nicht** gebaut: Merkle-Baum, externe Transparency-Log-Verankerung (Certificate Transparency, Trillian) oder ein Ledger-Produkt (immudb, QLDB) — der Aufwand steht für einen Vereins-SaaS nicht im Verhältnis, und die Hash-Kette liefert die Eigenschaft, auf die es ankommt.

Ebenfalls bewusst nicht: das Berechtigungsmodell in eine externe Policy-Engine (OpenFGA, SpiceDB, Cedar, Casbin) auslagern. Es ist absichtlich zweimal implementiert — in `packages/authorization` und noch einmal in Postgres-RLS —, damit die Datenbank eine unabhängige zweite Durchsetzungsebene bleibt. Eine externe Engine nähme RLS aus dem Spiel und machte die Datenbank zum schwächsten Punkt; die Hierarchie Verein → Abteilung → Team ist genau das, was RLS gut ausdrückt.

### 5. Die Anwendung selbst

- Impressum und Datenschutzerklärung für Vereinsfunk als Produkt, erreichbar auch ohne Anmeldung.
- **Keine Verbindung zu Dritten im Browser ohne Notwendigkeit.** Nach Paket 013 sind die Schriften selbst gehostet; hier wird geprüft, dass keine weitere externe Anfrage übrig ist. Ein automatisierter Test, der beim Laden der Startseite alle Anfragen an fremde Hosts als Fehler wertet, ist dafür das wirksamste Mittel.
- Cookies: die Sitzung ist technisch notwendig und braucht keine Einwilligung. Wird später Analytik oder ein Fehlermelder mit Personenbezug ergänzt, ist ein Einwilligungsbanner nötig — deshalb sollte jetzt festgehalten werden, dass keiner im Einsatz ist. `packages/observability` ist bei der Umsetzung darauf zu prüfen.
- Meta verlangt für das App Review eine Datenschutzerklärung und einen Endpunkt für Löschanfragen. Beides entsteht hier und ist damit Voraussetzung für Pakete 012, 017 und 018.
- Löschung eines Vereinskontos: vollständiger Export vorab, dann Löschung mit klar benannter Frist. `audit_events` verweist mit `on delete restrict` auf `organizations` (`202608020001:248`) — die Reihenfolge muss also bewusst festgelegt werden, statt an einem Fremdschlüssel zu scheitern.

### 6. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/einstellungen.vue:1` | „Rohmedien · Automatische Löschung nach 90 Tagen“ als Text ohne Job | echte Frist in `retention_settings`, durchgesetzt durch `enforce-retention`, mit Löschprotokoll |
| `nuxt.config.ts:14-21` | Verbindung zu Google Fonts bei jedem Aufruf | in Paket 013 abgelöst, hier durch Test abgesichert |
| fehlende Rechtstexte | keine Impressums- oder Datenschutzseite | vorhanden, ohne Anmeldung erreichbar |
| `audit_events` unbegrenzt | kein Löschpfad | Frist mit ausdrücklicher Ausnahme für Einwilligungsnachweise |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Aufbewahrungstests je Regel: Rohmedium über der Frist ohne freigegebenes Derivat wird gelöscht; **mit** freigegebenem Derivat nicht; Kommentartext verschwindet, Bewertung bleibt; Einwilligungsnachweis wird erst nach Ende der Gültigkeit plus Frist gelöscht; abgelaufene Token verschwinden; der Job ist bei zweimaligem Lauf idempotent; der Trockenlauf schreibt nichts.
- Löschnachweis: nach dem Lauf existiert das Storage-Objekt nicht mehr — nicht nur die Datenbankzeile. Ein Test, der nur die Zeile prüft, belegt die Zusage nicht.
- Exporttests: das Auskunftsbündel enthält alle Kategorien und **keine** Daten anderer Personen. Ein Export, der ein Gruppenfoto mit fünf Kindern enthält, ist ein Datenschutzvorfall im Namen der Auskunft — der Export enthält Verweise und Metadaten, keine Medien Dritter.
- pgTAP: `retention_settings` außerhalb der Grenzen verstößt gegen CHECK; `retention_deletions` ist ohne `organization.manage` nicht lesbar; `due_at` liegt genau einen Kalendermonat nach `received_at`, auch bei Eingang am 31. Januar; `extended_until` vor `due_at` verstößt gegen CHECK; eine Begründung ohne Verlängerungsdatum verstößt gegen CHECK; Anfragen und Verarbeitungsdokumente fremder Vereine sind unsichtbar; Löschen einer Verzeichnisperson lässt die Betroffenenanfrage bestehen und setzt nur `directory_person_id` auf `null` — `subject_label` und die Frist bleiben, sonst verschwindet der Nachweis der Bearbeitung mit der Löschung, die er dokumentiert.
- Bucket-Test: ein PDF und ein DOCX lassen sich nach `raw-media` unter `compliance/` hochladen, aus `brand-assets` nicht; ein fremder Verein erreicht das Objekt nicht; der Abruf erzeugt einen `audit_events`-Eintrag. Der erste Teil ist der Punkt — eine MIME-Liste, die Vertragsdokumente ablehnt, fällt sonst erst beim ersten echten AVV auf.
- Pfadpräfix-Tests, weil ein gemeinsamer Bucket die Trennung an den Pfad verlagert: ein `editor` liest `media/`, aber **nicht** `consents/` und **nicht** `compliance/`; ein `department_admin` liest `consents/` seiner Abteilung, aber nicht `compliance/`; Pfad-Traversal (`../`) im Objektnamen greift keine fremde Ebene ab.
- Netzwerktest: Laden von Start-, Anmelde- und Dashboardseite erzeugt keine Anfrage an einen fremden Host.
- manuell: Frist auf 7 Tage senken, Trockenlauf ansehen, scharfen Lauf ausführen, Protokoll prüfen; Betroffenenanfrage anlegen, Export erzeugen, Löschung ausführen, Antwort benennt Ausnahmen.

## Risiken und offene Entscheidungen

- **Anwaltliche Prüfung** ist keine Option, sondern Voraussetzung — insbesondere für den Einwilligungstext (Paket 015), die Datenschutzerklärung, den AVV und den Bestätigungstext für Schriftlizenzen (Paket 013). Der Entwicklungsaufwand ist hier kleiner als der Beschaffungsaufwand.
- **Löschen versus Nachweisen** ist ein echter Zielkonflikt. Einwilligungsnachweise zu früh zu löschen macht den Verein beweislos; zu lange zu halten verletzt die Datenminimierung. Der Vorschlag von fünf Jahren ab Ende der Gültigkeit ist begründbar und sollte bestätigt werden.
- **Audit-Log mit Personenbezug**: `audit_events.metadata` ist ein freies `jsonb`. Ohne Disziplin landen dort Namen und E-Mail-Adressen und werden über Jahre gehalten. Es braucht eine verbindliche Regel, was in `metadata` gehört, und eine Prüfung im Code-Review — sonst ist die Frist wirkungslos.
- **Veröffentlichte Beiträge** entziehen sich unserem Löschzugriff. Was auf einer Plattform steht, entfernt der Verein dort. Das System kann erinnern und protokollieren, nicht handeln, und muss das klar sagen.
- **Fristen als Vereinsentscheidung** mit Ober- und Untergrenzen: der Default von 90 Tagen für Rohmedien entspricht der bisherigen Behauptung in der Oberfläche und ist ein vernünftiger Ausgangspunkt. Vereine, die Rohmaterial länger brauchen, sollen verlängern können — bis zu einer Grenze, die wir vertreten können.
- **Reihenfolge**: die Pakete 014, 015 und 018 sind technisch vorher umsetzbar, dürfen aber erst nach diesem Paket mit echten Daten betrieben werden. Diese Trennung zwischen „gebaut“ und „produktiv“ muss in der Statusverfolgung sichtbar sein, sonst wird sie übersehen.
