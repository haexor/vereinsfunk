# 021 – Abomodelle, Speicherkontingent und Nutzungsgrenzen

## Ergebnis

Ein Verein weiß, was sein Tarif erlaubt und wie viel davon er verbraucht hat: Speicher in Gigabyte, Anzahl Abteilungen und Mannschaften, und drei leicht verständliche Beitragskontingente je Monat — eigene Beiträge (Vereinsfotos/-videos, von der KI nur oberflächlich bearbeitet: Vereinsmarke, Unkenntlichmachung von Minderjährigen/Unbeteiligten), KI-Bilder und KI-Videos bis zu einer festgelegten Länge. Keine Instagram-Fachbegriffe, keine Kosten- oder Tokenzahl — nur Zahlen, die ein Verein ohne Erklärung versteht. Der kostenlose Tarif reicht, um das Produkt ernsthaft auszuprobieren; wer mehr braucht, wechselt. Der Verein kann seinen Speicher außerdem selbst auf Abteilungen und Mannschaften aufteilen, damit eine Abteilung mit Videoambitionen nicht den Platz des ganzen Vereins verbraucht. Tarife, Preise und Grenzen sind Daten, keine Konstanten im Code — der Plattform-Betreiber legt sie über eine eigene Oberfläche an und ändert sie, ohne zu deployen und ohne eine Zeile SQL zu schreiben; im Einzelfall lassen sie sich pro Verein übersteuern.

Läuft der Speicher voll, löscht das System nichts. Es sagt, was Platz belegt, und blockiert neue Uploads. Ist eines der drei Beitragskontingente erreicht, gilt dasselbe Prinzip: keine neue Einplanung dieser Art, aber nichts Bestehendes wird angetastet.

**Von KI-generiertem Bild-/Videoinhalt ohne eigenes Rohmaterial existiert heute noch kein einziger Codepfad** (siehe „Ausgangslage“) — die dafür vorgesehenen Kontingente sind in dieser Fassung vollständig spezifiziert und in der Datenbank durchsetzbar, laufen aber praktisch leer, bis ein eigenes, noch zu planendes Paket diese Erzeugung tatsächlich baut. Das ist bewusst kein Widerspruch: ein Tarif kann „bis zu 5 KI-Videos“ versprechen, ohne dass die Erzeugung heute schon existiert — genau wie ein Verein heute schon einen Premium-Tarif mit mehr Speicher buchen kann, bevor er ihn braucht.

**Ergänzung 2026-08-13**: Der Betreiber hat beim Blick auf die Plattform-Admin-Einstellungen zwei Lücken benannt, die dieser Plan jetzt schließt — ein Nutzungskontingent für KI-Textgenerierung war bislang nur als Absicht dokumentiert (siehe Paket 035, „Kontingent-Interaktion … künftige Erweiterung von Paket 021“), und ein Editor für Tarife selbst fehlte (Tarife wären bisher nur per Migration/SQL anlegbar gewesen). Die ursprünglich in diesem Plan vorgesehenen Grenzen für Abteilungen und Mannschaften waren zudem im Schema vorgesehen, aber nirgends durchgesetzt — das wird hier nachgeholt.

**Ergänzung 2026-08-13, weitere Runden (Historie, jeweils durch die nächste ersetzt)**: Zweite Runde — Kontingent als Kosten in Cent mit Preistabelle je LLM-Modell und einer Recovery-Ausnahme; verworfen, weil eine Kostenzahl für einen Verein wenig aussagt. Dritte Runde — Kontingent als Beitragsanzahl je Instagram-Format (Feed-Bild/Karussell/Story/Reel); verworfen, weil „Karussell“ kein Begriff ist, den ein Verein kennt, und weil die drei tatsächlich unterschiedlichen Kostenfaktoren (eigenes Material vs. KI-Bild vs. KI-Video) durch das Format gar nicht abgebildet waren. **Vierte Runde, aktuell**: Kontingent als Beitragsanzahl nach Herkunft der Medien — eigenes Material, KI-Bild, KI-Video mit Längenobergrenze. Das trifft zugleich die Kostenstruktur (KI-Erzeugung ist teurer als das Posten eines eigenen Fotos) und die Verständlichkeit (ein Verein weiß sofort, was „KI-Video“ bedeutet, ohne Plattform-Jargon). Ein Nebeneffekt aus der dritten Runde bleibt gültig: weil erst beim Einplanen zur Veröffentlichung gezählt wird, kann ein interner Textgenerierungs-Retry (Paket 035) keines dieser Kontingente je berühren — es entsteht dabei nie eine `publications`-Zeile.

## Ausgangslage und Evidenz

Geplant auf `a77904a0` am 2026-08-05, ergänzt auf dem Stand vom 2026-08-13.

