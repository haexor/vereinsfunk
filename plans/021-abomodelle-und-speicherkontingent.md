# 021 – Abomodelle, Speicherkontingent und Nutzungsgrenzen

## Ergebnis

Ein Verein weiß, was sein Tarif erlaubt und wie viel davon er verbraucht hat: Speicher in Gigabyte, Beiträge pro Tag, Anzahl Mannschaften. Der kostenlose Tarif reicht, um das Produkt ernsthaft auszuprobieren; wer mehr braucht, wechselt. Der Verein kann seinen Speicher außerdem selbst auf Abteilungen und Mannschaften aufteilen, damit eine Abteilung mit Videoambitionen nicht den Platz des ganzen Vereins verbraucht. Tarife, Preise und Grenzen sind Daten, keine Konstanten im Code — sie lassen sich anpassen, ohne zu deployen, und im Einzelfall übersteuern.

Läuft der Speicher voll, löscht das System nichts. Es sagt, was Platz belegt, und blockiert neue Uploads.

## Ausgangslage und Evidenz

Geplant auf `a77904a0` am 2026-08-05.

- Es gibt **keinen Tarif, kein Kontingent und keine Nutzungsmessung.** Kein Schema, kein Endpunkt, keine Anzeige.
- Die Abrechnungsgrundlage für Speicher existiert dagegen vollständig: `media_assets.byte_size` und `media_derivatives.byte_size` sind `bigint not null check (byte_size > 0)` (`202608030001:21-32`, `:50-58`), und `brand_assets.byte_size` legt Paket 013 in derselben Form an. Es muss nichts nachgemessen werden.
- Die drei Buckets haben je ein `file_size_limit` — 100 MB für `raw-media`, 500 MB für `rendered-media`, 20 MB für `brand-assets` (`202608020002:3-5`). Das begrenzt **eine Datei**, nicht die Summe eines Vereins. Ein Verein kann heute unbegrenzt viele 100-MB-Videos hochladen.
- `public.organizations` (`202608020001:32-39`) kennt `name`, `slug`, `timezone` — keinen Tarif, keinen Vertragsstand.
- `packages/authorization` hat bereits eine Rolle `billing_admin` (siehe Rollenliste in Paket 010), die bisher keine eigenen Permissions trägt. Der Platz für Tarifverwaltung ist also vorgesehen und leer.
- Paket 011 bringt `channel_quotas` mit `max_publications` je Periode und Scope, inklusive Vererbung „nur verschärfen“ und einer atomaren Prüfung. **Die Beitragsgrenze eines Tarifs ist genau dieselbe Mechanik** und wird nicht zweimal gebaut.
- Paket 020 bringt `retention_settings` und den `enforce-retention`-Cron. Aufbewahrungsfristen sind das einzige Mittel, mit dem ein Verein wieder Platz gewinnt, ohne von Hand zu löschen — beide Pakete gehören zusammen gedacht.
- Paket 010 legt Abteilungen und Mannschaften an. Die Grenze „ein Team“ im kostenlosen Tarif wird dort durchgesetzt, nicht hier.

## Scope

- Migration: Tarifdefinitionen als Daten, Tarifzuordnung je Verein mit Übersteuerung, Speicherunterlimits je Abteilung und Mannschaft, Nutzungsmessung
- `packages/domain`: Tarifauflösung und Kontingentprüfung als reine Funktionen
- Durchsetzung im Upload-Pfad, bei der Teamanlage und beim Einplanen
- Nutzungsanzeige je Verein, Abteilung und Mannschaft
- Endpunkte für Tarifwechsel und für die operative Übersteuerung
- Benachrichtigung bei Erreichen der Warnschwelle

Nicht enthalten: **Zahlungsabwicklung.** Zahlungsdienstleister, Rechnungsstellung, Umsatzsteuer, Mahnwesen und Kündigungsfristen sind ein eigenes Vorhaben mit eigenen Entscheidungen — siehe „Risiken und offene Entscheidungen“. Dieses Paket bringt das Produkt in einen Zustand, in dem Tarife wirken; es kassiert nicht.

