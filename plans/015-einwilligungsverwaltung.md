# 015 – Einwilligungsverwaltung: Registratur und digitaler Prozess

## Ergebnis

Der Verein weiß jederzeit, für welche Person eine gültige Einwilligung zur Veröffentlichung von Bildern vorliegt, in welchem Umfang, bis wann und woher der Nachweis kommt. Bestehende Papiererklärungen werden hochgeladen und verwaltet; neue Einwilligungen können digital bei Erziehungsberechtigten angefragt werden. Ein Widerruf wirkt sofort: er blockiert offene Freigaben und markiert bereits veröffentlichte Beiträge zur Prüfung. Fehlt eine Einwilligung, blockiert das bestehende Medien-Gate — nicht ein Mensch, der zufällig daran denkt.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `supabase/migrations/202608030001:33-38` `consent_records` existiert mit `pseudonymous_subject_ref`, `scope text` (max. 500 Zeichen Freitext), `guardian_confirmed boolean`, `valid_from`, `valid_until`, `revoked_at`, `evidence_bucket`, `evidence_path`. Paket 014 ergänzt `directory_person_id`.
- `scope` als Freitext ist zu unscharf für eine Prüfung. „Nur Mannschaftsfotos, kein Instagram“ lässt sich als Text speichern, aber nicht durchsetzen.
- Es gibt **nur `consent_records_select`** (`:117`) und `grant select` (`:131`). Kein Schreibpfad, kein Endpunkt, keine Oberfläche. Einwilligungen existieren im Schema und nirgends sonst.
- `face_regions` (`:39-48`) kennt `decision in ('pending','consented','obscure','exclude')` und einen CHECK, der bei `decision = 'consented'` eine `consent_record_id` erzwingt und bei allen anderen verbietet (`:46`). Diese Kopplung ist korrekt und wird die Grundlage der Durchsetzung.
- `packages/domain/src/index.ts:108-117` `evaluateMediaGate` erwartet je Gesicht ein `consentValid?: boolean`. **Wer diesen Wert bestimmt, ist bisher nicht implementiert.** Genau das liefert dieses Paket.
- `:112` blockiert bei `decision === 'consented' && !consentValid` mit `consent_invalid`; `:115` blockiert bei minderjähriger Person ohne `minorReviewConfirmed` mit `minor_review_required`. Die Blocker existieren, sie werden nur nie befüllt.
- `packages/domain/src/index.ts:119-123` `assertApprovalSnapshot` verlangt Derivat-Hashes bei jeder Freigabe. `approval_media_snapshots` (`202608030001:69-73`) hält sie fest. Ein Widerruf muss über diesen Weg auf veröffentlichte Inhalte zurückschließen können.
- `apps/web/app/pages/freigaben.vue:3-6` behauptet in einer Karte „Minderjährige · Einwilligung geprüft“ als hartkodierten Text. Es gibt nichts, was das prüft.
- Der Trigger `invalidate_approvals_for_media_change` (`202608030001:110-111`) invalidiert Freigaben bei Änderung eines Derivats. Das Muster für „Widerruf invalidiert Freigaben“ ist damit vorhanden — wird aber **nicht unverändert übernommen**, siehe Korrektur unten.

## Korrekturen zur Ausgangslage (2026-08-08, verifiziert gegen main nach 011/012/013/014/019/023)

Gegenüber dem auf `b5c2eda6` geschriebenen Plantext haben sich Zeilennummern verschoben und zwei inhaltliche Punkte geändert:

- **`directory_person_id` ist bereits da.** `consent_records` trägt seit Paket 014 (`2026080703_integration_framework.sql:197-200`) `directory_person_id` mit FK auf `directory_people(organization_id, id)`, `on delete restrict` — exakt wie oben angenommen, keine Abweichung.
- **`evaluateMediaGate`/`assertApprovalSnapshot` sind verschoben, nicht verändert.** Heute `packages/domain/src/index.ts:414-432` bzw. `:447-451` (statt `:108-117`/`:119-123`). Repo-weite Suche bestätigt: `consentValid` wird nirgends im Code berechnet — nur `apps/api/src/app.ts:1446` reicht das Feld optional als Zod-Schema durch, ohne es zu befüllen.
- **`raw-media`-MIME-Liste ist heute breiter als im Plan zitiert.** Paket 013 hat sie um Schriftformate erweitert: `allowed_mime_types = ['image/jpeg','image/png','image/webp','video/mp4','font/woff2','font/ttf','font/otf']` (`2026080702_brand_assets_and_fonts.sql:391-393`), nicht mehr die ursprünglichen vier Bildtypen. `application/pdf` fehlt weiterhin — die Kernaussage („PDF-Upload scheitert am Bucket“) bleibt richtig, nur die Ausgangsliste ändert sich von vier auf sieben Einträge.
- **`pages/freigaben.vue`-Rückbau ist bereits erledigt, nicht mehr Aufgabe von 015.** Paket 011 hat die zwei erfundenen Beiträge und den hartkodierten Text „Minderjährige · Einwilligung geprüft“ bereits durch echte Daten aus `GET /v1/approval-stages/mine` (`apps/api/src/app.ts:3921-3947`) und `POST /v1/approval-stages/:id/decide` (`:3854-3871`) ersetzt; die Seite zeigt heute `stageItem.isMinorStage` aus echten Daten (`freigaben.vue:79-81`), keinen Fake-Text mehr. Was tatsächlich fehlt: `GET /v1/approval-stages/mine` ruft `evaluateMediaGate` gar nicht auf und liefert keine Blocker-Liste — `evaluateMediaGate` wird bislang ausschließlich vom isolierten, zustandslosen `POST /v1/media/gate` (`app.ts:1442-1448`) genutzt, den `freigaben.vue` nicht konsumiert. Abschnitt 6 (Oberfläche) dieses Plans wird entsprechend angepasst: keine „Karte ersetzen“, sondern `ApprovalStage`/`ApprovalStageSchema` um eine Blocker-Liste erweitern (inklusive der drei neuen Consent-Blocker) und diese zusätzlich zu `isMinorStage` anzeigen. Eine echte Medienvorschau existiert weiterhin nicht und bleibt, wie ursprünglich in Zeile 265 vermerkt, offen — sie ist kein Bestandteil des Scopes von 015 und wird hier nicht nachgezogen (kein Auftrag dazu in diesem Plan).
- **Bug im Vorbild-Trigger gefunden — wird mitbehoben, nicht kopiert.** `invalidate_approvals_for_media_change()` (`202608030001:110`) filtert `... and media_derivative_id = new.media_derivative_id`. Der Trigger feuert `after update on public.media_derivatives` — dort heißt die Primärschlüsselspalte aber `id`, nicht `media_derivative_id` (`202608030001:49-55`). `new.media_derivative_id` existiert auf dieser Zeile nicht und würde zur Laufzeit mit einem Postgres-Fehler abbrechen. Der Trigger ist bislang nie gelaufen, weil kein Code `media_derivatives.sha256`/`.status` ändert (Inhalts-Pipeline fehlt weiterhin) — deshalb hat ihn bislang kein Test und kein Lauf ausgelöst. Diese Sitzung behebt den Tippfehler (`new.media_derivative_id` → `new.id`) als Teil der Umsetzung, weil der neue Widerrufs-Trigger dasselbe Muster korrekt nachbilden muss und ein bewusst unkorrigiert kopierter Fehler daneben keinen Sinn ergäbe. Kein sonstiges Verhalten dieses Triggers wird angefasst.
- **`policy_settings`-Vererbungsmuster für die zwei neuen Felder.** Boolesche Flags folgen dem AND-Muster über `authz.resolve_policy_flag` (`coalesce(x, true)`-Reduktion organisation→department→team, `2026080604_policy_settings_and_invite_rights.sql:65-101`) — `consent_expires_on_leave` folgt diesem Muster. Integer-Felder wie `review_minimum_approvals`/`review_deadline_hours` folgen stattdessen „innerste gesetzte Ebene gewinnt“ (kein AND) — `consent_validity_months` folgt diesem zweiten Muster. Jede neue Spalte auf `policy_settings` braucht außerdem einen neu ausgestellten `grant select (...)` mit vollständiger Spaltenliste; Postgres kennt kein additives Grant auf einzelne neue Spalten (Vorbild: `2026080606...:32-35`, `2026080701...:189`).

