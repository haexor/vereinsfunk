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
- `apps/web/app/pages/freigaben.vue:94-97` behauptet in einer Karte „Minderjährige · Einwilligung geprüft“ als hartkodierten Text. Es gibt nichts, was das prüft.
- Der Trigger `invalidate_approvals_for_media_change` (`202608030001:110-111`) invalidiert Freigaben bei Änderung eines Derivats. Das Muster für „Widerruf invalidiert Freigaben“ ist damit vorhanden und wird übernommen.

## Scope

- Migration: Einwilligungsumfang strukturieren, digitale Anfragen, Nachweise, Widerrufspfad, Herkunft
- `packages/domain`: Gültigkeitsauswertung, Umfangsprüfung, Widerrufsfolgen
- API: Registratur, Anfrage, Bestätigung, Widerruf, Gate-Auswertung
- öffentlicher Bestätigungs- und Widerrufspfad ohne Konto
- Übernahme eines Einwilligungsstatus aus einem Quellsystem als Nachweisquelle
- Nuxt: Einwilligungsübersicht, Zuordnung im Medien-Review, echte Anzeige in Freigaben
- Rückbau der Freigabe-Dummies

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

Blocker: `revoked`, `not_yet_valid`, `expired`, `guardian_missing`, `purpose_not_covered`, `platform_not_covered`, `media_kind_not_covered`, `context_not_covered`, `department_not_covered`, `person_left`.

`person_left` ist der Grund, warum Paket 014 vorausgeht: verlässt eine Person den Verein, ist die Grundlage für weitere Veröffentlichung in der Regel entfallen. Ob dies eine Einwilligung automatisch beendet, ist eine bewusste Vereinsentscheidung und wird als Richtlinie in `policy_settings` abgebildet (`consent_expires_on_leave boolean`), nicht fest verdrahtet. Bereits veröffentlichte Beiträge werden davon nicht rückwirkend rechtswidrig, aber neue Verwendung wird blockiert.

## Datenmodell

Migration `2026080408_consent_management.sql`:

```sql
alter table public.consent_records
  add column scope_structured jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scope_structured) = 'object'),
  add column origin text not null default 'paper'
    check (origin in ('paper','digital','imported')),
  add column source_id uuid,                        -- bei origin = 'imported'
  add column signed_at date,
  add column signer_name text,
  add column signer_role text check (signer_role in ('self','guardian')),
  add column revoked_by text check (revoked_by in ('self','guardian','organization')),
  add column revocation_reason text,
  add column superseded_by uuid;

alter table public.consent_records add constraint consent_records_superseded_fk
  foreign key (organization_id, superseded_by)
  references public.consent_records(organization_id, id) on delete set null;

-- Minderjährige brauchen eine bestätigte Erziehungsberechtigung.
alter table public.consent_records add constraint consent_records_guardian_check
  check (signer_role is distinct from 'guardian' or guardian_confirmed);
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
  foreign key (organization_id, directory_person_id)
    references public.directory_people(organization_id, id) on delete cascade,
  foreign key (organization_id, consent_record_id)
    references public.consent_records(organization_id, id) on delete set null
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

```
face_regions.decision = 'consented' → consent_record_id (CHECK erzwingt es)
  → evaluateConsent(record, now, requiredConsent(post))
  → consentValid je Gesicht
  → evaluateMediaGate → blockers
  → assertApprovalSnapshot verweigert Freigabe