Ebenfalls nicht enthalten: Bandbreiten- oder Rechenzeitkontingente, Mehrwährungsfähigkeit, Rabatte und Gutscheine.

## Fachliches Modell

### Der Tarif ist eine Obergrenze, keine Einstellung

> Der Tarif setzt das Maximum. Verein, Abteilung und Mannschaft dürfen ausschließlich darunter bleiben. Keine untere Ebene erweitert ein Tariflimit.

Das ist bewusst dieselbe Richtung wie die Vererbung in Paket 011, und aus demselben Grund: es gibt genau eine Stelle, an der eine Grenze entsteht, und alle weiteren können sie nur verschärfen. Ein Abteilungsadmin, der sich mehr Speicher zuweist als der Verein hat, ist damit kein Sonderfall im Code, sondern unmöglich.

| Grenze | Tarif setzt | Verein darf | Abteilung darf |
|---|---|---|---|
| Speicher (Bytes) | Maximum für den ganzen Verein | je Abteilung ein kleineres Limit setzen | je Mannschaft ein kleineres Limit setzen |
| Beiträge je Periode | Maximum, wirkt als `channel_quotas`-Obergrenze | kleinere Kontingente je Scope (Paket 011) | kleinere Kontingente je Team |
| Mannschaften | Maximum | – | – |
| Abteilungen | Maximum | – | – |

Die Summe der Unterlimits darf das Vereinslimit **überschreiten** — das ist Absicht. Ein Verein, der vier Abteilungen je 2 GB von insgesamt 5 GB gibt, verteilt eine Reserve, die nicht alle gleichzeitig brauchen. Verbindlich ist immer beides: die Abteilungsgrenze **und** die Vereinsgrenze. Wer eine strikte Aufteilung will, rechnet selbst.

### Was Speicher verbraucht

Gezählt werden die Bytes, die tatsächlich in einem Bucket liegen:

| Quelle | Zählt | Begründung |
|---|---|---|
| `media_assets` | ja | Originale sind der größte Anteil |
| `media_derivatives` | ja | Renderings, oft größer als das Original |
| `brand_assets` | ja | Logos und Schriften, klein aber dauerhaft |
| Einwilligungsnachweise und Verträge | ja | liegen in `raw-media` (Pakete 015, 020) |
| gelöschte Objekte (`upload_status = 'deleted'`) | nein | das Objekt ist weg, die Metadatenzeile bleibt |

Die Zuordnung zu Abteilung und Mannschaft folgt der des Datensatzes. Was keiner Abteilung zugeordnet ist — Vereinslogos, Verträge — zählt nur gegen das Vereinslimit.

## Datenmodell

Migration `2026080414_subscriptions_and_storage_quota.sql`:

```sql
-- Tarife sind Daten. Preise und Grenzen aendern sich, ohne Deployment.
create table public.subscription_plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null,
  -- Preis in Cent, damit nichts gerundet wird. null = nicht selbst buchbar
  -- (individuell vereinbarter Tarif).
  monthly_price_cents integer check (monthly_price_cents >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  storage_bytes bigint not null check (storage_bytes > 0),
  max_publications_per_day integer check (max_publications_per_day > 0),
  max_teams integer check (max_teams > 0),
  max_departments integer check (max_departments > 0),
  -- null bei einer Grenze heisst ausdruecklich "unbegrenzt", nicht "null".
  is_self_serviceable boolean not null default true,
  sort_order integer not null default 0,
  available_from date, available_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until >= available_from)
);

-- Startbelegung; jederzeit per Update oder neuem Tarif aenderbar.
insert into public.subscription_plans
  (key, display_name, monthly_price_cents, storage_bytes,
   max_publications_per_day, max_teams, max_departments, sort_order)
values
  ('free',    'Kostenlos',  0,    3221225472,  1,    1,    1,    10),
  ('starter', 'Einstieg',   2000, 26843545600, 10,   null, null, 20),
  ('premium', 'Premium',    5000, 107374182400, null, null, null, 30);

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  status text not null default 'active'
    check (status in ('active','past_due','cancelled','suspended')),
  started_at timestamptz not null default now(),
  current_period_end date,
  cancel_at_period_end boolean not null default false,

  -- Operative Uebersteuerung fuer den Einzelfall. Nur mit platform.manage
  -- setzbar, nie durch den Verein selbst. null = Tarifwert gilt.
  storage_bytes_override bigint check (storage_bytes_override > 0),
  max_publications_per_day_override integer check (max_publications_per_day_override > 0),
  max_teams_override integer check (max_teams_override > 0),
  max_departments_override integer check (max_departments_override > 0),
  override_reason text check (char_length(override_reason) <= 500),
  override_by uuid references public.profiles(id),
  override_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Eine Uebersteuerung ohne Begruendung ist in sechs Monaten nicht mehr
  -- nachvollziehbar. Deshalb erzwungen, sobald irgendein Wert gesetzt ist.
  check (
    (storage_bytes_override is null and max_publications_per_day_override is null
     and max_teams_override is null and max_departments_override is null)
    or (override_reason is not null and override_by is not null and override_at is not null)
  )
);
```

