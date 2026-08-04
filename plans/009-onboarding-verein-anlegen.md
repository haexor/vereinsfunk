# 009 – Onboarding: Verein anlegen und Ersteinrichtung

## Ergebnis

Wer sich zum ersten Mal anmeldet, landet nicht auf einem leeren Dashboard, sondern wird durch die Erstellung seines Vereins geführt: Name, Anschrift, Kontakt, Logo, Farben, Schrift, verantwortliche Ansprechperson und mindestens eine Abteilung. Der Ersteller wird dabei Vereinsinhaber und Administrator seiner ersten Abteilung. Danach zeigt das Dashboard echte Daten und eine ehrliche Nächste-Schritte-Liste statt erfundener Kennzahlen.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04. Nach Abschluss von Paket 008 (2026-08-04) einmal gegen den Code nachverifiziert — Ergebnisse und Korrekturen direkt unten eingearbeitet, Details im Rückbau-Abschnitt.

**Was Paket 008 bereits erledigt hat, bevor 009 anfängt:** `apps/web/app/pages/index.vue` bezieht `firstName`/`department` inzwischen aus `useSession()`/`useScope()`, nicht mehr aus `useDemoData()` (die Datei existiert nicht mehr). `layouts/default.vue` hat einen echten Abteilungs-Umschalter (die Rolle/Anzeigename kommen aus `useSession()`). Was **weiterhin** wie im Plan beschrieben aussteht: die Kennzahlen/Wochenausschnitt/Ideen-Karte/Monatsziel-Balken in `index.vue` sind unverändert erfunden, und der **Vereins**-Umschalter (nicht der Abteilungs-Umschalter) in der Sidebar ist weiterhin ein Button ohne Funktion.

- Für `public.organizations` existiert **keine INSERT-Policy**. Ein Verein ist heute ausschließlich über die Service Role anlegbar. Onboarding braucht daher zwingend einen privilegierten Serverpfad, entweder eine `security definer`-Funktion oder einen API-Endpunkt.
- `supabase/migrations/202608020001_initial_tenant_foundation.sql:32-39`: `organizations` kennt nur `name`, `slug`, `timezone`. **Keine Anschrift, kein Kontakt, keine Rechtsform, kein Registereintrag.** Die vom Produkt geforderte Adresse existiert im Modell nicht.
- `:120-130` `organization_brand_profiles` kennt `logo_path`, `primary_color`, `accent_color`, `tone` und ein freies `settings`-Objekt. **Keine Schriftarten, keine Logo-Varianten.**
- `:41-50` `departments` erlaubt beliebig viele, aber **nichts erzwingt die mindestens eine Abteilung**, die die Architektur vorschreibt.
- `apps/web/app/pages/index.vue:113-128`: `stats` und `week` sind vollständig erfunden — „18 veröffentlicht“, „24,8k Reichweite“, „+18 %“, ein fester Kalenderausschnitt vom 3.–9. August mit drei Fantasie-Terminen.
- `:135` schreibt „Sonntag, 2. August“ hartkodiert in den Header; `:111` setzt `firstName = 'Lena'`.
- `:196-199` bewirbt eine „Idee für diese Woche“ als statischen Text und verlinkt auf `/erstellen?type=people`, einen Parameter, den `erstellen.vue` nicht auswertet.
- `:206-209` zeigt „18 / 24 Beiträge“ und „3 / 4 Abteilungen aktiv“ mit einem hartkodierten `w-3/4`-Balken. Es gibt kein Monatsziel im Datenmodell.
- `apps/web/app/pages/marke.vue:1` hält Farben und Tonalität in lokalem `reactive`-State; „Speichern“ setzt `saved = true` und schreibt nichts.
- `supabase/migrations/202608020002_private_storage.sql`: Bucket `brand-assets` existiert und erlaubt bereits `image/svg+xml`, `image/png`, `image/jpeg` **und `font/woff2`**. Es gibt jedoch nur eine SELECT-Policy; `storage_upload_department` gilt ausschließlich für `raw-media`. Branding-Uploads müssen über die API laufen.

## Scope