## Scope

- Migration: Einwilligungsumfang strukturieren, digitale Anfragen, Nachweise, Widerrufspfad, Herkunft
- `packages/domain`: Gültigkeitsauswertung, Umfangsprüfung, Widerrufsfolgen
- API: Registratur, Anfrage, Bestätigung, Widerruf, Gate-Auswertung
- öffentlicher Bestätigungs- und Widerrufspfad ohne Konto
- Übernahme eines Einwilligungsstatus aus einem Quellsystem als Nachweisquelle
- Nuxt: Einwilligungsübersicht, Zuordnung im Medien-Review, Blocker-Anzeige in Freigaben (kein Rückbau nötig, siehe Korrektur oben — 011 hat die Dummies bereits ersetzt)

Nicht enthalten: Gesichtslokalisierung und Verdeckung (Pakete 002/003), Aufbewahrungsfristen und Betroffenenrechte als Betriebsprozess (020).

## Fachliches Modell

Eine Einwilligung ist kein Boolescher Wert. Sie hat einen Umfang, und der Umfang muss maschinell prüfbar sein:

```ts
interface ConsentScope {
  purposes: readonly ('social_media' | 'website' | 'print' | 'internal')[]
  platforms: readonly ('instagram' | 'facebook')[] | null   // null = alle erlaubten
  mediaKinds: readonly ('photo' | 'video')[]
  contexts: readonly ('team_photo' | 'match' | 'training' | 'event' | 'portrait')[] | null
  namingAllowed: boolean          // darf der Name genannt werden?
  departmentIds: readonly string[] | null                   // null = vereinsweit
}
```

Diese Struktur ersetzt den Freitext nicht, sondern ergänzt ihn: `scope` bleibt als menschenlesbare Wiedergabe der unterschriebenen Erklärung erhalten, `scope_structured` wird geprüft. Bei Widerspruch gilt das Papier — deshalb ist der Freitext weiterhin Pflicht und der Upload des Nachweises ebenfalls.

`namingAllowed` ist wichtiger, als es aussieht: viele Vereine dürfen ein Foto zeigen, aber nicht „Lisa M. (11) erzielte das Siegtor“ schreiben. Der Content-Generator muss das wissen.

**Gültigkeit** ist eine Funktion, nicht ein Feld:

```ts
export function evaluateConsent(record, at: Date, required: RequiredConsent):
  { valid: boolean; reasons: readonly ConsentBlocker[] }
```

Blocker: `revoked`, `superseded`, `not_yet_valid`, `expired`, `guardian_missing`, `purpose_not_covered`, `platform_not_covered`, `media_kind_not_covered`, `context_not_covered`, `department_not_covered`, `person_left`.

`superseded` gehört zwingend dazu und wäre leicht zu vergessen: weil eine Einwilligung nie bearbeitet, sondern verkettet wird, bleibt die alte Zeile mit ihrem alten — womöglich weiteren — Umfang gültig, solange nichts sie ausschließt. Gültig ist ausschließlich die Zeile am Ende der Kette. Eine Auswertung, die eine Zeile mit gesetztem `superseded_by` akzeptiert, veröffentlicht auf Grundlage einer zurückgezogenen Fassung.

`person_left` ist der Grund, warum Paket 014 vorausgeht: verlässt eine Person den Verein, ist die Grundlage für weitere Veröffentlichung in der Regel entfallen. Ob dies eine Einwilligung automatisch beendet, ist eine bewusste Vereinsentscheidung und wird als Richtlinie in `policy_settings` abgebildet (`consent_expires_on_leave boolean`), nicht fest verdrahtet. Bereits veröffentlichte Beiträge werden davon nicht rückwirkend rechtswidrig, aber neue Verwendung wird blockiert.

## Datenmodell

Migration `2026080408_consent_management.sql`:

```sql
alter table public.consent_records
  add column scope_structured jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scope_structured) = 'object'),
  add column origin text not null default 'paper'
    check (origin in ('paper','digital','imported')),
  add column source_id uuid,                        -- nur bei origin = 'imported'
  add column signed_at date,
  add column signer_name text,
  add column signer_role text check (signer_role in ('self','guardian')),
  add column revoked_by text check (revoked_by in ('self','guardian','organization')),
  add column revocation_reason text,
  add column superseded_by uuid;

-- Spaltenliste bei SET NULL: ohne sie setzt PostgreSQL alle Spalten des
-- Fremdschluessels auf NULL, also auch organization_id -- die ist not null.
alter table public.consent_records add constraint consent_records_superseded_fk
  foreign key (organization_id, superseded_by)
  references public.consent_records(organization_id, id) on delete set null (superseded_by);

-- Minderjährige brauchen eine bestätigte Erziehungsberechtigung.
alter table public.consent_records add constraint consent_records_guardian_check
  check (signer_role is distinct from 'guardian' or guardian_confirmed);

-- Eine Einwilligung loest sich nicht selbst ab, und zwei Nachfolger derselben
-- Zeile machen unentscheidbar, welche Version gilt.
alter table public.consent_records add constraint consent_records_not_self_superseded
  check (superseded_by is null or superseded_by <> id);
create unique index consent_records_superseded_unique
  on public.consent_records (organization_id, superseded_by)
  where superseded_by is not null;

-- source_id gehoert zur Herkunft: mandantengetreu verankert und nur bei Import.
alter table public.consent_records add constraint consent_records_source_fk
  foreign key (organization_id, source_id)
  references public.integration_sources(organization_id, id) on delete set null (source_id);
-- Nur in dieser Richtung: eine importierte Einwilligung behaelt ihre Herkunft,
-- auch wenn die Quelle spaeter geloescht wird und source_id auf NULL faellt.
alter table public.consent_records add constraint consent_records_origin_source_check
  check (source_id is null or origin = 'imported');
```

`superseded_by` statt Änderung: eine Einwilligung wird **nie bearbeitet**. Ändert sich der Umfang, entsteht eine neue Zeile und die alte wird verkettet. Das ist dasselbe Prinzip wie bei `post_versions` und der einzige Weg, im Streitfall zu belegen, was wann galt.

Digitale Anfragen:

```sql
create table public.consent_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  directory_person_id uuid not null,
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  recipient_role text not null check (recipient_role in ('self','guardian')),
  requested_scope jsonb not null check (jsonb_typeof(requested_scope) = 'object'),
  text_version text not null,                 -- Version des Einwilligungstextes
  token_hash text not null unique,
  status text not null default 'sent'
    check (status in ('sent','granted','declined','expired','revoked_link')),
  expires_at timestamptz not null,
  responded_at timestamptz,
  consent_record_id uuid,                     -- gesetzt bei status = 'granted'
  -- Nachweis der Abgabe, datenschutzarm
  response_ip_hash text, response_user_agent_hash text,
  send_count integer not null default 1 check (send_count between 1 and 5),
  last_sent_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- 'granted' ohne Einwilligungszeile waere eine Anfrage, die als erteilt
  -- erscheint, ohne dass etwas erteilt wurde. Beides entsteht in einer
  -- Transaktion; der CHECK ist die Sicherung dahinter.
  check ((status = 'granted') = (consent_record_id is not null)),
  check ((status in ('sent')) = (responded_at is null)),
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete cascade,
  -- restrict, nicht set null: der CHECK oben bindet status = 'granted' an eine
  -- vorhandene Einwilligungszeile. Ein SET NULL wuerde ihn verletzen und die
  -- Loeschung mit einer schwer lesbaren CHECK-Meldung scheitern lassen. Eine
  -- erteilte Einwilligung ist ohnehin ein Nachweis und wird nicht geloescht,
  -- sondern widerrufen oder abgeloest -- restrict sagt genau das.
  foreign key (organization_id, consent_record_id)
    references public.consent_records(organization_id, id) on delete restrict
);

create unique index consent_requests_open_unique
  on public.consent_requests (organization_id, directory_person_id, recipient_email)
  where status = 'sent';
```

`text_version` ist essenziell: der Nachweis einer digitalen Einwilligung besteht darin, **welchen Text** jemand bestätigt hat. Die Texte liegen versioniert im Repository und werden nie nachträglich geändert; eine Textänderung erzeugt eine neue Version, und alte Einwilligungen behalten ihre.

IP und User-Agent werden nur als Hash gespeichert — sie dienen als Indiz für die Abgabe, nicht zur Identifikation. Der Hash braucht einen serverseitigen Pfeffer, sonst ist er bei IPv4 trivial rückrechenbar.

Richtlinienfeld ergänzen (Paket 011):

```sql
alter table public.policy_settings add column consent_expires_on_leave boolean;
alter table public.policy_settings add column consent_validity_months integer check (consent_validity_months between 1 and 120);
```

## Umsetzung

### 1. Gate wirklich schließen

Die Kette ist heute vollständig vorhanden und nur nicht verbunden:

```text
face_regions.decision = 'consented' → consent_record_id (CHECK erzwingt es)
  → evaluateConsent(record, now, requiredConsent(post))
  → consentValid je Gesicht
  → evaluateMediaGate → blockers
  → assertApprovalSnapshot verweigert Freigabe
```

`requiredConsent(post)` leitet aus dem Beitrag ab, was gebraucht wird: Zielplattformen aus den geplanten Publikationen, `mediaKinds` aus den Derivaten, `contexts` aus dem `presetSlug`, `departmentIds` aus dem Beitrag, `namingAllowed` falls der Text einen Namen enthält.

Der letzte Punkt ist der schwierigste und wird bewusst einfach gelöst: enthält der Beitragstext den Vor- oder Nachnamen einer verknüpften Person, während `namingAllowed = false` gilt, entsteht ein Blocker mit genauer Fundstelle. Kein NLP, nur ein Namensabgleich gegen die verknüpften Personen. Falsch positive Treffer sind hinnehmbar, falsch negative nicht.

### Sensible Angaben im Text, nicht nur im Bild

Das Gate hängt bisher an Gesichtern. Ein Text kann aber ohne jedes Foto zu viel preisgeben: „Lisa M. (11) erzielte das Siegtor“, eine Handynummer für Rückfragen, eine Privatadresse als Treffpunkt, eine Krankheit als Ausfallgrund. Ein Verein veröffentlicht das nicht in böser Absicht, sondern weil beim Schreiben niemand daran denkt.