Grenzen werden nie direkt aus dem Tarif gelesen, sondern über eine Funktion, damit die Übersteuerung nicht an jedem Aufrufer wiederholt werden muss:

```sql
create or replace function public.effective_limits(target uuid)
returns table (storage_bytes bigint, max_publications_per_day integer,
               max_teams integer, max_departments integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(s.storage_bytes_override, p.storage_bytes),
         coalesce(s.max_publications_per_day_override, p.max_publications_per_day),
         coalesce(s.max_teams_override, p.max_teams),
         coalesce(s.max_departments_override, p.max_departments)
    from public.organization_subscriptions s
    join public.subscription_plans p on p.key = s.plan_key
   where s.organization_id = target;
$$;
```

Unterlimits je Abteilung und Mannschaft:

```sql
create table public.storage_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  storage_bytes bigint not null check (storage_bytes > 0),
  set_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 'organization' ist hier nicht zulaessig: das Vereinslimit kommt aus dem
  -- Tarif und ist keine frei setzbare Zeile.
  check ((scope = 'department' and department_id is not null and team_id is null)
      or (scope = 'team'       and department_id is not null and team_id is not null)),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id)
    references public.teams(organization_id, department_id, id) on delete cascade
);

-- Ausdruecke gehen nur im Index, nicht im Constraint -- und ohne die
-- Normalisierung waeren zwei Zeilen mit NULL-team_id voneinander verschieden.
create unique index storage_limits_unique on public.storage_limits (
  organization_id, scope, department_id,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
```

Nutzung als Aggregat, nicht als Zählerspalte:

```sql
create or replace function public.storage_usage_bytes(
  target_organization uuid, target_department uuid default null, target_team uuid default null
) returns bigint language sql stable security definer set search_path = public, pg_temp as $$ ... $$;
```

Dieselbe Begründung wie bei `count_publications_in_period` in Paket 011: eine Zählerspalte weicht von der Wahrheit ab, sobald ein Objekt gelöscht, ein Derivat invalidiert oder ein Aufbewahrungsjob gelaufen ist. Anders als dort ist die Summe hier aber teurer, weil sie über drei Tabellen geht und bei jedem Upload gebraucht wird. Deshalb zusätzlich ein Cache, der die Anzeige bedient und ausdrücklich **nicht** die Prüfung:

```sql
create table public.storage_usage_cache (
  organization_id uuid not null,
  department_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  team_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  asset_count integer not null default 0 check (asset_count >= 0),
  computed_at timestamptz not null default now(),
  primary key (organization_id, department_id, team_id)
);
```

Sentinel-UUIDs statt `NULL` in den Dimensionsspalten, weil PostgreSQL keinen ausdrucksbasierten Primärschlüssel erlaubt — dasselbe Muster wie `metrics_daily` in Paket 016.

**Die Aufnahmeprüfung liest immer das Aggregat, nie den Cache.** Der Cache darf veralten; eine Grenze, die auf einem veralteten Wert beruht, wäre entweder zu streng oder wirkungslos.

## Umsetzung

### 1. Durchsetzung beim Upload