- Es gibt **keinen Tarif, kein Kontingent und keine Nutzungsmessung.** Kein Schema, kein Endpunkt, keine Anzeige.
- Die Abrechnungsgrundlage für Speicher existiert dagegen vollständig: `media_assets.byte_size` und `media_derivatives.byte_size` sind `bigint not null check (byte_size > 0)` (`202608030001:21-32`, `:50-58`), und `brand_assets.byte_size` legt Paket 013 in derselben Form an. Es muss nichts nachgemessen werden.
- Die drei Buckets haben je ein `file_size_limit` — 100 MB für `raw-media`, 500 MB für `rendered-media`, 20 MB für `brand-assets` (`202608020002:3-5`). Das begrenzt **eine Datei**, nicht die Summe eines Vereins. Ein Verein kann heute unbegrenzt viele 100-MB-Videos hochladen.
- `public.organizations` (`202608020001:32-39`) kennt `name`, `slug`, `timezone` — keinen Tarif, keinen Vertragsstand.
- Korrektur zur ursprünglichen Planung: `billing.manage` **existiert bereits** als Permission und ist `billing_admin` bereits zugewiesen (`packages/authorization/src/index.ts:15,41,51,115`) — der Platz für Tarifverwaltung ist nicht nur vorgesehen, sondern schon verdrahtet, nur ungenutzt.
- **Abteilungen und Mannschaften haben heute keine Mengenprüfung, an keiner Stelle.** `create_department` (`supabase/migrations/2026080601_structure_and_invitations.sql:414-458`) prüft nur `department.manage`, keine Obergrenze. Teams entstehen über `POST /v1/departments/:id/teams` (`apps/api/src/routes/structure.ts:106-132`) sogar per direktem `insert` über den Nutzer-Client — es gibt nicht einmal eine RPC, die eine Grenze prüfen könnte. Ein Verein kann heute beliebig viele Abteilungen und Mannschaften anlegen, unabhängig vom Tarif.
- **Kein Editor existiert, um einen Tarif anzulegen oder zu ändern** — im ursprünglichen Plan war das ausschließlich über den Migration-Seed vorgesehen. `apps/web/app/pages/plattform-admin/einstellungen.vue:56` verweist bereits mit dem Satz „Abo-Pläne und Speicherkontingente werden in einem eigenen Paket verwaltet“ auf dieses Paket. `apps/web/app/pages/plattform-admin/llm.vue` (392 Zeilen) ist das bestehende Vorbild für Tabellen-CRUD im Plattform-Admin-Bereich (Liste laden, Formular zum Anlegen, Inline-Aktionen in der Zeile) und wird als Muster für den neuen Tarif-Editor übernommen.
- Korrektur zur ursprünglichen Planung: Das ursprünglich vorgesehene neue Recht `platform.manage` ist **nicht nötig**. Die Migration, die die Plattform-Admin-Identität einführt, verweist bereits explizit auf dieses Paket: „Wenn 021 umgesetzt wird, sollte es `requirePlatformAdmin` (`apps/api/src/auth.ts`) direkt wiederverwenden statt einen zweiten Mechanismus zu bauen“ (`supabase/migrations/2026080502_platform_administration.sql:9-14`). Tarifverwaltung und operative Übersteuerung laufen deshalb über `requirePlatformAdmin`/die Tabelle `platform_admins`, wie jede andere Plattform-Admin-Route.
- Orthogonal zu diesem Paket: die Einstellung „Vereine pro Eigentümer-Konto“ (`platform_settings.max_organizations_per_owner`, Paket 022, Default 3) begrenzt, wie viele Vereine ein **Account besitzt** — nicht, was ein einzelner Verein darf. Der Betreiber hat entschieden, dass ein Account künftig höchstens einen Verein besitzen soll; das ist eine Wertänderung von 3 auf 1 in einer eigenen, kleinen Migration außerhalb dieses Pakets (siehe „Risiken und offene Entscheidungen“), keine Änderung an diesem Datenmodell.
- **`channel_quotas` (Paket 011) ist die exakte Mechanik, die dieses Paket für Beitragslimits wiederverwendet — vollständig implementiert, nicht nur geplant.** Schema in `supabase/migrations/2026080606_policies_and_review_routes.sql:214-241`: `scope` (`organization`/`department`/`team`), `period` (`day`/`week`/`month`), `max_publications`, optional `social_connection_id`. Die Zählfunktion `count_publications_in_period` (`:248-268`, unverändert übernommen in `2026081107_media_gate_publish_enforcement.sql:1-34`) zählt `publications` mit `status in ('queued','uploading','processing','published')` in der Vereinszeitzone, gejoint über `post_versions`. Die atomare Prüfung sitzt in der RPC `schedule_publication` (`2026081107_media_gate_publish_enforcement.sql:35-196`, aufgerufen über `POST /v1/post-versions/:id/schedule`, `apps/api/src/routes/publishing.ts:15-49`) mit `pg_advisory_xact_lock` je Verein (`:157-163`). **Ein Beitrag zählt ab dem Einplanen** (`status = 'queued'`), nicht erst ab Veröffentlichung; der Platz wird automatisch wieder frei, sobald der Status auf `failed`, `cancelled` oder `action_required` wechselt — ohne eigenen Rückbuchungscode, weil rein aggregiert gezählt wird. Weil die Funktion bereits über `post_versions` joint, lässt sich eine neue Spalte auf genau dieser Tabelle ohne zusätzlichen Join filtern (siehe Datenmodell).
- **Es gibt keine Unterscheidung „eigenes Material“ vs. „KI-generiert“ im Schema.** `post_versions` trägt heute keine Herkunftsangabe für seine Medien. `post_media` verweist auf `media_derivatives`, die aus vom Verein hochgeladenen `media_assets` entstehen (Paket 001/002/025) — das ist der einzige heute existierende Weg, wie ein Beitrag zu seinem Bild/Video kommt.
- **Oberflächliche KI-Bearbeitung eigenen Materials ist real und größtenteils gebaut**: Branding/Logo auf eigenes Material anwenden ist Paket 013 (erledigt) plus Paket 005 (in Arbeit, Remotion-Rendering); Gesichtsverdeckung für Minderjährige/Unbeteiligte ist Paket 003 (in Arbeit). Beides verändert vom Verein bereitgestelltes Material, erzeugt aber kein neues.
- **Generative KI-Bild-/Videoerzeugung ohne Rohmaterial existiert nicht und ist bewusst zurückgestellt.** Die Textwerkstatt (Paket 032/033, erledigt/in Arbeit) generiert ausschließlich **Text** — `plans/README.md`, Einleitung zur „Fünften Serie“: „Er generiert ausschließlich Texte und unterstützt optional eigene Fotos oder Videos… KI-Videoerzeugung und multimodales Bild-/Videoverstehen sind nicht Teil der Serie.“ Paket 033s Status-Nachtrag bestätigt das für Bilder: „Bild-/Video-KI bleibt ausdrücklich deaktiviert“. Es gibt keinen Bild- oder Video-Generierungsprovider, keine Tabelle, keinen Endpunkt dafür.
- **`max_publications_per_day` aus der ersten Fassung dieses Plans war nie verdrahtet** — reine Absichtserklärung. Es taucht in der ursprünglichen Migration und in `effective_limits()` auf, aber kein Endpunkt, keine RPC und kein Test hat je darauf Bezug genommen. Diese Fassung entfernt das Feld ersatzlos und löst dasselbe Bedürfnis (Tempolimit) über zwei bereits vorhandene, unabhängige Mechanismen: die neuen, tatsächlich verdrahteten Monatskontingente (dieses Paket) und die ohnehin frei konfigurierbare `channel_quotas`-Tabelle (Paket 011, jede Periode inklusive `day` bereits möglich) für vereinsindividuelle Tempobegrenzung.
- Der ursprünglich in einer Zwischenfassung erwogene Weg über `post_variants.format` (`feed_image`/`carousel`/`story`/`reel`, Instagram-Publishing-Format) ist verworfen: dieses Feld beschreibt, **wie** etwas veröffentlicht wird (Seitenverhältnis/Layout für eine Plattform), nicht **woher** das Material stammt oder was es gekostet hat. Es bleibt unverändert für seinen ursprünglichen Zweck (Rendering/Publishing, Paket 005/006) und wird von diesem Paket nicht angefasst.

## Scope

- Migration: Tarifdefinitionen als Daten, Tarifzuordnung je Verein mit Übersteuerung, Speicherunterlimits je Abteilung und Mannschaft, ein Herkunftsfeld auf `post_versions` (eigenes Material / KI-Bild / KI-Video samt Länge), drei Beitragskontingente je Kalendermonat mit operativer Übersteuerung
- `packages/domain`: Tarifauflösung und Kontingentprüfung als reine Funktionen
- Durchsetzung im Upload-Pfad, bei Abteilungs- und Teamanlage, und beim Einplanen einer Veröffentlichung (`schedule_publication`)
- Nutzungsanzeige je Verein, Abteilung und Mannschaft — Speicher und Beiträge je Herkunftsart
- Endpunkte und Plattform-Admin-Oberfläche, um Tarife selbst **anzulegen und zu bearbeiten** (nicht nur Migration-Seed)
- Endpunkte für Tarifwechsel je Verein und für die operative Übersteuerung
- Benachrichtigung bei Erreichen der Warnschwelle

Nicht enthalten: **Zahlungsabwicklung.** Zahlungsdienstleister, Rechnungsstellung, Umsatzsteuer, Mahnwesen und Kündigungsfristen sind ein eigenes Vorhaben mit eigenen Entscheidungen — siehe „Risiken und offene Entscheidungen“. Dieses Paket bringt das Produkt in einen Zustand, in dem Tarife wirken; es kassiert nicht.

Nicht enthalten: **die tatsächliche Erzeugung von KI-Bildern/-Videos ohne Rohmaterial.** Dieses Paket definiert nur, wie viel davon ein Tarif erlaubt und setzt das durch, sobald etwas dieser Art entsteht. Wer es baut, wie ein Provider angebunden wird, welche Sicherheits-/Moderationsfragen ein KI-generiertes Sportbild aufwirft — das ist ein eigenes Vorhaben, vergleichbar im Umfang mit Paket 033 für Text, und nicht Teil dieses Plans.