`SafetyFlagSchema` (`packages/contracts/src/index.ts:41`) kennt dafür bereits `sensitive_data`, `minor` und `missing_consent`. **Bestimmt wird keines davon.** `FakeContentGenerator` setzt ausschließlich `uncertain_fact` bei fehlenden Fakten (`packages/content-engine/src/index.ts:40`) — dieselbe Lücke wie bei `consentValid` vor diesem Paket: der Blocker existiert, der Wert entsteht nie.

Die Prüfung läuft zweistufig, weil beide Stufen unterschiedliche Fehler machen:

- **Regelbasiert und verbindlich**: Telefonnummern, E-Mail-Adressen, IBANs, Straße mit Hausnummer, Geburtsdaten und Namen verknüpfter Personen. Deterministisch, testbar, und blockiert die Freigabe bei `namingAllowed = false` oder fehlender Einwilligung.
- **Durch das Sprachmodell und beratend**: Alter in Verbindung mit einem Namen, Gesundheitsangaben, familiäre Verhältnisse, Schulzugehörigkeit — Dinge, die eine Regel nicht fasst. Das Modell setzt `sensitive_data` mit Fundstelle und Begründung; der Prüfer sieht einen Hinweis und entscheidet.

Die Aufteilung ist wichtig: ein Modell darf eine Freigabe nicht **erteilen**, und es darf sie auch nicht allein **verhindern** — beides würde eine Fehlklassifikation zur letzten Instanz machen. Was blockiert, ist eine Regel; was aufmerksam macht, ist das Modell. Der Hinweis wird beim Beitrag protokolliert, damit im Streitfall belegbar ist, dass gewarnt wurde.

Dass der eigene Beitragstext dafür an ein externes Modell geht, ist eine andere Lage als bei fremden Kommentaren (Paket 018): der Autor weiß, dass er das Werkzeug benutzt, der Verein ist Verantwortlicher, und der Zweck ist eng. Ein Auftragsverarbeitungsvertrag mit Trainingsausschluss ist trotzdem Voraussetzung, und die Prüfung gehört in den Worker, nicht in die API — der Text darf nicht durch einen Request-Log laufen.

`evaluateMediaGate` wird um drei Blocker erweitert: `consent_scope_mismatch`, `naming_not_allowed` und `sensitive_text_data`. `MediaGateBlockerSchema` (`packages/contracts/src/index.ts:79`) muss mit.

### 2. Registratur

- `POST /v1/consents` — Person aus dem Verzeichnis wählen oder pseudonym erfassen, Umfang strukturiert setzen, Freitext eingeben, Unterschriftsdatum, Unterzeichner und Rolle, Nachweisdatei hochladen. Ohne Nachweisdatei kein `paper`-Eintrag.
- Nachweise liegen in `raw-media` unter `organizations/<orgId>/consents/<consentId>/...`, damit die bestehende `storage_read_own_organization`-Policy greift (`202608020002:8-13`). Es sind private Dokumente mit Unterschriften — sie dürfen nie über eine dauerhafte URL erreichbar sein, nur über kurzlebige signierte Links, und jeder Zugriff wird auditiert.
- **Der Bucket muss dafür erst PDFs annehmen.** `raw-media` erlaubt heute nur `image/jpeg`, `image/png`, `image/webp` und `video/mp4` (`202608020002:3`). Eine eingescannte Papiererklärung ist aber in der Regel ein PDF, oft mehrseitig — ein Verein, der einen Stapel Erklärungen einscannt, bekommt PDFs und keine JPEGs. Diese Migration erweitert die MIME-Liste um `application/pdf`. Ohne diesen Schritt scheitert der Upload genau an dem Punkt, an dem das Paket seinen Nutzen hätte, und `Ohne Nachweisdatei kein 'paper'-Eintrag` würde bedeuten: keine Papiererklärung ist erfassbar.
- PDF ist ein aktives Format. Es wird nie an einen Browser als `inline` ausgeliefert, sondern ausschließlich als `Content-Disposition: attachment` mit `X-Content-Type-Options: nosniff` — dieselbe Überlegung wie beim SVG in Paket 009, nur mit weniger Aufwand, weil ein Nachweis nicht angezeigt, sondern heruntergeladen wird. Eine Sanitisierung findet nicht statt; das Original ist der Nachweis und bleibt unverändert.
- `POST /v1/consents/:id/revoke` — Widerruf mit Grund und Widerrufendem.
- `POST /v1/consents/:id/supersede` — neue Version mit geändertem Umfang.
- Massenerfassung: viele Vereine haben einen Stapel Papier. Ein Ablauf „Person wählen, Umfang aus Vorlage übernehmen, Datei anhängen, weiter zur nächsten Person“ ohne Formularwechsel ist hier mehr wert als jede andere Verfeinerung.

### 3. Digitaler Einwilligungsprozess

- `POST /v1/consent-requests` — für eine Person aus dem Verzeichnis, an `guardian_email` oder an die Person selbst bei Volljährigkeit. Umfang wird vom Verein vorgegeben, nicht vom Empfänger gewählt.
- Versand per E-Mail mit Rohtoken im Link; gespeichert wird nur der SHA-256-Hash.
- **Öffentliche Seiten ohne Konto**, in `apps/web` unter `/einwilligung/[token]`:
  - zeigt Verein, Person, den vollständigen Einwilligungstext in der aktuellen Version, den konkreten Umfang in verständlicher Sprache, Gültigkeitsdauer, Hinweis auf jederzeitige Widerrufbarkeit und die Kontaktdaten des Vereins
  - zwei Aktionen: zustimmen oder ablehnen. Kein vorausgewähltes Häkchen, keine Kopplung an etwas anderes — eine Einwilligung muss freiwillig, informiert und aktiv sein
  - bei Zustimmung entsteht ein `consent_records`-Eintrag mit `origin = 'digital'`, `guardian_confirmed` entsprechend, und die Anfrage wird `granted`