```

`requiredConsent(post)` leitet aus dem Beitrag ab, was gebraucht wird: Zielplattformen aus den geplanten Publikationen, `mediaKinds` aus den Derivaten, `contexts` aus dem `presetSlug`, `departmentIds` aus dem Beitrag, `namingAllowed` falls der Text einen Namen enthält.

Der letzte Punkt ist der schwierigste und wird bewusst einfach gelöst: enthält der Beitragstext den Vor- oder Nachnamen einer verknüpften Person, während `namingAllowed = false` gilt, entsteht ein Blocker mit genauer Fundstelle. Kein NLP, nur ein Namensabgleich gegen die verknüpften Personen. Falsch positive Treffer sind hinnehmbar, falsch negative nicht.

`evaluateMediaGate` wird um zwei Blocker erweitert: `consent_scope_mismatch` und `naming_not_allowed`. `MediaGateBlockerSchema` (`packages/contracts/src/index.ts:132`) muss mit.

### 2. Registratur

- `POST /v1/consents` — Person aus dem Verzeichnis wählen oder pseudonym erfassen, Umfang strukturiert setzen, Freitext eingeben, Unterschriftsdatum, Unterzeichner und Rolle, Nachweisdatei hochladen. Ohne Nachweisdatei kein `paper`-Eintrag.
- Nachweise liegen in `raw-media` unter `organizations/<orgId>/consents/<consentId>/...`, damit die bestehende `storage_read_own_organization`-Policy greift (`202608020002:8-13`). Es sind private Dokumente mit Unterschriften — sie dürfen nie über eine dauerhafte URL erreichbar sein, nur über kurzlebige signierte Links, und jeder Zugriff wird auditiert.
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
4. Bereits veröffentlichte Beiträge werden in einer Liste „Prüfung nach Widerruf“ geführt, mit Permalink und der Aktion „auf der Plattform entfernen“. **Automatisches Löschen fremder Inhalte findet nicht statt** — `SocialPublisher.delete` ist optional (`packages/publishing/src/index.ts:275`), und ein Verein muss diese Entscheidung selbst treffen. Die Frist dafür gehört in eine Richtlinie.
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

### 7. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/freigaben.vue:94-97` | zwei erfundene Beiträge, „Minderjährige · Einwilligung geprüft“ als Text, `image`-Feld mit Fantasietext, `color`-Feld | echte offene Freigaben aus `approval_requests`, echte Blocker aus `evaluateMediaGate`, echte Medienvorschau |
| `pages/freigaben.vue:98,103` | `approved`-Array im lokalen State, Freigabe ohne Serveraufruf | `approval_decisions`-Insert über die API, echter Mehrfach-Freigabe-Zähler |
| `consent_records.scope` | reiner Freitext | bleibt als Wiedergabe, ergänzt um prüfbares `scope_structured` |
| `evaluateMediaGate` `consentValid` | nie befüllt | aus `evaluateConsent` |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests für `evaluateConsent`: jeder Blocker einzeln; Umfangsprüfung für Plattform, Zweck, Medienart, Kontext, Abteilung; Grenzfälle an `valid_from` und `valid_until`; Widerruf gewinnt gegen jede Gültigkeit; `person_left` je nach Richtlinie.
- Gate-Tests: Bild mit Kind ohne Einwilligung ist nicht freigebbar; mit gültiger Einwilligung freigebbar; mit Einwilligung nur für Facebook ist ein Instagram-Beitrag nicht freigebbar; bei `namingAllowed = false` blockiert ein Name im Text.
- pgTAP: Einwilligung mit `signer_role = 'guardian'` ohne `guardian_confirmed` verstößt gegen CHECK; `face_regions` mit `decision = 'consented'` ohne `consent_record_id` verstößt gegen den bestehenden CHECK; Widerruf invalidiert die verknüpfte `approval_request`; zweite offene Anfrage für gleiche Person und Adresse verstößt gegen den Unique-Index.
- Sicherheitstests für die öffentlichen Seiten: ungültiges, abgelaufenes und schon beantwortetes Token liefern **dieselbe** Antwort; Rate-Limit greift; die Seite gibt außer der betroffenen Person und dem Vereinsnamen keine Daten preis; `noindex` gesetzt.
- manuell: Papiererklärung hinterlegen, Kind auf einem Bild zuordnen, Beitrag wird freigebbar; Widerruf auslösen, offene Freigabe verschwindet, geplante Publikation wird storniert, veröffentlichter Beitrag erscheint in der Prüfliste.

## Risiken und offene Entscheidungen

- **Nachweiswert des digitalen Wegs**: Ein Klick auf einen E-Mail-Link identifiziert niemanden. Für die Veröffentlichung von Kinderfotos ist das ein bewusst akzeptiertes Restrisiko des Vereins. Die Formulierung in der Oberfläche und in den Rechtstexten (Paket 020) muss das klar sagen. Eine stärkere Variante wäre eine Bestätigung durch zwei getrennte Kanäle — deutlich mehr Aufwand für alle Beteiligten.
- **Einwilligungstext** ist ein Rechtsdokument. Er sollte vor dem Produktivgang geprüft werden. Vorlage bereitstellen, aber dem Verein die Anpassung erlauben — dann wird `text_version` pro Verein geführt, nicht global. Diese Entscheidung ist offen und beeinflusst das Datenmodell.
- **Einwilligung ist nicht immer die richtige Rechtsgrundlage.** Für Vereinsberichterstattung kommt teils ein berechtigtes Interesse in Betracht, bei Kindern praktisch nie. Das System kennt bewusst nur den Einwilligungspfad, weil er der belastbare ist. Wer sich auf eine andere Grundlage stützen will, muss das außerhalb dokumentieren — das gehört in Paket 020 und darf nicht als Umgehung des Gates umgesetzt werden.
- **Widerruf und veröffentlichte Inhalte**: Löschen auf der Plattform bleibt eine menschliche Entscheidung. Ein Verein, der nicht reagiert, hat ein Problem, das Software nicht löst. Die Prüfliste mit Frist und Erinnerung ist das Maximum an sinnvoller Unterstützung.
- **Reihenfolge**: dieses Paket setzt Paket 014 voraus, weil die Personenzuordnung dort entsteht. Der Registratur-Teil funktioniert auch rein pseudonym und könnte vorgezogen werden — dann fehlen ihm aber die Filter, die ihn nützlich machen.