- Migration: Vereinsstammdaten (Anschrift, Kontakt, Rechtsform), Onboarding-Zustand, Pflichtabteilung
- `security definer`-Funktion für die atomare Vereinserstellung
- API-Endpunkte für Vereinserstellung, Branding-Upload und Onboarding-Fortschritt
- Nuxt-Wizard unter `pages/onboarding/` mit vier Schritten
- echtes Dashboard mit Empty States und Nächste-Schritte-Liste
- Rückbau aller Dashboard- und Marken-Dummies

Nicht enthalten: Einladungen und Mitgliederverwaltung (010), Richtlinien und Freigaberouten (011), Kanalverbindungen (012), Schrift-Upload und Abteilungsbranding (013).

## Datenmodell

Migration `2026080402_organization_profile_and_onboarding.sql`:

```sql
create table public.organization_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text,                       -- falls abweichend vom Anzeigenamen
  legal_form text check (legal_form in ('e_v','gmbh','gugmbh','ggmbh','nicht_eingetragen','sonstige')),
  register_court text, register_number text,
  street text, house_number text, postal_code text, city text,
  country_code text not null default 'DE' check (country_code ~ '^[A-Z]{2}$'),
  contact_email text check (contact_email = lower(contact_email)),
  contact_phone text, website_url text,
  founded_year integer check (founded_year between 1800 and 2100),
  -- Verantwortliche Person für veröffentlichte Inhalte. Pflicht, bevor
  -- ein Kanal verbunden werden darf (Paket 012, Begründung in 020).
  responsible_person_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_onboarding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  completed_steps text[] not null default '{}',
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Alle Felder außer `country_code` sind bewusst nullable. Der Wizard fragt sie ab, aber ein Verein darf mit Namen und einer Abteilung starten und die Stammdaten später vervollständigen. Das ist der Unterschied zwischen einem Formular, das Menschen ausfüllen wollen, und einem, das sie abbrechen.

`organization_brand_profiles` wird additiv erweitert:

```sql
alter table public.organization_brand_profiles
  add column logo_dark_path text,
  add column display_font_key text not null default 'manrope',
  add column body_font_key text not null default 'dm_sans';