- `/einwilligung/widerruf/[token]` — dauerhafter Widerrufslink, der in **jeder** E-Mail steht und nach dem Widerruf noch bestätigt. Ein Widerruf, der schwerer ist als die Zustimmung, ist rechtlich angreifbar.
- Diese Seiten sind unauthentifiziert und damit die exponierteste Fläche des Systems. Notwendig: strenges Rate-Limit pro IP und pro Token, keine Aufzählbarkeit von Tokens, einheitliche Antwort für ungültig/abgelaufen/bereits beantwortet, kein Preisgeben weiterer Personendaten, keine Auflistung anderer Kinder, kein Indexieren durch Suchmaschinen.
- **Ehrliche Einordnung im Produkt**: ein E-Mail-Link belegt nicht die Identität des Erziehungsberechtigten. Der digitale Weg ist bequem und für viele Vereine ausreichend; er ist der Papiererklärung als Nachweis aber unterlegen. Die Oberfläche sagt das, statt Sicherheit zu suggerieren — der Verein soll entscheiden können, für welche Fälle er Papier verlangt.

### 4. Übernahme aus einem Quellsystem

Liefert eine Quelle aus Paket 014 einen Einwilligungsstatus, entsteht ein Eintrag mit `origin = 'imported'` und `source_id`.

Zwei Regeln, die nicht verhandelbar sind:

- Ein importierter Status **ohne** Nachweisdokument gilt als Hinweis, nicht als Nachweis. Er wird sichtbar als „Nachweis liegt im Quellsystem“ markiert und blockiert nicht, aber im Streitfall ist der Verein nachweispflichtig, nicht wir.
- Ein Import darf einen **Widerruf** setzen, aber niemals einen bestehenden Widerruf aufheben. Widerruf gewinnt immer, unabhängig von Zeitstempeln.

### 5. Widerrufsfolgen

Ein Widerruf löst eine Kette aus, umgesetzt als Trigger plus Workflow:

1. Trigger auf `consent_records`: bei gesetztem `revoked_at` werden alle `approval_requests` invalidiert, die über `post_media → media_derivatives → media_assets → face_regions` auf diese Einwilligung zeigen. Das Muster existiert bereits in `invalidate_approvals_for_media_change` (`202608030001:110-111`).
2. Alle betroffenen Posts mit Status vor `published` gehen auf `changes_requested`. Der bestehende Statusautomat erlaubt diesen Übergang aus `awaiting_approval` (`packages/domain/src/index.ts:28`).
3. Geplante, noch nicht ausgeführte `publications` werden `cancelled`.
4. Bereits veröffentlichte Beiträge werden in einer Liste „Prüfung nach Widerruf“ geführt, mit Permalink und der Aktion „auf der Plattform entfernen“. **Automatisches Löschen fremder Inhalte findet nicht statt** — `SocialPublisher.delete` ist optional (`packages/publishing/src/index.ts:8`), und ein Verein muss diese Entscheidung selbst treffen. Die Frist dafür gehört in eine Richtlinie.
5. Alle Schritte erzeugen `audit_events` mit gemeinsamer `correlation_id`.

Ein täglicher Cron behandelt Ablauf statt Widerruf: Einwilligungen, die in 30 Tagen ablaufen, erscheinen als Aufgabe; abgelaufene wirken wie widerrufen für neue Verwendung.

### 6. Oberfläche

Neue Seite `pages/einwilligungen.vue`:

- Übersicht nach Abteilung und Team: je Person Status als Ampel — gültig, fehlt, läuft ab, widerrufen, nur Hinweis aus Quellsystem
- Filter „Minderjährige ohne Einwilligung“ als Startansicht. Das ist die Frage, mit der ein Verein diese Seite öffnet.
- Aktionen: Erklärung hinterlegen, digital anfragen, Umfang ansehen, widerrufen, Nachweis öffnen
- Bereich offene Anfragen mit Status, Ablauf, erneut senden
- Bereich „Prüfung nach Widerruf“ mit veröffentlichten Beiträgen

Im Medien-Review (Paket 002/003) wird je Gesichtsregion die Zuordnung zu einer Person aus dem Verzeichnis möglich; das System zeigt sofort, ob eine passende Einwilligung existiert, und schlägt bei fehlender Einwilligung Verdecken oder Ausschließen vor.

**`pages/freigaben.vue` (kein Rückbau, sondern Erweiterung — siehe Korrektur oben):** Paket 011 hat die Seite bereits auf echte Daten umgestellt. `ApprovalStage`/`ApprovalStageSchema` (`packages/contracts`) werden um eine Blocker-Liste ergänzt, die `GET /v1/approval-stages/mine` aus `evaluateMediaGate` befüllt (inklusive der drei neuen Consent-Blocker `consent_scope_mismatch`, `naming_not_allowed`, `sensitive_text_data`); die Karte zeigt sie zusätzlich zu `isMinorStage` an.