Nicht enthalten: **Einbindung von Vereinsbeiträgen auf der eigenen Website/im eigenen Blog.** Vom Betreiber gewünscht, aber bewusst als eigener, noch nicht ausgeplanter Punkt in `plans/README.md` vorgemerkt statt hier mitgeplant — der technische Mechanismus (Widget, öffentlicher Feed, o.ä.) ist offen und verdient eine eigene Ausgangslage-Recherche, keine Randnotiz in einem Tarif-Plan.

Ebenfalls nicht enthalten: Bandbreitenkontingente, Mehrwährungsfähigkeit, Rabatte und Gutscheine, jede Form von Kosten- oder Tokenmessung als Tarifgrundlage (siehe „Ergänzung“ — zweimal erwogen, zweimal verworfen), Unterlimits je Abteilung/Mannschaft für Beitragskontingente (strukturell genauso lösbar wie bei Speicher, aber nicht angefordert — siehe „Risiken“). Ebenfalls nicht enthalten: die Umstellung von „mehrere Vereine pro Account“ auf „genau ein Verein pro Account“ als Session-/UI-Modell — das bleibt bei der bestehenden Mehrfach-Mitgliedschaft (Array von Scopes), nur die **Eigentümerschaft** wird auf 1 begrenzt (Paket 022, siehe „Risiken und offene Entscheidungen“).

## Fachliches Modell

### Der Tarif ist eine Obergrenze, keine Einstellung

> Der Tarif setzt das Maximum. Verein, Abteilung und Mannschaft dürfen ausschließlich darunter bleiben. Keine untere Ebene erweitert ein Tariflimit.

Das ist bewusst dieselbe Richtung wie die Vererbung in Paket 011, und aus demselben Grund: es gibt genau eine Stelle, an der eine Grenze entsteht, und alle weiteren können sie nur verschärfen. Ein Abteilungsadmin, der sich mehr Speicher zuweist als der Verein hat, ist damit kein Sonderfall im Code, sondern unmöglich.

| Grenze | Tarif setzt | Verein darf | Abteilung darf |
|---|---|---|---|
| Speicher (Bytes) | Maximum für den ganzen Verein | je Abteilung ein kleineres Limit setzen | je Mannschaft ein kleineres Limit setzen |
| Mannschaften | Maximum | – | – |
| Abteilungen | Maximum | – | – |
| Eigene Beiträge je Kalendermonat | Maximum für den ganzen Verein | – (siehe „Nicht enthalten“) | – |
| KI-Bilder je Kalendermonat | Maximum für den ganzen Verein | – | – |
| KI-Videos je Kalendermonat, je Video begrenzt auf X Sekunden | Maximum (Anzahl **und** Länge) für den ganzen Verein | – | – |

Die Summe der Speicher-Unterlimits darf das Vereinslimit **überschreiten** — das ist Absicht. Ein Verein, der vier Abteilungen je 2 GB von insgesamt 5 GB gibt, verteilt eine Reserve, die nicht alle gleichzeitig brauchen. Verbindlich ist immer beides: die Abteilungsgrenze **und** die Vereinsgrenze. Wer eine strikte Aufteilung will, rechnet selbst.

### Drei Beitragskontingente statt eines Formats

Frühere Fassungen dieses Plans hatten ein Kontingent (erst Kosten, dann Instagram-Format) über alle Beiträge gelegt. Diese Fassung unterscheidet nach **Herkunft der Medien**, weil genau das sowohl die Kosten als auch die Verständlichkeit trifft:

| Kontingent | Was zählt dazu | Warum eigen |
|---|---|---|
| **Eigene Beiträge** | Beitrag mit vom Verein selbst hochgeladenem Foto/Video — auch wenn die KI Vereinsmarke aufbringt oder Gesichter Minderjähriger/Unbeteiligter unkenntlich macht (Pakete 003/005/013). Das bleibt „eigenes“ Material, es wird nicht neu erzeugt. | günstigster Fall — kein Generierungsaufwand, nur Verarbeitung |
| **KI-Bilder** | Beitrag mit einem Bild, das die KI ohne vom Verein bereitgestelltes Rohmaterial erzeugt hat. | eigener Generierungsaufwand |
| **KI-Videos** | Beitrag mit einem Video, das die KI ohne Rohmaterial erzeugt hat, begrenzt auf eine im Tarif festgelegte Höchstlänge je Video. | teuerster Fall, zusätzlich längenabhängig |

Ein Verein sieht sofort, was ein Kontingent bedeutet, ohne zu wissen, was ein „Carousel“ ist oder wie ein Reel sich von einer Story unterscheidet — die Begriffe „eigen“, „KI-Bild“, „KI-Video“ brauchen keine Erklärung.

### Beiträge je Herkunft und Kalendermonat

- **Jedes der drei Kontingente ist ein eigener Topf** — ein Verein mit ausgeschöpftem KI-Video-Kontingent kann trotzdem weiter eigene Beiträge einplanen, wenn dessen Kontingent noch reicht.
- **Periode ist der Kalendermonat in der Vereinszeitzone** (`organizations.timezone`), nicht rollierend — dieselbe Zeitregel wie bei `channel_quotas`.
- **Gezählt wird beim Einplanen, nicht beim Entwerfen.** Ein Entwurf, eine Textwerkstatt-Sitzung, ein noch nicht freigegebener Vorschlag verbraucht nichts. Erst `schedule_publication` — derselbe Punkt, an dem heute schon `channel_quotas` geprüft wird — zählt einen Beitrag gegen sein Kontingent, exakt mit derselben Zähllogik wie `count_publications_in_period` (Status `queued`/`uploading`/`processing`/`published`, Platz wird automatisch frei bei `failed`/`cancelled`/`action_required`).
- **Die Längenobergrenze eines KI-Videos ist eine zweite, unabhängige Prüfung**, kein Teil der Monatszählung: ein einzelnes KI-Video, das länger ist als die im Tarif festgelegte Höchstlänge, wird abgelehnt, unabhängig davon, wie viel vom Monatskontingent noch übrig ist — dieselbe Zweiteilung wie beim Speicher, wo ein `file_size_limit` je Datei etwas anderes prüft als die Kontingentgrenze je Verein.
- **Nebeneffekt, der die vorherigen Fassungen dieses Plans vereinfacht**: weil die Zählung erst beim Einplanen einsetzt, kann ein interner Textgenerierungs-Retry (Paket 035, ob von einem Mitglied oder automatisch ausgelöst) keines dieser Kontingente je berühren — er erzeugt höchstens einen weiteren Entwurf, nie eine `publications`-Zeile. Eine Sonderbehandlung für automatische Recovery-Versuche ist deshalb nicht nötig.
- **Ist ein Kontingent erreicht, lässt sich kein weiterer Beitrag dieser Art einplanen** — mit Nennung von Art, Limit und aktuellem Verbrauch. Bereits eingeplante Beiträge laufen weiter.

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

-- Startbelegung; jederzeit ueber den Plattform-Admin-Editor aenderbar (siehe
-- Umsetzung Abschnitt 6/7), nicht nur per Migration.
insert into public.subscription_plans
  (key, display_name, monthly_price_cents, storage_bytes,
   max_teams, max_departments, sort_order)