Der Upload ist der einzige Weg, auf dem Speicher entsteht, und damit die einzige Stelle, an der die Grenze wirken muss.

- Die Größe ist **vor** dem Upload bekannt: die signierte URL wird für eine angekündigte Bytezahl ausgestellt. Geprüft wird also beim Ausstellen, nicht nach dem Hochladen — sonst liegt das Objekt schon im Bucket, wenn die Grenze auffällt.
- Geprüft wird gegen **alle** zutreffenden Grenzen: Mannschaft, Abteilung, Verein. Die erste, die reißt, benennt die Antwort — mit Ebene, Limit und aktueller Nutzung, damit die Oberfläche einen Satz bilden kann statt „Fehler 409“.
- Prüfung und Reservierung laufen in einer Transaktion mit `pg_advisory_xact_lock` auf den Verein, wie die Kontingentprüfung in Paket 011. Ohne Sperre lassen zwei parallele Uploads beide die Grenze passieren.
- Nach dem Abschluss (`complete`) wird die **tatsächliche** Objektgröße gelesen und gegen die angekündigte geprüft. Weicht sie ab, gilt die tatsächliche, und der Cache wird aktualisiert. Ein Client, der 1 MB ankündigt und 100 MB hochlädt, wird nicht geglaubt.
- Läuft eine Reservierung ohne Abschluss aus, verfällt sie. Das ist derselbe Mechanismus wie bei `publication_media_grants.expires_at` und wird von `enforce-retention` aus Paket 020 mitgeräumt.

### 2. Zustand „voll“

Ein voller Speicher darf einen Verein nicht handlungsunfähig machen:

- **Neue Uploads** werden abgewiesen, mit Nennung der reißenden Ebene.
- **Bereits geplante Veröffentlichungen laufen weiter.** Ein Beitrag, der freigegeben und eingeplant ist, wird veröffentlicht — er braucht keinen neuen Speicher, und ihn scheitern zu lassen wäre die Strafe für die falsche Person.
- **Nichts wird automatisch gelöscht.** Das gilt auch für den kostenlosen Tarif. Eine Software, die Vereinsfotos wegwirft, um Platz zu schaffen, hat einen Vertrauensschaden verursacht, den kein Tarif wieder einbringt.
- Die Oberfläche zeigt drei Wege: Tarif wechseln, Aufbewahrungsfristen verkürzen (Paket 020), oder gezielt aufräumen — mit einer nach Größe sortierten Liste, damit „aufräumen“ nicht Raten heißt.

**Warnschwelle bei 80 %**, mit einer E-Mail an `organization_owner` und `billing_admin` über denselben Versandweg wie die Einladungen aus Paket 010. Höchstens eine Warnung je Woche und Verein; eine Warnung, die täglich kommt, wird zur Regel und damit unsichtbar.

### 3. Tarifwechsel und Downgrade

Der unangenehme Fall ist der Wechsel nach unten, und er wird ausdrücklich behandelt:

- Ein Downgrade, dessen Speichergrenze unter der aktuellen Nutzung liegt, wird **nicht abgelehnt**, sondern führt in einen Zustand „über dem Kontingent“: keine neuen Uploads, alles andere bleibt. Ihn abzulehnen würde einen Verein in einem teuren Tarif festhalten, was schlechter ist als eine Einschränkung.
- Dasselbe für Mannschaften und Abteilungen: bestehende bleiben, neue lassen sich nicht anlegen. Eine bestehende Struktur wegen eines Tarifwechsels zu löschen, ist keine Option.
- Die Oberfläche sagt vor der Bestätigung, was der neue Tarif bedeutet: „Ihr nutzt 12 GB, der Einstiegstarif umfasst 25 GB“ — mit konkreten Zahlen, nicht mit einem Warndreieck.
- `status = 'past_due'` und `'suspended'` betreffen die Zahlung, nicht die Grenzen. Was in diesen Zuständen passiert, hängt an der Zahlungsabwicklung und ist hier bewusst offen.

### 4. Endpunkte