### 7. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `consent_records.scope` | reiner Freitext | bleibt als Wiedergabe, ergänzt um prüfbares `scope_structured` |
| `evaluateMediaGate` `consentValid` | nie befüllt | aus `evaluateConsent` |
| `GET /v1/approval-stages/mine` | keine Blocker-Information, `evaluateMediaGate` wird hier nicht aufgerufen | liefert Blocker-Liste je Stufe, `freigaben.vue` zeigt sie an |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests für `evaluateConsent`: jeder Blocker einzeln; Umfangsprüfung für Plattform, Zweck, Medienart, Kontext, Abteilung; Grenzfälle an `valid_from` und `valid_until`; Widerruf gewinnt gegen jede Gültigkeit; **eine abgelöste Zeile ist nie gültig, auch wenn sie sonst jede Prüfung bestehen würde, und die Nachfolgerzeile mit engerem Umfang blockiert**; `person_left` je nach Richtlinie.
- Gate-Tests: Bild mit Kind ohne Einwilligung ist nicht freigebbar; mit gültiger Einwilligung freigebbar; mit Einwilligung nur für Facebook ist ein Instagram-Beitrag nicht freigebbar; bei `namingAllowed = false` blockiert ein Name im Text.
- Textprüfung: Telefonnummer, E-Mail, IBAN und Straße mit Hausnummer werden regelbasiert erkannt und blockieren; ein Beitrag **ohne** Foto, aber mit „Lisa M. (11)“ ist bei `namingAllowed = false` nicht freigebbar — das Gate hängt nicht an der Existenz eines Bildes; das Sprachmodell setzt `sensitive_data` mit Fundstelle, blockiert aber nicht allein; ein Modellausfall lässt die regelbasierte Prüfung unberührt und wird als Hinweis „nicht geprüft“ sichtbar, nicht als „unbedenklich“.
- Der Beitragstext erscheint in keinem Request-Log der API (Prüfung an `redact` analog Paket 018).
- pgTAP: Einwilligung mit `signer_role = 'guardian'` ohne `guardian_confirmed` verstößt gegen CHECK; `face_regions` mit `decision = 'consented'` ohne `consent_record_id` verstößt gegen den bestehenden CHECK; Widerruf invalidiert die verknüpfte `approval_request`; zweite offene Anfrage für gleiche Person und Adresse verstößt gegen den Unique-Index; `status = 'granted'` ohne `consent_record_id` verstößt gegen CHECK; `status = 'sent'` mit gesetztem `responded_at` verstößt gegen CHECK und `status = 'declined'` ohne `responded_at` ebenso; eine zweite Zeile, die dieselbe Einwilligung ablöst, verstößt gegen den Unique-Index; eine Einwilligung, die sich selbst ablöst, verstößt gegen CHECK; `source_id` bei `origin = 'paper'` verstößt gegen CHECK; eine Quelle aus einem **fremden** Verein als `source_id` verstößt gegen den zusammengesetzten Fremdschlüssel.
- pgTAP zum Löschverhalten: Löschen der ablösenden Einwilligung lässt die abgelöste bestehen und setzt nur `superseded_by` auf `null`, `organization_id` bleibt gesetzt; eine Einwilligung mit erteilter Anfrage ist **nicht** löschbar (`restrict`) — die Anfrage bleibt beweiskräftig; Löschen der Quelle einer importierten Einwilligung setzt nur `source_id` und behält `origin = 'imported'`.
- Sicherheitstests für die öffentlichen Seiten: ungültiges, abgelaufenes und schon beantwortetes Token liefern **dieselbe** Antwort; Rate-Limit greift; die Seite gibt außer der betroffenen Person und dem Vereinsnamen keine Daten preis; `noindex` gesetzt.
- manuell: Papiererklärung hinterlegen, Kind auf einem Bild zuordnen, Beitrag wird freigebbar; Widerruf auslösen, offene Freigabe verschwindet, geplante Publikation wird storniert, veröffentlichter Beitrag erscheint in der Prüfliste.

## Risiken und offene Entscheidungen

- **Nachweiswert des digitalen Wegs**: Ein Klick auf einen E-Mail-Link identifiziert niemanden. Für die Veröffentlichung von Kinderfotos ist das ein bewusst akzeptiertes Restrisiko des Vereins. Die Formulierung in der Oberfläche und in den Rechtstexten (Paket 020) muss das klar sagen. Eine stärkere Variante wäre eine Bestätigung durch zwei getrennte Kanäle — deutlich mehr Aufwand für alle Beteiligten.
- ~~**Einwilligungstext** ist ein Rechtsdokument...~~ **Entschieden (2026-08-08): pro Verein editierbar.** Vorlage (`DEFAULT_CONSENT_TEXT_TEMPLATE`, `apps/api/src/app.ts`) bereitgestellt, ein Verein darf sie durch eine eigene Fassung ersetzen (`organization_consent_texts`, nie ein UPDATE — jede Änderung legt eine neue, unveränderliche Zeile an, deren `id` als `text_version` dient). Anwaltliche Prüfung der Vorlage bleibt Voraussetzung vor dem Produktivgang, siehe unten.
- **Einwilligung ist nicht immer die richtige Rechtsgrundlage.** Für Vereinsberichterstattung kommt teils ein berechtigtes Interesse in Betracht, bei Kindern praktisch nie. Das System kennt bewusst nur den Einwilligungspfad, weil er der belastbare ist. Wer sich auf eine andere Grundlage stützen will, muss das außerhalb dokumentieren — das gehört in Paket 020 und darf nicht als Umgehung des Gates umgesetzt werden.
- **Widerruf und veröffentlichte Inhalte**: Löschen auf der Plattform bleibt eine menschliche Entscheidung. Ein Verein, der nicht reagiert, hat ein Problem, das Software nicht löst. Die Prüfliste mit Frist und Erinnerung ist das Maximum an sinnvoller Unterstützung.
- **Reihenfolge**: dieses Paket setzt Paket 014 voraus, weil die Personenzuordnung dort entsteht. Der Registratur-Teil funktioniert auch rein pseudonym und könnte vorgezogen werden — dann fehlen ihm aber die Filter, die ihn nützlich machen.
- ~~**Aufbewahrung von Einwilligungsnachweisen**...~~ **Entschieden (2026-08-08): 5 Jahre ab Ende der Gültigkeit (Plan-Vorschlag übernommen).** Diese Sitzung setzte die Frist noch nicht technisch durch; Paket 020 setzt sie inzwischen mit einem manuell auslösbaren Retention-Lauf durch. Paket 004 liefert den technischen Outbox-/Worker-Unterbau, eine wiederkehrende fachliche Scheduler-Registrierung bleibt separat.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt auf Branch `worktree-plan-015-einwilligungsverwaltung`. Migration `2026080801_consent_management.sql` (Zeitstempel folgt der nächsten freien Zeitscheibe nach `2026080704`, gleiches Muster wie bei 011/012/013/014/019 dokumentiert). Neue Domain-Datei `packages/domain/src/consent.ts`.

### Datenmodell — zusätzlich zum Plan-DDL

- **`consent_records.revocation_token_hash`** (nicht im Plan-DDL, aber notwendig): der dauerhafte Widerrufslink aus Abschnitt 3 braucht einen von der Anfrage unabhängigen, langlebigen Token. `consent_requests.token_hash` ist einmalig und endet mit der Beantwortung; der Widerrufstoken entsteht deshalb erst beim Erteilen (`POST /v1/consent-requests/by-token/:token/respond`) und wird direkt auf der Bestätigungsseite gezeigt — **nicht** zusätzlich per E-Mail nachgeschickt, da keine Erinnerungs-Mail-Infrastruktur existiert. CHECK erzwingt `origin = 'digital'` dafür.
- **`organization_consent_texts`** (neue Tabelle, siehe Entscheidung oben): vereinsweit lesbar (`is_any_member_of_organization`), schreibbar nur über `PUT /v1/organizations/:id/consent-text` mit `organization.manage` (Vereinsebene, nicht Abteilung — ein Rechtstext ist vereinsweit einheitlich).
- **`consent_requests.department_id`**: im Plan nicht explizit als eigene Spalte geführt, hier denormalisiert aus `directory_people.department_id` angelegt, damit die RLS-Select-Policy ohne Join auf `directory_people` auskommt (vermeidet dieselbe Fundklasse wie „RLS-Unterabfrage eigene Policy“, memory).
- **`policy_settings.consent_expires_on_leave`/`consent_validity_months`**: wie geplant, aber mit geklärter Vererbungssemantik (siehe unten).