values
  ('free',    'Kostenlos',  0,    3221225472,   1,    1,    10),
  ('starter', 'Einstieg',   2000, 26843545600,  null, null, 20),
  ('premium', 'Premium',    5000, 107374182400, null, null, 30);

-- Beitragskontingente je Herkunft -- eigene Tabelle statt drei Spalten,
-- aus demselben Grund wie bei Formatlimits in frueheren Fassungen: eine
-- Herkunftsart kann in einem Tarif ganz fehlen (siehe Kommentar unten), und
-- eine vierte Herkunftsart waere eine Zeile, keine Migration.
create table public.subscription_plan_content_limits (
  plan_key text not null references public.subscription_plans(key) on delete cascade,
  media_origin text not null check (media_origin in ('own_upload','ai_image','ai_video')),
  -- null = unbegrenzt fuer diese Herkunft. Fehlt die Zeile komplett, ist
  -- diese Herkunft in diesem Tarif nicht enthalten (0), nicht unbegrenzt --
  -- deshalb muss jeder Tarif explizit eine Zeile je angebotener Herkunft haben.
  max_per_month integer check (max_per_month > 0),
  -- nur fuer 'ai_video' gesetzt: hoechste erlaubte Laenge je Video in Sekunden.
  max_duration_seconds integer check (max_duration_seconds > 0),
  primary key (plan_key, media_origin),
  check (max_duration_seconds is null or media_origin = 'ai_video')
);

insert into public.subscription_plan_content_limits (plan_key, media_origin, max_per_month, max_duration_seconds) values
  ('free',    'own_upload', 12,   null),
  ('free',    'ai_image',   3,    null),
  ('free',    'ai_video',   1,    10),
  ('starter', 'own_upload', 40,   null),
  ('starter', 'ai_image',   15,   null),
  ('starter', 'ai_video',   6,    20),
  ('premium', 'own_upload', null, null),
  ('premium', 'ai_image',   null, null),
  ('premium', 'ai_video',   null, 60);
-- Die Zahlenwerte sind Platzhalter mit Vorzeichen, wie die Preise und die
-- 3 GB des kostenlosen Tarifs (siehe "Risiken und offene Entscheidungen").
-- Bis KI-Bild-/Videoerzeugung existiert (siehe "Ausgangslage"), wirken die
-- ai_image/ai_video-Zeilen als Versprechen ohne Gegenstueck -- kein Codepfad
-- erzeugt heute einen Kandidaten fuer diese beiden Herkunftsarten.

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  status text not null default 'active'
    check (status in ('active','past_due','cancelled','suspended')),
  started_at timestamptz not null default now(),
  current_period_end date,
  cancel_at_period_end boolean not null default false,

  -- Operative Uebersteuerung fuer den Einzelfall. Nur mit requirePlatformAdmin
  -- setzbar (Tabelle platform_admins, kein eigenes Recht platform.manage —
  -- siehe "Ausgangslage"), nie durch den Verein selbst. null = Tarifwert gilt.
  storage_bytes_override bigint check (storage_bytes_override > 0),
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
    (storage_bytes_override is null and max_teams_override is null
     and max_departments_override is null)
    or (override_reason is not null and override_by is not null and override_at is not null)
  )
);