- `GET /v1/subscription` → aktueller Tarif, effektive Grenzen, Nutzung je Ebene, Warnschwelle. Verlangt `organization.manage` oder `billing.manage`.
- `GET /v1/subscription/plans` → buchbare Tarife mit Preis und Grenzen, gefiltert auf `is_self_serviceable` und den Verfügbarkeitszeitraum.
- `POST /v1/subscription/plan` → Wechsel. Schreibt `audit_events` mit alter und neuer Tarifstufe.
- `PUT /v1/organizations/:id/storage-limits` → Unterlimits je Abteilung oder Mannschaft, `department.manage` im jeweiligen Scope.
- `GET /v1/storage/usage?scope&scopeId` → Nutzung mit Aufschlüsselung nach Quelle (Originale, Renderings, Branding, Nachweise) und den größten Einzelposten.
- `PUT /v1/admin/subscriptions/:organizationId/override` → operative Übersteuerung. Verlangt eine neue Permission `platform.manage`, die **keine** Vereinsrolle trägt; sie gehört dem Betreiber. Begründung ist Pflicht, jeder Aufruf landet im Audit.

Ein neues Recht `billing.manage` geht an `organization_owner` und `billing_admin` — die Rolle existiert bereits ohne Permissions und bekommt hier ihre Aufgabe.

### 5. Oberfläche

Neue Seite `pages/einstellungen/tarif.vue`:

- aktueller Tarif, Preis, nächster Abrechnungszeitpunkt
- Speicherbalken mit absoluten Zahlen daneben — „12,4 von 25 GB“, nicht nur ein Balken. Ein Balken ohne Zahl ist genau die Art Anzeige, die diese Planserie zurückbaut.
- Aufschlüsselung nach Quelle und nach Abteilung, sortiert nach Größe
- Beiträge heute / Tageslimit, Mannschaften / Maximum
- Tarifvergleich mit den Grenzen, die für diesen Verein tatsächlich zählen
- bei Übersteuerung ein Hinweis, dass individuelle Grenzen gelten — ohne die Begründung anzuzeigen, die eine interne Notiz ist

In `pages/struktur.vue` (Paket 010) bekommt jede Abteilung und Mannschaft ihre Nutzung und ihr Limit direkt in der Zeile. Dort wird die Aufteilung entschieden, dort gehört die Zahl hin.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests: `effective_limits` bevorzugt die Übersteuerung; `null` in einer Tarifgrenze bedeutet unbegrenzt und nicht null; die kleinste zutreffende Grenze gewinnt über Mannschaft, Abteilung und Verein; die Summe der Unterlimits über dem Vereinslimit ist zulässig, aber das Vereinslimit greift trotzdem.
- pgTAP: `storage_limits` mit `scope = 'organization'` verstößt gegen CHECK; zwei Abteilungslimits für dieselbe Abteilung verstoßen gegen den Unique-Index, ebenso zwei Teamlimits mit `NULL`-normalisierter `team_id`; eine Übersteuerung ohne Begründung verstößt gegen CHECK; `storage_bytes = 0` verstößt gegen CHECK; Tarif und Nutzung eines fremden Vereins sind unsichtbar; ein Vereinsmitglied kann `organization_subscriptions` **nicht** schreiben.
- Upload-Tests: Upload an der Grenze wird angenommen, ein Byte darüber abgewiesen mit Nennung von Ebene und Limit; Abteilungslimit greift, obwohl das Vereinslimit Platz hätte; zwei parallele Uploads an der Grenze lassen genau einen durch; ein Client, der eine kleinere Größe ankündigt als er hochlädt, wird beim Abschluss korrigiert; eine verfallene Reservierung gibt den Platz frei.
- Zustandstests: bei vollem Speicher wird eine bereits eingeplante Publikation trotzdem veröffentlicht; **kein** Objekt wird automatisch gelöscht; die Warnung bei 80 % geht genau einmal pro Woche heraus.
- Downgrade-Tests: Wechsel unter die aktuelle Nutzung ist möglich, blockiert neue Uploads und löscht nichts; bestehende Mannschaften über dem neuen Maximum bleiben, eine neue lässt sich nicht anlegen.
- Zählungstests: gelöschte Objekte (`upload_status = 'deleted'`) zählen nicht mehr; ein Aufbewahrungslauf aus Paket 020 senkt die Nutzung nachweisbar; der Cache weicht nach einer Änderung ab und wird von der Nachberechnung korrigiert — die Aufnahmeprüfung benutzt in beiden Fällen das Aggregat.
- API-Tests: Tarifwechsel ohne `billing.manage` → 403; Übersteuerung ohne `platform.manage` → 403, auch für `organization_owner`; Unterlimit über dem Tariflimit → 422.
- manuell: kostenlosen Tarif einrichten, 3 GB mit Videos füllen, Warnung bei 80 % erhalten, Upload an der Grenze abgewiesen bekommen, Aufbewahrungsfrist senken, Platz erscheint wieder, Tarif wechseln, größere Datei geht durch.