```

Die Font-Schlüssel verweisen auf eine kuratierte Registry in `packages/domain` (Paket 013 ergänzt eigene Uploads). Heute lädt `nuxt.config.ts:327-334` Manrope und DM Sans fest von Google Fonts — die Defaults spiegeln also den Bestand.

Pflichtabteilung als abfragbare Invariante statt als Constraint:

```sql
create or replace function public.organization_department_count(target uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from public.departments where organization_id = target;
$$;
```

Ein echter Datenbank-Constraint „mindestens eine Abteilung“ ist über zwei Tabellen nicht ohne deferrable Trigger möglich und würde den Löschpfad verklemmen. Die Regel wird stattdessen an zwei Stellen durchgesetzt: die Erstellungsfunktion legt Verein und Abteilung in einer Transaktion an, und das Löschen der letzten Abteilung wird in Paket 010 abgewiesen.

## Umsetzung

### 1. Atomare Vereinserstellung

```sql
create or replace function public.create_organization(
  organization_name text, organization_slug text, first_department_name text,
  organization_timezone text default 'Europe/Berlin'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
```

Die Funktion legt in einer Transaktion an: `organizations`, `organization_profiles`, `organization_onboarding`, `organization_brand_profiles` mit Defaults, die erste `departments`-Zeile, eine `organization_memberships`-Zeile mit `organization_owner` und eine `department_memberships`-Zeile mit `department_admin` — beide für `auth.uid()`. Zusätzlich ein `audit_events`-Eintrag.

Regeln:

- `auth.uid()` muss vorhanden sein, sonst Abbruch. Die Funktion ist `security definer` und darf nicht anonym aufrufbar sein.
- Slug wird serverseitig aus dem Namen normalisiert und bei Kollision mit einem Zähler versehen. Der Slug ist global unique (`202608020001:35`) und deshalb ein potenzieller Informationsleck-Kanal: die Fehlermeldung nennt nie einen fremden Vereinsnamen.
- **Missbrauchsgrenze**: ein Nutzer darf nicht beliebig viele Vereine anlegen. Ohne Grenze ist das ein offener Schreibpfad in eine geteilte Produktionsdatenbank. Vorschlag: maximal drei Vereine mit `organization_owner` pro Profil, danach 429 mit Hinweis auf Kontaktaufnahme. Der Wert gehört in `packages/config`, nicht in die SQL-Funktion.
- Alternative Umsetzung: statt `security definer`-Funktion ein API-Endpunkt mit Service-Role-Client. Empfehlung ist die SQL-Funktion, weil die Transaktion dann garantiert atomar ist und `auth.uid()` nicht durch die API weitergereicht werden muss. Die API ruft die Funktion mit dem **Nutzer**-Client auf, nicht mit der Service Role.

### 2. API-Endpunkte

- `POST /v1/organizations` → validiert per Zod, ruft `create_organization`, gibt `organizationId` und Slug zurück.
- `PATCH /v1/organizations/:id/profile` → Stammdaten, `requirePermission('organization.manage')`.
- `PUT /v1/organizations/:id/brand` → Farben, Tonalität, Font-Schlüssel.
- `POST /v1/organizations/:id/brand/logo` → signierte Upload-URL in `brand-assets` unter `organizations/<id>/brand/<variant>-<hash>.<ext>`. Der Pfad muss zum bestehenden `storage_read_own_organization`-Policy-Schema passen, das `(storage.foldername(name))[1] = 'organizations'` und `[2] = organization_id` erwartet (`202608020002:8-13`).
  - Serverseitig: MIME-Typ **aus dem Dateiinhalt** bestimmen und nicht aus dem Header, Bytegröße begrenzen, bei Rasterbildern Dimensionen und Mindestgröße validieren, EXIF entfernen.
  - SVG wird unterstützt, aber ausschließlich nach Sanitisierung — siehe den folgenden Abschnitt.

### 2a. SVG sicher annehmen

Das Vereinslogo liegt in der Regel als SVG vor, und genau hier lädt ein Verein es zum ersten Mal hoch. Der Sanitizer entsteht deshalb in diesem Paket als eigenes Modul `packages/svg-safe` und wird von Paket 013 für weitere Asset-Arten mitbenutzt.

SVG ist kein Bildformat, sondern ein XML-Dokument mit Skript-, Netzwerk- und Stilfähigkeiten. Es wird daher **geparst, gefiltert und neu serialisiert** — niemals durchgereicht, auch nicht nach einer Prüfung.

**Allowlist statt Blocklist.** Eine Liste verbotener Elemente ist immer unvollständig; nur eine Liste erlaubter ist überprüfbar.

- Erlaubte Elemente: `svg`, `g`, `defs`, `title`, `desc`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `mask`, `pattern`, `symbol`, `use`, `text`, `tspan`
- Erlaubte Attribute je Element als Allowlist: Geometrie, `fill`, `stroke`, `stroke-*`, `opacity`, `transform`, `viewBox`, `d`, `points`, `gradientUnits`, `offset`, `stop-color`, `clip-path`, `mask`, `id`, `class`
- Entfernt: `script`, `foreignObject`, `iframe`, `embed`, `object`, `handler`, `set`, alle `animate*`-Elemente, `<style>`-Element, alle `on*`-Attribute, `xlink:show`, `xlink:actuate`
- `href` und `xlink:href` **nur** als lokale Fragmentreferenz `#id`. Jede absolute oder relative URL wird entfernt. Ein `<use href="https://…">` ist eine serverseitige Netzwerkanfrage aus dem Dokument heraus — beim Rendern in Remotion wäre das ein SSRF-Vektor.
- `<image>` wird vollständig entfernt. Ein Logo braucht kein eingebettetes Rasterbild, und `data:`-URIs darin sind ein unnötig großer Prüfaufwand.
- `style`-**Attribut** nur mit Eigenschaften-Allowlist; `url(...)`, `@import`, `expression(` und `behavior:` werden verworfen.

**XML-Ebene, die oft vergessen wird:**

- Externe Entitäten und DTD-Verarbeitung abschalten (XXE)
- Grenzen setzen: Dateigröße, Knotenanzahl, Verschachtelungstiefe, Attributlänge. Ohne diese Grenzen ist „billion laughs“ ein Denial-of-Service über einen 2-KB-Upload.
- `<!ENTITY>`, Processing Instructions und Kommentare entfernen

**Umsetzung**: DOMPurify mit `USE_PROFILES: { svg: true, svgFilters: false }` in einer JSDOM-Umgebung ist die am breitesten geprüfte Variante und die Empfehlung. Die eigenen Allowlists werden darüber gelegt, weil DOMPurifys Standardprofil mehr erlaubt als ein Logo braucht. Die Größen- und Tiefengrenzen liegen **vor** dem Parser, nicht dahinter.

**Ergebnis**: das sanitisierte Dokument wird als neue Datei gespeichert und ist das einzige, das ausgeliefert wird. Das Original bleibt unverändert im privaten Bucket als Nachweis und wird nie über einen signierten Link herausgegeben. Weicht die Sanitisierung inhaltlich ab — Elemente entfernt —, wird das dem Verein gemeldet, damit ein sichtbar beschädigtes Logo nicht unbemerkt bleibt.

**Auslieferung**: signierte URL mit `Content-Type: image/svg+xml`, `X-Content-Type-Options: nosniff` und `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`. Ein SVG, das direkt im Browser geöffnet wird, ist ein Skriptkontext auf dem ausliefernden Ursprung — der CSP-Header ist die zweite Verteidigungslinie hinter dem Sanitizer, nicht dessen Ersatz.

Testkorpus: eine Sammlung bekannter SVG-XSS-Payloads (`onload`, `<script>` in `<defs>`, `javascript:` in `href`, `<use>` mit externer Referenz, verschachtelte Entitäten) als Fixture. Jeder Eintrag muss nach der Sanitisierung harmlos sein. Diese Datei wächst mit jedem gefundenen Fall.
- `GET /v1/onboarding` und `POST /v1/onboarding/steps/:step/complete` → Fortschritt.
- Alle Endpunkte schreiben `audit_events` mit der `correlationId` aus dem Request-Header (`app.ts:36-37` liefert sie schon).

### 3. Wizard

`pages/onboarding/index.vue` mit vier Schritten und einem gemeinsamen Fortschrittszustand. Verlassen und Wiederkommen darf nichts verlieren.

1. **Verein** — Name (Pflicht), Rechtsform, Anschrift, Kontakt-E-Mail, Website, Gründungsjahr, Zeitzone. Nur Name ist Pflicht. Slug wird als Vorschau angezeigt und ist nicht editierbar.
2. **Erste Abteilung** — Name (Pflicht), mit Vorschlägen als Chips: Fußball, Handball, Turnen, Leichtathletik, Schwimmen, Tennis, Volleyball, Basketball, Tischtennis, Gesamtverein. Ein Verein ohne Abteilungsstruktur wählt „Gesamtverein“. Hinweistext erklärt, dass Teams später innerhalb der Abteilung entstehen.
3. **Erscheinungsbild** — Logo-Upload (hell, optional dunkel), Primär- und Akzentfarbe mit Live-Vorschau auf einer echten Beitragskachel, Schriftpaar aus kuratierter Auswahl, Tonalität. Kontrastprüfung nach WCAG AA gegen die vorgesehene Textfarbe; bei Unterschreitung eine Warnung, keine Blockade — es ist das Logo des Vereins, nicht unseres.
4. **Verantwortung und Team** — verantwortliche Ansprechperson für Inhalte (Vorbelegung: der Ersteller), kurzer Hinweis auf die Bedeutung dieser Rolle, und ein optionaler Einladungsblock. Der Einladungsblock ist bis Paket 010 deaktiviert und zeigt „folgt“ statt eines nicht funktionierenden Formulars.

Schritt 1 und 2 werden gemeinsam abgesendet und erzeugen den Verein. Schritte 3 und 4 sind überspringbar und landen als offene Punkte in der Nächste-Schritte-Liste.

### 4. Dashboard auf echte Daten

`pages/index.vue` wird neu aufgebaut:

- Begrüßung mit `displayName` aus `useSession()` und einem aus `Intl.DateTimeFormat` mit `de-DE` und der Vereinszeitzone formatierten Datum. Kein hartkodierter Wochentag, keine Tageszeit-Behauptung ohne Zeitzonenbezug.
- Kennzahlen: Anzahl Beiträge nach Status im aktiven Scope, offene Freigaben, geplante Beiträge in den nächsten sieben Tagen. Diese drei sind aus `posts` und `approval_requests` direkt zählbar. **Reichweite und Trendwerte entfallen hier vollständig** und kommen erst mit Paket 016 bzw. 017 zurück — bis dahin steht dort keine Kachel, keine Null und kein Platzhalterwert.
- Redaktionsplan-Vorschau: echte `posts.scheduled_for` der laufenden Woche in der Vereinszeitzone.
- Empty State: solange kein Beitrag existiert, ersetzt eine Karte die Listen und führt auf `/erstellen`.
- Nächste Schritte: berechnet aus `organization_onboarding.completed_steps` plus abgeleiteten Zuständen (kein Logo, keine zweite Person eingeladen, kein Kanal verbunden, keine Richtlinie gesetzt). Diese Liste ersetzt den Ideen-Block und die erfundenen Monatsziele.

### 5. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/index.vue:111` | `firstName = 'Lena'` | `useSession().displayName` |
| `pages/index.vue:113-118` | vier erfundene Kennzahlen inkl. Reichweite und Trends | drei echte Zählwerte, keine Trends |
| `pages/index.vue:120-128` | fester Wochenausschnitt mit Fantasie-Terminen | echte `scheduled_for`-Daten |
| `pages/index.vue:135` | „Sonntag, 2. August“ | formatiertes aktuelles Datum in Vereinszeitzone |
| `pages/index.vue:192-201` | statische Wochenidee, toter `?type=`-Parameter | Nächste-Schritte-Karte aus echtem Zustand |
| `pages/index.vue:203-210` | „18 / 24“, „3 / 4“, `w-3/4` | entfällt. Es gibt kein Monatsziel im Produkt. |
| `pages/index.vue:110` | `useDemoData()` | echte Abfragen |
| `pages/marke.vue:1` | lokaler State, Scheinspeichern | `PUT /v1/organizations/:id/brand`, echter Ladezustand, echte Fehler |
| `pages/kalender.vue:1` | 5 Fantasietermine, fest „August 2026“ | echte Beiträge, navigierbarer Monat, Empty State |
| `nuxt.config.ts:327-334` | Fonts fest von Google Fonts | bleibt zunächst, wird in 013 durch die Font-Registry ersetzt |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- pgTAP: `create_organization` erzeugt genau eine Organisation, ein Profil, eine Abteilung und zwei Mitgliedschaften; ein zweiter Nutzer sieht die Organisation nicht; Slug-Kollision erzeugt einen abweichenden Slug ohne Fehler; Aufruf ohne `auth.uid()` schlägt fehl.
- API-Tests: Stammdaten-Update ohne `organization.manage` → 403; Logo-Upload mit unerlaubtem MIME-Typ → 400; Vereinsanlage über dem Limit → 429.
- manuell: Registrieren → automatische Weiterleitung nach `/onboarding` → Verein anlegen → Dashboard zeigt Empty State und die Nächste-Schritte-Liste → Neuladen behält den Verein → zweiter frischer Nutzer sieht ihn nicht.

## Risiken und offene Entscheidungen

- **SVG-Logos** sind entschieden unterstützt und damit auch der sicherheitskritischste Teil dieses Pakets. `packages/svg-safe` ist Sicherheitscode: Allowlist, Größengrenzen vor dem Parser, XXE aus, Neuserialisierung, CSP bei der Auslieferung. Wer daran später etwas lockert, muss den Testkorpus erweitern, nicht kürzen. Sollte die Sanitisierung im Zeitplan nicht in der nötigen Qualität fertig werden, ist der richtige Zwischenstand, SVG-Uploads **abzulehnen** — nicht sie mit halber Prüfung anzunehmen.
- **Ein Nutzer, mehrere Vereine**: das Modell erlaubt es (`organization_memberships` ist n:m), der Wizard behandelt es aber als Ausnahme. Der Vereinswechsler in der Sidebar (`layouts/default.vue:266-273`) ist heute ein Button ohne Funktion und wird in diesem Paket zu einem echten Umschalter.
- **Zeitzone**: `organizations.timezone` existiert und wird bisher nirgends benutzt. Ab hier ist sie verbindlich für jede Datumsanzeige und jede Terminplanung. Alle Zeitstempel bleiben `timestamptz` in UTC; formatiert wird ausschließlich in der Anzeigeschicht.
- **Verantwortliche Person**: rechtlich relevant (siehe 020) und referenziert ein Profil, das den Verein verlassen kann. Beim Entfernen dieser Person aus dem Verein muss die Zuweisung erzwungen neu gesetzt werden — das gehört in Paket 010.