### Vererbungssemantik der zwei neuen Policy-Felder — beim Bauen geklärt

Der Plan nennt nur die Spalten, nicht das Vererbungsmuster. Verifiziert gegen `packages/domain/src/index.ts` (`mergeEffectiveConfig`) und `apps/api/src/app.ts` (`computeRuleEntry`):

- **`consentExpiresOnLeave`** folgt dem OR-Verschärfungsmuster von `mediaRequiresConsentCheck` (sobald irgendeine Ebene es verlangt, gilt es) — nicht dem älteren AND-Muster von `authz.resolve_policy_flag` (023), das nur die zwei ursprünglichen Flags kennt und hier nicht erweitert wurde.
- **`consentValidityMonths`** folgt dem knotenlokalen Muster von `reviewMinimumApprovals` (`own` = `effective` in der Policy-Anzeige, keine Ebenen-Vererbung) — für die tatsächliche Vorbelegung neuer Einwilligungen gibt es eine **eigene** kleine Abteilung-vor-Verein-Rückfallkette (`resolveConsentValidityMonths`), getrennt von der generischen Policy-Anzeige.

### Sicherheitsfund beim eigenen adversarialen Review, vor Abschluss behoben

**Minderjährige konnten sich digital selbst einwilligen.** `evaluateConsent`s `guardian_missing`-Blocker prüft ausschließlich `signerRole === 'guardian'` — bei `signerRole: 'self'` greift er nie, unabhängig davon, ob die Person tatsächlich minderjährig ist. `POST /v1/consent-requests` übernahm `recipientRole` ungeprüft vom Aufrufer in `consent_records.signer_role`/`guardian_confirmed`; eine (versehentliche oder böswillige) Anfrage mit `recipientRole: 'self'` an eine minderjährige Person hätte nach Zustimmung eine als vollständig gültig geltende Einwilligung ohne jede Erziehungsberechtigten-Bestätigung erzeugt — Widerspruch zum Grundsatz „Keine Befreiung entfällt die Minderjährigenstufe“ (`plans/README.md`). Behoben an drei Stellen, die alle denselben Fehler machen könnten: `POST /v1/consents` (Registratur), `POST /v1/consent-requests` (digitale Anfrage), `POST /v1/consents/:id/supersede` (Ablösung) — jede prüft jetzt `directory_people.is_minor` gegen den gewählten `signerRole`/`recipientRole` und antwortet mit `400 guardian_required_for_minor`. **Bewusst nur anwendungsseitig, nicht als DB-CHECK**: die Regel ist ein Cross-Table-Vergleich (`consent_records.signer_role` gegen `directory_people.is_minor`), den ein CHECK-Constraint nicht ausdrücken kann; ein Trigger wäre möglich, wurde aber nicht gebaut, weil alle drei Schreibpfade ohnehin ausschließlich über die API mit denselben Prüfungen laufen (kein `INSERT`/`UPDATE`-Grant für `authenticated` auf `consent_records`). Zwei API-Tests decken das ab.

### Nachträglich gefundener Cascade-Delete-Fehler, behoben (2026-08-11)

`organization_consent_texts_immutable` war als `before update or delete` angelegt. Damit
blockierte der Trigger auch die reguläre `on delete cascade`-Kaskade von
`organization_consent_texts.organization_id` auf `organizations(id)`: Das Löschen einer
Organisation schlug fehl, sobald mindestens ein Einwilligungstext existierte. Der im
CodeRabbit-Review zu PR #40 zunächst auch in Paket 032 gefundene Fehler wurde dort mit Commit
`6d49b08f` behoben und ist hier nun gleich behandelt: Der Trigger feuert nur noch auf `before
update`; die Löschsemantik liegt beim Fremdschlüssel. `authenticated` besitzt weiterhin kein
Löschrecht auf der Tabelle. Zwei pgTAP-Assertions legen einen separaten Verein mit Einwilligungstext
an, löschen ihn und prüfen die erfolgreiche Kaskade einschließlich der entfernten Textzeile. Geprüft
(2026-08-11): keine weitere Migration verwendet denselben `before update or delete`-Zuschnitt.

### Bewusst vereinfacht/aufgeschoben