## Risiken und offene Entscheidungen

- **Zahlungsabwicklung ist nicht Teil dieses Pakets und braucht eine Entscheidung.** Nötig sind: ein Zahlungsdienstleister (Stripe, Mollie und Paddle unterscheiden sich vor allem darin, wer Händler ist und wer die Umsatzsteuer schuldet), Rechnungsstellung mit fortlaufender Nummer, Umgang mit der Kleinunternehmerregelung, SEPA-Mandate, und das Verhalten bei ausbleibender Zahlung. `status` kennt dafür bereits `past_due` und `suspended`, damit das Schema später nicht bricht. Bis dahin sind Tarife zuweisbar und wirksam, aber nicht bezahlbar — das ist ein sinnvoller Zwischenstand für einen Pilotbetrieb mit ausgewählten Vereinen.
- **Die Preise 20 € und 50 € sind Platzhalter mit Vorzeichen**, keine kalkulierten Werte. Sie stehen als Daten in der Tabelle und lassen sich ändern; was fehlt, ist eine Kostenrechnung. Speicher, Rendering und LLM-Aufrufe sind die drei Posten, und der teuerste ist nicht der Speicher. Bevor der erste Verein zahlt, sollte eine Deckungsrechnung je Tarif existieren — sonst subventioniert der Premiumtarif genau die Vereine, die am meisten rendern.
- **3 GB im kostenlosen Tarif ist knapp, wenn Videos im Spiel sind.** Ein einzelnes Handyvideo von zwei Minuten liegt bei 200 bis 400 MB, und `rendered-media` erlaubt Objekte bis 500 MB. Nach zehn Beiträgen ist der Tarif voll. Das ist vertretbar, wenn die Oberfläche es vorher sagt — nicht, wenn es beim elften Upload auffällt. Alternative wäre, im kostenlosen Tarif Video ganz auszunehmen und nur Bilder zuzulassen. Das ist eine Produktentscheidung, die vor dem Start fällt.
- **Preisänderung für Bestandsvereine**: ändert man `monthly_price_cents` in der Tabelle, ändert sich der Preis für alle, die den Tarif haben. Das ist bequem und rechtlich heikel. Wer Bestandspreise garantieren will, braucht eine Preishistorie und einen Verweis darauf in `organization_subscriptions` statt eines Verweises auf den Tarif allein. Diese Entscheidung sollte fallen, bevor der erste Preis erhöht wird — nachträglich ist sie teuer.
- **Speicher ist die falsche Metrik für die Belastung, aber die richtige für die Verständlichkeit.** Rechenzeit für Rendering und LLM-Aufrufe kosten mehr als Bytes. Ein Verein versteht Gigabyte und versteht keine Rendering-Minuten. Deshalb bleibt Speicher die sichtbare Grenze, und die Beitragsgrenze je Tag begrenzt die Rechenlast indirekt. Sollte das nicht reichen, ist ein Kontingent für Renderings der nächste Schritt — dann bitte messen, bevor gedeckelt wird.
- **`platform.manage` ist ein neues Recht außerhalb des Vereinsmodells.** Alle bisherigen Permissions gelten in einem Scope; dieses gehört dem Betreiber und darf keiner Vereinsrolle zufallen. Die Prüfung muss ausdrücklich negativ getestet werden, auch gegen `organization_owner`, sonst entsteht hier ein Weg, sich selbst mehr Kontingent zu geben.