-- Operative Uebersteuerung je Herkunftsart, analog zu organization_subscriptions,
-- aber als eigene Tabelle -- eine Zeile pro uebersteuerter Herkunftsart, nicht
-- weitere Override-Spalten. Eine Zeile bedeutet bereits "uebersteuert", deshalb
-- sind Begruendung/Aufrufer/Zeitpunkt hier direkt not null.
create table public.organization_content_limit_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  media_origin text not null check (media_origin in ('own_upload','ai_image','ai_video')),
  max_per_month integer check (max_per_month > 0),
  max_duration_seconds integer check (max_duration_seconds > 0),
  override_reason text not null check (char_length(override_reason) <= 500),
  override_by uuid not null references public.profiles(id),
  override_at timestamptz not null default now(),
  primary key (organization_id, media_origin),
  check (max_duration_seconds is null or media_origin = 'ai_video')
);
```

Grenzen werden nie direkt aus dem Tarif gelesen, sondern über Funktionen, damit die Übersteuerung nicht an jedem Aufrufer wiederholt werden muss:

```sql
create or replace function public.effective_limits(target uuid)
returns table (storage_bytes bigint, max_teams integer, max_departments integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(s.storage_bytes_override, p.storage_bytes),
         coalesce(s.max_teams_override, p.max_teams),
         coalesce(s.max_departments_override, p.max_departments)
    from public.organization_subscriptions s
    join public.subscription_plans p on p.key = s.plan_key
   where s.organization_id = target;
$$;

create or replace function public.effective_content_limits(target uuid)
returns table (media_origin text, max_per_month integer, max_duration_seconds integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select pcl.media_origin,
         coalesce(clo.max_per_month, pcl.max_per_month),
         coalesce(clo.max_duration_seconds, pcl.max_duration_seconds)
    from public.organization_subscriptions s
    join public.subscription_plan_content_limits pcl on pcl.plan_key = s.plan_key
    left join public.organization_content_limit_overrides clo
      on clo.organization_id = s.organization_id and clo.media_origin = pcl.media_origin
   where s.organization_id = target;
$$;
```

Eine Organisation ohne Zeile in `organization_subscriptions` hat keine Grenzen aus diesem Paket — das entsteht nicht durch dieses Paket selbst, sondern durch die Migrationsreihenfolge: jeder bestehende Verein braucht beim Einspielen dieser Migration einen Startwert (Vorschlag: `free`, siehe „Umsetzung“).

Unterlimits je Abteilung und Mannschaft (nur für Speicher, siehe „Nicht enthalten“ zu Beitragskontingenten je Abteilung):

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

### Abteilungs- und Mannschaftsgrenze: Trigger statt nur RPC-Prüfung

`create_department` prüft heute nur die Permission, keine Menge (siehe „Ausgangslage“); Teams entstehen sogar per direktem `insert`, ohne jede RPC. Eine Prüfung allein in `create_department` würde nichts nützen, wenn `authenticated` weiterhin direkt auf `departments`/`teams` inserieren darf — genau das ist bei Teams heute der Fall. Deshalb sitzt die Grenze in einem `before insert`-Trigger auf beiden Tabellen, nicht nur in einer RPC:

```sql
create or replace function public.enforce_structure_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_count integer;
  max_allowed integer;
begin
  if tg_table_name = 'departments' then
    select count(*) into current_count from public.departments
     where organization_id = new.organization_id and archived_at is null;
    select max_departments into max_allowed from public.effective_limits(new.organization_id);
  else
    select count(*) into current_count from public.teams
     where organization_id = new.organization_id and archived_at is null;
    select max_teams into max_allowed from public.effective_limits(new.organization_id);
  end if;
  if max_allowed is not null and current_count >= max_allowed then
    raise exception 'structure limit reached for this organization' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger departments_enforce_limit before insert on public.departments
  for each row execute function public.enforce_structure_limit();
create trigger teams_enforce_limit before insert on public.teams
  for each row execute function public.enforce_structure_limit();
```

Ein Downgrade löscht auch hier nichts: bestehende Abteilungen und Mannschaften über dem neuen Maximum bleiben unangetastet, nur eine neue lässt sich nicht mehr anlegen — dieselbe Regel wie beim Speicher.

### Beitragszähler je Herkunft: `post_versions` braucht ein Herkunftsfeld

```sql
alter table public.post_versions
  add column media_origin text not null default 'own_upload'
    check (media_origin in ('own_upload','ai_image','ai_video')),
  add column ai_generated_video_duration_seconds integer
    check (ai_generated_video_duration_seconds > 0),
  add constraint post_versions_ai_video_duration_check
    check (ai_generated_video_duration_seconds is null or media_origin = 'ai_video');
```

Default `'own_upload'` für jede bestehende und jede neue Zeile — solange KI-Bild-/Videoerzeugung nicht existiert (siehe „Ausgangslage“), setzt ohnehin kein Codepfad einen anderen Wert. Die Spalte ist trotzdem jetzt schon richtig, weil ein künftiges Erzeugungs-Paket sie nur noch befüllen muss, nicht mehr anlegen.

`count_publications_in_period` (Paket 011) bekommt eine neue, standardmäßig `null`e Filterdimension, damit dieselbe Funktion für beide Zwecke weiterverwendet wird — die vereinseigenen `channel_quotas` (weiterhin `null`, also herkunftsunabhängig) und das neue Tarifkontingent (mit gesetztem Wert). Weil die Funktion bereits über `post_versions` joint (siehe „Ausgangslage“), braucht es dafür **keinen neuen Join**, nur einen zusätzlichen Filter:

```sql
create or replace function public.count_publications_in_period(
  target_organization uuid, target_department uuid, target_team uuid,
  target_connection uuid, quota_period text, reference timestamptz,
  target_media_origin text default null
) returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer
    from public.publications publication
    join public.post_versions version on ...
    join public.posts post on ...
    join public.organizations org on ...
   where publication.organization_id = target_organization
     and (target_connection is null or publication.social_connection_id = target_connection)
     and (target_department is null or post.department_id = target_department)
     and (target_team is null or post.team_id = target_team)
     and (target_media_origin is null or version.media_origin = target_media_origin)
     and publication.status in ('queued', 'uploading', 'processing', 'published')
     and ( ... date_trunc(... at time zone org.timezone) ... );
$$;
```

Die Auslassungspunkte übernehmen die bestehende, bereits geprüfte Logik unverändert — nur die neue `target_media_origin`-Bedingung ist neu, kein zusätzlicher Join. Bestehende Aufrufer (die `channel_quotas`-Prüfung in `schedule_publication`) übergeben weiterhin nichts für den neuen Parameter und bleiben unverändert; er hat einen Default, ist also rückwärtskompatibel.

## Umsetzung

### 1. Durchsetzung beim Upload

Der Upload ist der einzige Weg, auf dem Speicher entsteht, und damit die einzige Stelle, an der die Grenze wirken muss.

- Die Größe ist **vor** dem Upload bekannt: die signierte URL wird für eine angekündigte Bytezahl ausgestellt. Geprüft wird also beim Ausstellen, nicht nach dem Hochladen — sonst liegt das Objekt schon im Bucket, wenn die Grenze auffällt.
- Geprüft wird gegen **alle** zutreffenden Grenzen: Mannschaft, Abteilung, Verein. Die erste, die reißt, benennt die Antwort — mit Ebene, Limit und aktueller Nutzung, damit die Oberfläche einen Satz bilden kann statt „Fehler 409“.
- Prüfung und Reservierung laufen in einer Transaktion mit `pg_advisory_xact_lock` auf den Verein, wie die Kontingentprüfung in Paket 011. Ohne Sperre lassen zwei parallele Uploads beide die Grenze passieren.
- Nach dem Abschluss (`complete`) wird die **tatsächliche** Objektgröße gelesen und gegen die angekündigte geprüft. Weicht sie ab, gilt die tatsächliche, und der Cache wird aktualisiert. Ein Client, der 1 MB ankündigt und 100 MB hochlädt, wird nicht geglaubt.
- Läuft eine Reservierung ohne Abschluss aus, verfällt sie. Das ist derselbe Mechanismus wie bei `publication_media_grants.expires_at` und wird von `enforce-retention` aus Paket 020 mitgeräumt.

### 2. Durchsetzung bei Abteilungs- und Teamanlage

- `create_department` (`supabase/migrations/2026080601_structure_and_invitations.sql:414-458`) bleibt wie es ist — die Grenze prüft nicht die RPC, sondern der neue `before insert`-Trigger auf `departments` (siehe Datenmodell), der jeden Einfügeweg abdeckt, auch einen künftigen.
- Die Teamanlage (`apps/api/src/routes/structure.ts:106-132`) bleibt ebenfalls ein direkter `insert` über den Nutzer-Client — der Trigger auf `teams` ist hier die einzige Prüfung, es gibt keine RPC, die etwas prüfen könnte. Diese Route ändert sich durch dieses Paket nicht.
- Schlägt der Trigger zu, meldet Postgres `errcode = 'P0001'` mit dem Text `'structure limit reached for this organization'` — die API mappt das analog zu den bestehenden `'the last department'`/`'cannot be deleted'`-Fällen (`structure.ts:85-86`) auf eine 409-Antwort mit Klartext, nicht auf einen generischen 500er.
- Ein Downgrade löscht keine bestehende Abteilung oder Mannschaft. Nur die nächste Neuanlage scheitert, bis der Verein wieder unter das Limit fällt oder hochstuft.

### 3. Durchsetzung der Beitragskontingente beim Einplanen

- `schedule_publication` bekommt einen zusätzlichen Prüfblock, direkt neben der bestehenden `channel_quotas`-Schleife, unter derselben `pg_advisory_xact_lock`-Sperre je Verein: für die `media_origin` der einzuplanenden Version wird `effective_content_limits(organization_id)` gegen `count_publications_in_period(organization_id, null, null, null, 'month', now(), media_origin)` geprüft. Reicht das verbleibende Kontingent nicht, wird die Einplanung abgelehnt — mit Nennung von Art, Limit und aktuellem Verbrauch.
- Ist `media_origin = 'ai_video'`, prüft derselbe Aufruf zusätzlich `ai_generated_video_duration_seconds` gegen `max_duration_seconds` aus `effective_content_limits`. Diese Prüfung ist unabhängig von der Monatszählung — ein zu langes Video wird abgelehnt, selbst wenn das Monatskontingent noch nicht ausgeschöpft ist.
- Andere Herkunftsarten sind von einer Ablehnung nicht betroffen: ein ausgeschöpftes KI-Video-Kontingent blockiert keine eigenen Beiträge.
- Ein automatischer Recovery-Versuch (Paket 035) erreicht diese Prüfung nie — er produziert höchstens einen neuen Textentwurf, keine `publications`-Zeile. Es braucht deshalb keine Ausnahme.
- Solange keine KI-Bild-/Videoerzeugung existiert, ist `media_origin` für jeden real eingeplanten Beitrag `'own_upload'` (Default), und nur das `own_upload`-Kontingent hat in der Praxis überhaupt etwas zu prüfen. Das ist erwartet, kein Fehler.

### 4. Zustand „voll“

Ein voller Speicher darf einen Verein nicht handlungsunfähig machen:

- **Neue Uploads** werden abgewiesen, mit Nennung der reißenden Ebene.
- **Bereits geplante Veröffentlichungen laufen weiter.** Ein Beitrag, der freigegeben und eingeplant ist, wird veröffentlicht — er braucht keinen neuen Speicher, und ihn scheitern zu lassen wäre die Strafe für die falsche Person.
- **Nichts wird automatisch gelöscht.** Das gilt auch für den kostenlosen Tarif. Eine Software, die Vereinsfotos wegwirft, um Platz zu schaffen, hat einen Vertrauensschaden verursacht, den kein Tarif wieder einbringt.
- Die Oberfläche zeigt drei Wege: Tarif wechseln, Aufbewahrungsfristen verkürzen (Paket 020), oder gezielt aufräumen — mit einer nach Größe sortierten Liste, damit „aufräumen“ nicht Raten heißt.

Dasselbe Prinzip gilt für ein ausgeschöpftes Beitragskontingent: keine neue Einplanung dieser Art, alles Bestehende bleibt, nichts wird automatisch entwertet oder gelöscht. Die Oberfläche zeigt die beiden Wege, die hier tatsächlich existieren: Tarif wechseln oder bis zum nächsten Monat warten.

**Warnschwelle bei 80 %**, mit einer E-Mail an `organization_owner` und `billing_admin` über denselben Versandweg wie die Einladungen aus Paket 010 — für Speicher und für jedes der drei Beitragskontingente. Höchstens eine Warnung je Woche und Verein; eine Warnung, die täglich kommt, wird zur Regel und damit unsichtbar.

### 5. Tarifwechsel und Downgrade

Der unangenehme Fall ist der Wechsel nach unten, und er wird ausdrücklich behandelt:

- Ein Downgrade, dessen Speichergrenze unter der aktuellen Nutzung liegt, wird **nicht abgelehnt**, sondern führt in einen Zustand „über dem Kontingent“: keine neuen Uploads, alles andere bleibt. Ihn abzulehnen würde einen Verein in einem teuren Tarif festhalten, was schlechter ist als eine Einschränkung.
- Dasselbe für Mannschaften und Abteilungen: bestehende bleiben, neue lassen sich nicht anlegen. Eine bestehende Struktur wegen eines Tarifwechsels zu löschen, ist keine Option.
- Ein Downgrade eines Beitragskontingents wirkt sofort auf die Prüfung im laufenden Monat — anders als beim Speicher gibt es hier keinen sinnvollen „über dem Kontingent“-Zwischenzustand für bereits eingeplante Beiträge, weil sie schon eingeplant sind und bleiben; nur die nächste Einplanung dieser Art greift gegen die neue, niedrigere Zahl.
- Die Oberfläche sagt vor der Bestätigung, was der neue Tarif bedeutet: „Ihr nutzt 12 GB, der Einstiegstarif umfasst 25 GB; ihr habt diesen Monat schon 5 KI-Videos eingeplant, der neue Tarif erlaubt 3“ — mit konkreten Zahlen, nicht mit einem Warndreieck.
- `status = 'past_due'` und `'suspended'` betreffen die Zahlung, nicht die Grenzen. Was in diesen Zuständen passiert, hängt an der Zahlungsabwicklung und ist hier bewusst offen.

### 6. Endpunkte

Endpunkte für den Verein (eigener Tarif, eigene Nutzung):

- `GET /v1/subscription` → aktueller Tarif, effektive Grenzen (Speicher, Abteilungen/Mannschaften, alle drei Beitragskontingente inklusive KI-Video-Länge), Nutzung je Ebene, Warnschwelle. Verlangt `organization.manage` oder `billing.manage`.
- `GET /v1/subscription/plans` → buchbare Tarife mit Preis und Grenzen, gefiltert auf `is_self_serviceable` und den Verfügbarkeitszeitraum.
- `POST /v1/subscription/plan` → Wechsel. Schreibt `audit_events` mit alter und neuer Tarifstufe.
- `PUT /v1/organizations/:id/storage-limits` → Speicher-Unterlimits je Abteilung oder Mannschaft, `department.manage` im jeweiligen Scope.
- `GET /v1/storage/usage?scope&scopeId` → Nutzung mit Aufschlüsselung nach Quelle (Originale, Renderings, Branding, Nachweise) und den größten Einzelposten.
- `GET /v1/publications/usage` → Verbrauch je Herkunftsart im laufenden Kalendermonat, aus `count_publications_in_period` mit gesetztem `target_media_origin`, neben dem jeweiligen `effective_content_limits`-Wert.

Ein Recht `billing.manage` geht an `organization_owner` und `billing_admin` — **existiert bereits** (`packages/authorization/src/index.ts:15,41,51,115`), keine neue Permission nötig.

Endpunkte für den Plattform-Betreiber (Tarife selbst verwalten, statt sie per Migration einzuspielen), alle in `apps/api/src/routes/platformAdmin.ts`, alle mit `requireAuth` + `requirePlatformAdmin` wie jede bestehende Route dort — **keine** neue Permission `platform.manage`, siehe „Ausgangslage“:

- `GET /v1/platform-admin/subscription-plans` → alle Tarife, auch inaktive und zukünftige (`available_from` in der Zukunft), inklusive ihrer drei Beitragskontingente.
- `POST /v1/platform-admin/subscription-plans` → neuen Tarif anlegen, inklusive einer Zeile je Herkunftsart in `subscription_plan_content_limits`.
- `PATCH /v1/platform-admin/subscription-plans/:key` → bestehenden Tarif ändern (Preis, Speicher-/Struktur-Grenzen, Verfügbarkeit, Reihenfolge). Ändert einen Tarif, den Bestandsvereine bereits haben — siehe „Risiken und offene Entscheidungen“ zur Preishistorie.
- `PUT /v1/platform-admin/subscription-plans/:key/content-limits` → die drei Beitragskontingente eines Tarifs (inklusive KI-Video-Länge) in einem Aufruf setzen (Upsert je Herkunftsart, `null` löscht die Zeile explizit statt sie stillschweigend auf „unbegrenzt“ zu setzen).
- `PUT /v1/platform-admin/organizations/:organizationId/subscription` → Tarifzuordnung und operative Übersteuerung (Speicher, Abteilungen/Mannschaften) eines konkreten Vereins setzen. Ersetzt den ursprünglich geplanten Pfad `/v1/admin/subscriptions/:organizationId/override` (Namensraum vereinheitlicht mit den übrigen Plattform-Admin-Routen).
- `PUT /v1/platform-admin/organizations/:organizationId/content-limit-overrides` → operative Übersteuerung je Herkunftsart (`organization_content_limit_overrides`), mit Pflichtbegründung. Beide Übersteuerungs-Endpunkte landen im Audit — dieselbe Check-Constraint bzw. `not null`-Spalte erzwingt das bereits im Schema.

### 7. Oberfläche

Neue Seite `pages/einstellungen/tarif.vue` (Vereinsseite):

- aktueller Tarif, Preis, nächster Abrechnungszeitpunkt
- Speicherbalken mit absoluten Zahlen daneben — „12,4 von 25 GB“, nicht nur ein Balken. Ein Balken ohne Zahl ist genau die Art Anzeige, die diese Planserie zurückbaut.
- drei Beitragsbalken: „7 von 12 eigenen Beiträgen“, „2 von 3 KI-Bildern“, „1 von 1 KI-Video (bis 10 Sekunden)“ diesen Monat, mit Rücksetzdatum
- Aufschlüsselung Speicher nach Quelle und nach Abteilung, sortiert nach Größe
- Mannschaften / Maximum, Abteilungen / Maximum
- Tarifvergleich mit den Grenzen, die für diesen Verein tatsächlich zählen — je Kontingent eine Zeile, KI-Bild/-Video sichtbar als „bald verfügbar“ markiert, solange die Erzeugung selbst noch nicht existiert (siehe „Risiken“)
- bei Übersteuerung ein Hinweis, dass individuelle Grenzen gelten — ohne die Begründung anzuzeigen, die eine interne Notiz ist

In `pages/struktur.vue` (Paket 010) bekommt jede Abteilung und Mannschaft ihre Speichernutzung und ihr Limit direkt in der Zeile. Dort wird die Aufteilung entschieden, dort gehört die Zahl hin.

Neue Seite `pages/plattform-admin/tarife.vue` (Betreiberseite), nach dem Muster von `pages/plattform-admin/llm.vue` (Liste laden, Formular zum Anlegen, Inline-Aktionen in der Zeile — `llm.vue:60-71,105-118,142-174,176-205,340-387`):

- Tabelle aller Tarife mit Preis, Speicher, Mannschaften, Abteilungen, Verfügbarkeitszeitraum, Reihenfolge
- je Tarif aufklappbar: die drei Beitragskontingente mit Inline-Bearbeitung, KI-Video zusätzlich mit einem Feld für die Höchstlänge in Sekunden
- Formular zum Anlegen eines neuen Tarifs mit denselben Feldern, inklusive aller drei Kontingente als Pflichtangabe (auch „unbegrenzt“ ist eine bewusste Angabe, keine leere Zelle)
- kein Löschen — ein Tarif mit zugeordneten Vereinen darf nicht verschwinden; „nicht mehr buchbar“ heißt `available_until` in die Vergangenheit setzen, nicht `DELETE`

Bestehende Seite `pages/plattform-admin/vereine/[id].vue` bekommt einen neuen Abschnitt „Tarif“ mit dem aktuellen Tarif des Vereins, Wechsel-Auswahl und den Formularen für beide Übersteuerungsarten (Speicher/Struktur, Beitragskontingente) inklusive Pflichtbegründung.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Domain-Tests: `effective_limits`/`effective_content_limits` bevorzugen die Übersteuerung; `null` in einer Tarifgrenze bedeutet unbegrenzt und nicht null; eine fehlende Zeile in `subscription_plan_content_limits` bedeutet 0, nicht unbegrenzt.
- pgTAP: `storage_limits` mit `scope = 'organization'` verstößt gegen CHECK; zwei Abteilungslimits für dieselbe Abteilung verstoßen gegen den Unique-Index, ebenso zwei Teamlimits mit `NULL`-normalisierter `team_id`; eine Übersteuerung ohne Begründung verstößt gegen CHECK (Speicher/Struktur) bzw. ist wegen `not null` gar nicht erst einfügbar (Kontingent-Übersteuerung); `storage_bytes = 0` verstößt gegen CHECK; `max_duration_seconds` bei `media_origin <> 'ai_video'` verstößt gegen CHECK; Tarif und Nutzung eines fremden Vereins sind unsichtbar; ein Vereinsmitglied kann `organization_subscriptions`/`subscription_plan_content_limits` **nicht** schreiben.
- Upload-Tests: Upload an der Grenze wird angenommen, ein Byte darüber abgewiesen mit Nennung von Ebene und Limit; Abteilungslimit greift, obwohl das Vereinslimit Platz hätte; zwei parallele Uploads an der Grenze lassen genau einen durch; ein Client, der eine kleinere Größe ankündigt als er hochlädt, wird beim Abschluss korrigiert; eine verfallene Reservierung gibt den Platz frei.
- Zustandstests: bei vollem Speicher wird eine bereits eingeplante Publikation trotzdem veröffentlicht; **kein** Objekt wird automatisch gelöscht; die Warnung bei 80 % geht genau einmal pro Woche heraus, für Speicher und für jedes Kontingent.
- Downgrade-Tests: Wechsel unter die aktuelle Speichernutzung ist möglich, blockiert neue Uploads und löscht nichts; bestehende Mannschaften über dem neuen Maximum bleiben, eine neue lässt sich nicht anlegen; ein Kontingent-Downgrade unter den laufenden Monatsverbrauch blockiert sofort neue Einplanungen dieser Art, ändert aber nichts an bereits eingeplanten.
- Zählungstests: gelöschte Objekte (`upload_status = 'deleted'`) zählen nicht mehr; ein Aufbewahrungslauf aus Paket 020 senkt die Speichernutzung nachweisbar; der Cache weicht nach einer Änderung ab und wird von der Nachberechnung korrigiert — die Aufnahmeprüfung benutzt in beiden Fällen das Aggregat.
- Struktur-Grenztests: die (`max_departments`+1)-te Abteilung schlägt am Trigger fehl, mit `P0001` und dem erwarteten Text; dieselbe Prüfung für die (`max_teams`+1)-te Mannschaft; ein direkter `insert` unter Umgehung der API scheitert ebenso, weil der Trigger auf der Tabelle sitzt, nicht in der Route; ein Downgrade löscht keine bestehende Abteilung/Mannschaft, blockiert aber die nächste Neuanlage.
- Kontingenttests: die (`max_per_month`+1)-te Einplanung einer Herkunftsart in einem Kalendermonat schlägt fehl, mit Nennung von Art/Limit/Verbrauch; eine Einplanung einer **anderen** Herkunftsart bleibt davon unberührt; zwei parallele Einplanungsversuche an der Grenze lassen genau einen durch (`pg_advisory_xact_lock`); ein KI-Video über der Höchstlänge wird abgelehnt, auch wenn das Monatskontingent noch nicht erreicht ist; ein KI-Video unter der Höchstlänge, aber am Monatskontingent, wird nach der Längenprüfung trotzdem am Kontingent abgelehnt; eine später auf `failed`/`cancelled`/`action_required` gesetzte `publications`-Zeile gibt den Platz wieder frei, exakt wie bei `channel_quotas`; ein automatischer Recovery-Versuch (Paket 035) erreicht `schedule_publication` nie und verbraucht deshalb kein Kontingent, ohne dass dafür ein eigener Testfall für eine Ausnahme nötig ist, weil der Pfad gar nicht dorthin führt; `media_origin` ist für jede über den bestehenden Upload-Pfad erzeugte `post_version` `'own_upload'` (Default), solange keine KI-Erzeugung existiert.
- Tarifverwaltungs-API-Tests (Plattform-Admin): `POST`/`PATCH /v1/platform-admin/subscription-plans` und die Kontingent-/Übersteuerungs-Endpunkte ohne Eintrag in `platform_admins` → 403, auch für `organization_owner` und `billing_admin`; ein Vereinsmitglied kann `subscription_plans`/`subscription_plan_content_limits` **nicht** direkt schreiben (RLS).
- API-Tests: Tarifwechsel ohne `billing.manage` → 403; Speicher-Unterlimit über dem Tariflimit → 422.
- manuell: kostenlosen Tarif einrichten, 3 GB mit Videos füllen, Warnung bei 80 % erhalten, Upload an der Grenze abgewiesen bekommen, Aufbewahrungsfrist senken, Platz erscheint wieder, Tarif wechseln, größere Datei geht durch; im Plattform-Admin-Bereich einen Testtarif mit einem eigenen Beitrag im Monat anlegen, einem Testverein zuweisen, zwei eigene Beiträge einplanen und die Ablehnung beim zweiten sehen; die sechste Abteilung bei einem auf fünf begrenzten Tarif ablehnen lassen.

## Risiken und offene Entscheidungen

- **Zahlungsabwicklung ist nicht Teil dieses Pakets und braucht eine Entscheidung.** Nötig sind: ein Zahlungsdienstleister (Stripe, Mollie und Paddle unterscheiden sich vor allem darin, wer Händler ist und wer die Umsatzsteuer schuldet), Rechnungsstellung mit fortlaufender Nummer, Umgang mit der Kleinunternehmerregelung, SEPA-Mandate, und das Verhalten bei ausbleibender Zahlung. `status` kennt dafür bereits `past_due` und `suspended`, damit das Schema später nicht bricht. Bis dahin sind Tarife zuweisbar und wirksam, aber nicht bezahlbar — das ist ein sinnvoller Zwischenstand für einen Pilotbetrieb mit ausgewählten Vereinen.
- **Die Preise und Kontingentzahlen sind Platzhalter mit Vorzeichen**, keine kalkulierten Werte. Sie stehen als Daten in den Tabellen und lassen sich ändern; was fehlt, ist eine Kostenrechnung — insbesondere, sobald KI-Bild-/Videoerzeugung real existiert und tatsächlich Providerkosten verursacht. Bevor der erste Verein für einen Tarif mit echtem KI-Kontingent zahlt, sollte eine Deckungsrechnung existieren.
- **KI-Bild- und KI-Video-Kontingente sind spezifiziert, aber wirkungslos, bis ein eigenes Paket die Erzeugung baut.** Das ist eine bewusste Reihenfolge (Tarifversprechen vor Fähigkeit), keine Inkonsistenz — vergleichbar damit, dass ein Premium-Tarif mehr Speicher verspricht, bevor der erste Verein ihn ausschöpft. Zwei echte offene Fragen bleiben für das künftige Erzeugungs-Paket: welcher Provider (Bild- und Video-Generierung sind unterschiedliche Anbieterlandschaften), und welche Sicherheits-/Moderationsfragen ein KI-generiertes Bild/Video im Kontext von Vereinssport aufwirft (Personen, Minderjährige, Vereinslogos in KI-generierten Szenen) — beides bewusst nicht Teil dieses Plans.
- **3 GB im kostenlosen Tarif ist knapp, wenn Videos im Spiel sind.** Ein einzelnes Handyvideo von zwei Minuten liegt bei 200 bis 400 MB, und `rendered-media` erlaubt Objekte bis 500 MB. Das ist vertretbar, wenn die Oberfläche es vorher sagt — nicht, wenn es beim nächsten Upload auffällt. Alternative wäre, im kostenlosen Tarif Video ganz auszunehmen und nur Bilder zuzulassen. Das ist eine Produktentscheidung, die vor dem Start fällt.
- **Preisänderung für Bestandsvereine**: ändert man `monthly_price_cents` in der Tabelle, ändert sich der Preis für alle, die den Tarif haben — dasselbe gilt jetzt für Kontingente in `subscription_plan_content_limits`. Das ist bequem und rechtlich heikel. Wer Bestandspreise/-kontingente garantieren will, braucht eine Historie statt eines Verweises auf den Tarif allein. Diese Entscheidung sollte fallen, bevor der erste Preis erhöht oder ein Kontingent gesenkt wird — nachträglich ist sie teuer.
- **Kontingente je Abteilung/Mannschaft sind bewusst nicht Teil dieser Fassung.** Strukturell wäre das genauso lösbar wie `storage_limits` (eine Tabelle mit Scope/Herkunft/Limit), aber es wurde nicht angefordert. Sollte ein Verein das später wollen (z. B. „die Jugendabteilung bekommt 2 der 5 KI-Videos“), ist das eine kleine, isolierte Erweiterung nach demselben Muster — keine Neuplanung.
- **Erweiterbarkeit künftiger Grenzen: bewusst weiterhin eine typisierte Spalte je Grenze für Speicher/Struktur**, wie schon `max_teams`/`max_departments` — nicht ein freies `limits jsonb`. Für Beitragskontingente dagegen bewusst eine Zeile je Herkunftsart statt drei Spalten (siehe Datenmodell) — der Unterschied: Herkunftsarten sind eine offene, wachsende Liste (eine vierte Art ist plausibel, etwa „KI-Audio“ für Vereinsradio), Speicher/Struktur-Dimensionen sind es nicht. Beide Entscheidungen sind konsistent mit dem Rest dieses Projekts (`platform_settings` für singuläre Werte, `channel_quotas`/`storage_limits` für mehrzeilige Dimensionen).
- **Abteilungs-/Team-Grenze sitzt in einem Trigger, nicht nur in `create_department`.** Grund: Teams entstehen heute per direktem `insert` ohne RPC, eine reine RPC-Prüfung könnte also umgangen werden. Der Trigger deckt jeden Einfügeweg ab, auch einen künftigen. Wer diesen Trigger später umgehen will (z. B. ein Datenimport, der bewusst über das Limit importiert), braucht eine explizite Ausnahme — die gibt es in dieser Fassung nicht.
- **Korrektur der ursprünglichen Planung**: `billing.manage` existiert bereits (`packages/authorization/src/index.ts:51`) und muss nicht neu eingeführt werden. Ebenso ist `platform.manage` als eigene Permission **nicht** nötig — die Migration, die `platform_admins` einführt, sieht bereits vor, dass 021 `requirePlatformAdmin` wiederverwendet (`supabase/migrations/2026080502_platform_administration.sql:9-14`). Diese Fassung folgt dieser Vorgabe.
- **`max_publications_per_day` ist ersatzlos entfernt** — nie verdrahtet gewesen (siehe „Ausgangslage“) und mit den neuen Beitragskontingenten sowie der ohnehin bestehenden, frei konfigurierbaren `channel_quotas`-Tabelle redundant. Wer ein reines Tempolimit unabhängig vom Tarif will, legt eine `channel_quotas`-Zeile mit `period = 'day'` an — dieser Mechanismus existiert bereits und bleibt unverändert.
- **Website-/Blog-Einbindung ist eine eigene, noch nicht ausgeplante Anforderung** — vom Betreiber gewünscht (Spielberichte, Vereinsfeste u. Ä. auch auf der eigenen Seite einbinden), bewusst nicht Teil dieses Pakets. Sie betrifft eine neue Distributionsart, nicht ein Kontingent, und braucht eine eigene Ausgangslage-Recherche zum technischen Mechanismus (Widget/Code-Snippet, öffentlicher Feed, o. Ä.). Als vorgemerkter Punkt in `plans/README.md` erfasst.
- **Eigentümerschafts-Obergrenze ist orthogonal und nicht Teil dieses Pakets.** `platform_settings.max_organizations_per_owner` (Paket 022, Default 3) begrenzt, wie viele Vereine ein Account **besitzt** — unabhängig davon, was ein einzelner Verein an Abteilungen, Mannschaften oder Beiträgen darf. Der Betreiber hat entschieden, den Standardwert auf 1 zu senken. Das ist eine eigene, kleine Migration außerhalb dieses Pakets: eine neue Migration setzt den bestehenden Wert in `platform_settings` auf `1` (nicht rückwirkend, bestehende Mehrfach-Eigentümerschaften bleiben unangetastet — dieselbe Nicht-Löschen-Regel wie überall in dieser Planserie), und der pgTAP-Test in `supabase/tests/platform_administration.test.sql:108-128`, der heute den Default 3 voraussetzt, wird auf 1 angepasst. Am bestehenden `PUT /v1/platform-settings/max_organizations_per_owner`-Mechanismus (Paket 022, bereits umgesetzt) ändert sich nichts — der Betreiber kann den Wert schon heute selbst auf 1 setzen, ohne auf diese Migration zu warten.