- **Übernahme aus einem Quellsystem (Plan Abschnitt 4, `origin = 'imported'`) ist nicht gebaut.** Schema trägt `source_id`/`origin = 'imported'` bereits (analog zu 014s Vorgehen bei anderen Domänen), aber kein Endpunkt und kein Sync-Adapter erzeugt solche Zeilen. Fehlt: ein dokumentiertes Zielsystem mit Testzugang für Einwilligungsstatus — dieselbe Einschränkung wie beim HTTP-Adapter in Paket 014. Nächster Schritt für ein künftiges Paket.
- **Verknüpfte Personen für die Namensprüfung kommen ausschließlich aus einwilligungsgeprüften Gesichtern der Medien eines Beitrags** (`computeMediaGateBlockersForPostVersion`, `apps/api/src/app.ts`). Ein rein textlicher Beitrag, der eine Person nennt, ohne dass ein Foto dieser Person am selben Beitrag hängt, kann diese Person nicht als „verknüpft“ erkennen — es gibt keine andere Verknüpfung von Beitragstext zu einer konkreten Person im Schema. Das genau von der Verifikation in Abschnitt „Textprüfung“ verlangte Szenario („ein Beitrag ohne Foto, aber mit ‚Lisa M. (11)‘“) ist mit `evaluateConsent`/`scanTextForSensitiveData` als **Funktion** korrekt und getestet (siehe `domain.test.ts`), aber in der **API-Verdrahtung** von `GET /v1/approval-stages/mine` nicht erreichbar, weil die Quelle der „verknüpften Personen“ dort strukturell photo-gebunden ist. Eine Schließung bräuchte eine neue, bisher nicht vorgesehene Verknüpfung von `submissions`/`post_versions` zu `directory_people` unabhängig von Medien.
- **`minorReviewConfirmed` ist in der Gate-Verdrahtung bewusst immer `false`.** Der eigentliche Minderjährigenschutz läuft seit Paket 011 über `approval_stages.is_minor_stage` (eine unbefreibare Freigabestufe) — dieser Blocker ist eine zusätzliche, informative Erinnerung in derselben Kartenansicht, keine zweite Durchsetzung. Die beiden Mechanismen wurden nicht zusammengeführt.
- **`GET /v1/post-versions/:id/approval` zeigt keine echten Medien-Gate-Blocker** (`mediaGateBlockers: []` fest), anders als `GET /v1/approval-stages/mine`. Nur Letzteres speist `freigaben.vue`; eine Vereinheitlichung ist ein möglicher, hier nicht gebauter nächster Schritt.
- **Rate-Limit der öffentlichen Endpunkte ist ein In-Prozess-Zähler**, keine neue Abhängigkeit (`@fastify/rate-limit`). Ausreichend für einen einzelnen API-Prozess; ein mehrknotiges Produktions-Deployment braucht einen gemeinsamen Speicher (Redis). Der Token selbst ist mit 256 Bit ohnehin nicht praktikabel erratbar — das Rate-Limit ist zusätzliche Tiefenverteidigung, keine alleinige Schutzmaßnahme.
- **Massenerfassung** (Plan Abschnitt 2: „Person wählen, Umfang aus Vorlage übernehmen, Datei anhängen, weiter zur nächsten Person ohne Formularwechsel“) ist nicht gebaut — die Oberfläche registriert eine Person pro Formularabsendung. Ein Verein mit einem Stapel Papiererklärungen füllt das Formular heute mehrfach neu aus.
- **Kein Cron für „läuft in 30 Tagen ab“** und keine proaktive automatische Benachrichtigung — dieselbe Einschränkung wie bei `mark_stalled_approval_stages()` (011), `recompute_directory_minor_status()` (014) und den Anlassvorschlägen (019): Paket 004 liefert den technischen Outbox-/Worker-Unterbau, die konkrete periodische Verdrahtung fehlt. Die Aufbewahrungslöschung wird dagegen seit Paket 020 durch den manuell auslösbaren Retention-Lauf durchgesetzt. `evaluateConsent`/`computeConsentRecordStatus` berechnen `expiring_soon`/`expired` live bei jedem Aufruf statt über einen Job — funktional gleichwertig für die Anzeige, nur ohne proaktive Benachrichtigung.
- **Kein CROSS-TENANT-pgTAP-Test speziell für `invalidate_approvals_for_consent_revocation`.** Jeder Join im Trigger ist mit `organization_id` qualifiziert (korrekt durch Konstruktion, gleiches Muster wie die beiden Vorbild-Trigger), aber anders als bei den reinen CHECK-/RLS-Tests wurde kein Test geschrieben, der eine Einwilligung in Verein A widerruft und explizit prüft, dass Verein Bs `approval_requests` unberührt bleiben. Dokumentierte Lücke statt stillschweigend übersprungen.
- **Textprüfung nutzt kein Sprachmodell** (Plan Abschnitt „Sensible Angaben im Text“, zweite Stufe: „durch das Sprachmodell und beratend“ für `sensitive_data`). Nur die regelbasierte, blockierende Stufe (`scanTextForSensitiveData`) ist gebaut. `FakeContentGenerator` setzt weiterhin ausschließlich `uncertain_fact` — dieselbe vorbestehende Lücke wie vor diesem Paket, hier nicht geschlossen, weil sie einen echten LLM-Adapter-Aufruf im Worker bräuchte (Content-Pipeline 001–007 fehlt weiterhin).

### Testabdeckung

- `packages/domain`: 32 neue Tests (`evaluateConsent` je Blocker einzeln inkl. Ablösungskette, `scanTextForSensitiveData` inkl. Foto-loser Namensnennung, `evaluateMediaGate`-Erweiterung inkl. Rückwärtskompatibilität, `mergeEffectiveConfig` für `consentExpiresOnLeave`) — 94 Tests insgesamt im Package.
- `apps/api`: 15 neue Tests (Registratur-Validierung inkl. MIME/Pseudonym-Exklusivität, Widerruf inkl. 404/409, Ablösung, Einwilligungstext-Verwaltung, öffentliche Endpunkte inkl. Nichtunterscheidbarkeit ungültig/beantwortet, `X-Robots-Tag`, Rate-Limit, die drei Minderjährigen-Guards) — 183 Tests insgesamt, keine Regression an den bestehenden 168.
- `supabase/tests/consent_management.test.sql`: 30 pgTAP-Assertions (CHECK-Constraints inkl. Selbstablösung und Origin/Source-Kopplung, RLS inkl. Fremdverein-Ausschluss für `consent_requests`/`organization_consent_texts`, `consent.manage` in `has_department_permission`/`has_organization_permission`, erfolgreiche Organisationslöschung mit kaskadiertem Einwilligungstext, die volle Widerrufskaskade über einen per SQL nachgestellten Beitragspfad — inklusive Nutzprobe des in diesem Paket behobenen Bugs in `invalidate_approvals_for_media_change` —, Löschverhalten `restrict`/`set null`) — 546 pgTAP-Tests insgesamt, 17 Dateien.
- Manueller Browser-Test (Paket-Definition-of-Done, `run-web`-Muster, frisches `.env` im Worktree, danach gelöscht): Papiererklärung für eine erwachsene Person hinterlegen (funktioniert), derselbe Versuch mit `signerRole: 'self'` für eine minderjährige Person (korrekt abgelehnt, Konsens-Liste bleibt bei „ohne gültige Einwilligung“), digitale Anfrage an eine Erziehungsberechtigte senden, öffentliche Seite öffnen (Text/Umfang korrekt angezeigt), zustimmen (Bestätigung inkl. Widerrufslink), denselben Anfrage-Token erneut aufrufen (identische generische Fehlermeldung, keine Unterscheidbarkeit), Widerrufslink öffnen und bestätigen (wirkt, erneuter Aufruf idempotent), Widerruf einer Papier-Einwilligung über die Vereinsoberfläche, `freigaben.vue`/`einstellungen.vue` ohne Konsolenfehler.
- Gesamt reproduzierbar grün: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `pnpm db:reset && pnpm db:test`.
