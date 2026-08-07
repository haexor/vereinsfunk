# 012 – Kanäle und Social-Accounts verwalten

## Ergebnis

Ein Verein verbindet seine Instagram- und Facebook-Konten selbst, entscheidet, welche Abteilung und welches Team welchen Kanal bespielen darf, und legt fest, ob Abteilungen eigene zusätzliche Konten mitbringen dürfen. Jeder Kanal hat eine benannte verantwortliche Person. Ein Beitrag lässt sich nur auf Kanälen einplanen, die für seinen Scope freigegeben sind, deren Verbindung gültig ist und deren Kontingent noch Platz hat.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- `supabase/migrations/202608030001_content_media_workflows_publishing.sql:87-91`: `social_connections` existiert vollständig — `platform`, `external_account_id`, `display_name`, `scopes`, `token_ciphertext bytea`, `token_key_version`, `token_expires_at`, `status`, `last_verified_at`, `metadata`. Das Modell ist gut.
- Es gibt **nur `organization_id`** auf `social_connections`. Kein `department_id`, keine Zuordnungstabelle. Ein Kanal gehört heute zwangsläufig dem ganzen Verein, und jede Abteilung darf jeden Kanal bespielen. Die Anforderung nach abteilungseigenen Kanälen und nach Beschränkung ist nicht abbildbar.
- Es gibt **keine verantwortliche Person pro Kanal**. `organization_profiles.responsible_person_profile_id` aus Paket 009 gilt vereinsweit; pro Kanal fehlt sie.
- Es gibt **keinen OAuth-Pfad**. `packages/config/src/index.ts:17-20` kennt `OPENAI_API_KEY`, `PUBLISHING_PROVIDER`, `MIXPOST_BASE_URL`, `MIXPOST_TOKEN` — aber **keine Meta-App-Zugangsdaten**, obwohl `plans/README.md` Mixpost ausdrücklich aus dem MVP ausschließt und `packages/publishing/src/index.ts:19-55` bereits einen direkten `MetaPublisher` enthält. Die Konfiguration passt nicht zur Architekturentscheidung.
- `token_ciphertext` ist `bytea` mit `token_key_version` — Verschlüsselung ist vorgesehen, aber es existiert **keine Implementierung** und kein Schlüsselmanagement.
- Für `social_connections` gibt es nur `connections_select` für Vereinsmitglieder (`202608030001:125`) und `select` für `authenticated` (`:131`). **Jedes Vereinsmitglied kann jede Kanalzeile lesen** — inklusive `token_ciphertext`, weil die Policy spaltenblind ist und der Grant die ganze Tabelle umfasst. Das ist der ernsteste Befund dieses Pakets.
- `apps/web/app/pages/einstellungen.vue:1` behauptet „Instagram Verbunden · @sv_nordstadt“ und „Facebook Verbunden · SV Nordstadt 1921“ als reinen Text.
- `apps/web/app/components/PlatformIcon.vue` existiert und wird in Listen benutzt, ist aber nirgends an echte Verbindungen gekoppelt.

## Bereits vorhanden aus Paket 011

Paket 011 hat `channel_quotas` bereits angelegt: eine Zeile pro Scope/Periode mit einer **nullable** Fremdschlüsselspalte `social_connection_id` auf `social_connections`, plus vier CRUD-Endpunkte (`GET/POST/PATCH/DELETE /v1/channel-quotas`) und `public.count_publications_in_period()`. Vereinsweite Kontingente (`social_connection_id = null`) sind heute nutzbar; kanalspezifische Kontingente lassen sich technisch schon anlegen, sobald irgendeine `social_connections`-Zeile existiert — vor diesem Paket nur per manuellem Insert, nicht über die Produkt-UI (die es für Kanäle noch nicht gibt). `policy_settings.allowed_channel_ids` (ebenfalls aus 011) prüft nur UUID-Syntax, keine Existenz — dieses Paket sollte das nicht als bereits abgesichert annehmen.

## Scope

- Migration: Tokenspalten aus dem Lesepfad nehmen, Kanalzuordnung je Scope, verantwortliche Person je Kanal, Richtlinie für eigene Abteilungskanäle
- Tokenverschlüsselung mit Schlüsselrotation in `packages/publishing` oder einem neuen `packages/secrets`
- OAuth-Anbindung für Meta über Fastify inklusive Statusprüfung und Reconnect
- Durchsetzung im Einplanungs- und Veröffentlichungspfad
- Nuxt: Kanalseite mit Verbinden, Zuordnen, Verantwortung, Status
- `packages/config` an die Meta-Entscheidung anpassen

Nicht enthalten: das eigentliche Veröffentlichen (Paket 006), Insights-Abruf (017), weitere Netzwerke.

## Sicherheitsbefund zuerst

Vor allem anderen: `token_ciphertext` und `token_key_version` dürfen nicht über den Anon-Client lesbar sein. Zwei Maßnahmen, beide nötig:

```sql
-- 1. Spaltenrechte statt Tabellenrechte
revoke select on public.social_connections from authenticated;
grant select (id, organization_id, platform, external_account_id, display_name,
              scopes, token_expires_at, status, last_verified_at, metadata,
              created_at, updated_at)
  on public.social_connections to authenticated;
```

```sql
-- 2. Geheimnisse in eine eigene Tabelle, die authenticated nie erhält
create table public.social_connection_secrets (
  organization_id uuid not null,
  social_connection_id uuid primary key,
  token_ciphertext bytea not null,
  token_key_version text not null,
  refresh_token_ciphertext bytea,
  rotated_at timestamptz not null default now(),
  foreign key (organization_id, social_connection_id)
    references public.social_connections(organization_id, id) on delete cascade
);
alter table public.social_connection_secrets enable row level security;
alter table public.social_connection_secrets force row level security;
-- keine Policy für authenticated. Nur service_role.
grant all privileges on public.social_connection_secrets to service_role;
```

Maßnahme 2 ist die belastbarere: Spaltenrechte sind leicht durch eine spätere `grant all`-Zeile zu verlieren, eine getrennte Tabelle ohne Policy nicht. Ein pgTAP-Test muss belegen, dass `authenticated` aus `social_connection_secrets` keine Zeile liest.

Zwischen „neue Tabelle anlegen“ und „alte Spalten entfernen“ gehört ein Schritt, der leicht übersehen wird: `social_connections.token_ciphertext` ist `not null` (`202608030001:89`), bestehende Zeilen tragen also echte Tokens. Ein `drop column` ohne Umzug macht jede bestehende Verbindung geheimnislos — Reconnect wird zur Pflicht, und bis dahin schlägt jede Veröffentlichung fehl. Die Migration läuft deshalb in dieser Reihenfolge, in einer Transaktion:

```sql
insert into public.social_connection_secrets
  (organization_id, social_connection_id, token_ciphertext, token_key_version)
select organization_id, id, token_ciphertext, token_key_version
  from public.social_connections;

-- Abbruch, wenn nicht jede Verbindung ihr Geheimnis mitgenommen hat.
do $$ begin
  if (select count(*) from public.social_connections)
     <> (select count(*) from public.social_connection_secrets)
  then raise exception 'token backfill incomplete'; end if;
end $$;

alter table public.social_connections drop column token_ciphertext;
alter table public.social_connections drop column token_key_version;
```

Der Backfill kopiert den Ciphertext unverändert; er wird nicht neu verschlüsselt. Die AAD-Bindung an `organizationId` und `socialConnectionId` gilt erst für neu geschriebene Geheimnisse, weshalb `open` beide Formen kennen muss, bis die Rotation einmal durchgelaufen ist. Das ist der eigentliche Zweck des Rotations-Crons und gehört als Testfall dazu.

## Datenmodell

**Nachtrag aus dem Review von Paket 010** (Entscheidung des Nutzers am 2026-08-05): veröffentlichte Beiträge werden vereinsweit sichtbar (siehe Paket 023, „Sichtbarkeit richtet sich nach dem Lebenszyklus“). Dabei kam die Frage auf, ob ein Beitrag auch nur in einem **vertraulichen Kanal** landen kann — dann darf er nicht vereinsweit sichtbar sein. Diese Vertraulichkeit gehört an den Kanal, nicht an den Beitrag: der Einreichende kennt den Kanal noch nicht, die Kanalwahl trifft der Freigebende. Deshalb trägt `social_connections` unten das Feld `confidential boolean not null default false` — ein Beitrag, dessen Veröffentlichungsziele ausschließlich vertrauliche Kanäle sind, bleibt bei der abteilungsweiten Sichtbarkeit. Offen bleibt allein, **wie** die Sichtbarkeitsprüfung dieses Feld auswertet: als eigene Bedingung in `posts_select` oder abgeleitet über das `policy_settings`-Feld `posts_visible_org_wide` aus Paket 023. Beim Umsetzen einen der beiden Wege wählen, nicht beide unabhängig voneinander bauen.

**Stand nach Paket 023** (erledigt am 2026-08-06): `posts_visible_org_wide` und `authz.resolve_policy_flag(...)` existieren bereits real (`supabase/migrations/2026080604_policy_settings_and_invite_rights.sql`) und wirken in `posts_select`/`post_versions_select` bereits als Abteilungs-Ausnahme („diese Abteilung nicht vereinsweit“). Für `confidential` fehlt noch eine Verbindung zum **Kanal** (heute nur Abteilungs-Scope in der Policy) — vermutlich als zusätzliche `exists`-Bedingung in `posts_select`, die prüft, ob für die Beitragsversion mindestens ein *nicht*-vertraulicher Publikationsziel existiert, nicht über `resolve_policy_flag` selbst (das kennt keine Kanäle). Die vereinsweite Sichtbarkeitsprüfung nutzt außerdem `authz.is_any_member_of_organization` (nicht `authz.is_organization_member`) — dieselbe Funktion für eine kanalbezogene Ausnahme wiederverwenden.

Migration `2026080405_channel_scoping_and_secrets.sql`:

```sql
-- Wem gehört der Kanal?
alter table public.social_connections add column owner_scope public.policy_scope not null default 'organization';
alter table public.social_connections add column owner_department_id uuid;
alter table public.social_connections add column responsible_profile_id uuid references public.profiles(id);
alter table public.social_connections add column purpose text;      -- z. B. "Hauptkanal", "Jugendabteilung"
alter table public.social_connections add column archived_at timestamptz;
-- Vertraulicher Kanal: ein Beitrag, der ausschliesslich hierhin veroeffentlicht wird, bleibt
-- von der vereinsweiten Sichtbarkeit ausgenommen (siehe Nachtrag oben und Paket 023).
alter table public.social_connections add column confidential boolean not null default false;
alter table public.social_connections add constraint social_connections_owner_check check (
  (owner_scope = 'organization' and owner_department_id is null) or
  (owner_scope = 'department' and owner_department_id is not null)
);
alter table public.social_connections add constraint social_connections_owner_department_fk
  foreign key (organization_id, owner_department_id)
  references public.departments(organization_id, id) on delete restrict;

-- Wer darf ihn bespielen? Explizite Freigabe, kein implizites Erben.
create table public.channel_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  social_connection_id uuid not null,
  scope public.policy_scope not null,
  department_id uuid, team_id uuid,
  can_schedule boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((scope = 'organization' and department_id is null and team_id is null)
      or (scope = 'department'   and department_id is not null and team_id is null)
      or (scope = 'team'         and department_id is not null and team_id is not null)),
  foreign key (organization_id, social_connection_id) references public.social_connections(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id) references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id, team_id) references public.teams(organization_id, department_id, id) on delete cascade
);

-- Wie bei den Kontingenten in Paket 011: die Scope-Spalten sind bei einer
-- vereinsweiten Freigabe NULL, und NULL ist in einem Unique-Key nicht gleich
-- NULL. Ohne Normalisierung koennte derselbe Kanal zweimal fuer dieselbe Ebene
-- freigegeben sein -- bei unterschiedlichem can_schedule waere unentscheidbar,
-- welche Zeile gilt. Ausdruecke gehen nur im Index, nicht im Constraint.
create unique index channel_scopes_unique on public.channel_scopes (
  social_connection_id, scope,
  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
```

Vereinsweite Richtlinie, ergänzt in `policy_settings` (angelegt in Paket 023, erweitert in 011):

```sql
alter table public.policy_settings add column allow_department_owned_channels boolean;
alter table public.policy_settings add column require_channel_responsible boolean;
```

Beide nur auf Vereinsebene sinnvoll und dort per API erzwungen — eine Abteilung darf sich diese Erlaubnis nicht selbst geben.

**Auflösungsregel für erlaubte Kanäle** eines Beitrags in Scope S:

1. Sammle alle `channel_scopes`-Einträge, die auf S oder eine übergeordnete Ebene von S zeigen.
2. Schneide mit `allowedChannelIds` aus der effektiven Konfiguration (Paket 011) — `null` bedeutet dort keine Einschränkung.
3. Entferne Kanäle mit `status <> 'active'` oder gesetztem `archived_at`.
4. Entferne Kanäle ohne `responsible_profile_id`, falls `require_channel_responsible` gilt.

Ein Kanal ohne jeden `channel_scopes`-Eintrag ist für niemanden bespielbar. Das ist die sichere Richtung: beim Verbinden legt die API automatisch einen Eintrag für die eigene Ebene an, alles Weitere ist eine bewusste Freigabe.

## Umsetzung

### 1. Tokenverschlüsselung

Neues Paket `packages/secrets`:

```ts
export interface SecretBox {
  seal(plaintext: string): { ciphertext: Buffer; keyVersion: string }
  open(ciphertext: Buffer, keyVersion: string): string
}
```

- AES-256-GCM aus `node:crypto`, Schlüssel aus `SOCIAL_TOKEN_KEYS` als JSON-Map `{ "v1": "<base64-32-byte>" }` plus `SOCIAL_TOKEN_KEY_CURRENT`. Alte Versionen bleiben zum Entschlüsseln vorhanden, neu geschrieben wird immer mit der aktuellen.
- Nonce pro Verschlüsselung, im Ciphertext vorangestellt. Auth-Tag angehängt.
- Zusätzliche Daten (AAD): `organizationId` und `socialConnectionId`, damit ein Ciphertext nicht auf eine andere Verbindung umgehängt werden kann.
- Das Paket importiert **kein** Framework und **keine** Provider-SDKs — es ist ein Domainpaket im Sinne von AGENTS.md.
- Ein Hatchet-Cron rotiert Ciphertexte auf die aktuelle Schlüsselversion. Der Workflow-Name muss in `WorkflowNameSchema` ergänzt werden.
- `parseApiEnvironment` erzwingt die Schlüsselvariablen in `production`. Ohne Schlüssel darf die API nicht starten, wenn Kanäle konfiguriert sind.

### 2. OAuth-Anbindung

- `packages/config`: `MIXPOST_BASE_URL` und `MIXPOST_TOKEN` entfernen, `PUBLISHING_PROVIDER` auf `'fake' | 'meta'` ändern, `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `META_OAUTH_REDIRECT_URL` ergänzen. Die heutige Mixpost-Konfiguration widerspricht der getroffenen Architekturentscheidung und ist toter Ballast.
- `GET /v1/channels/connect/:platform/start` → erzeugt `state` als signierten, kurzlebigen Wert mit `organizationId`, `ownerScope`, `departmentId` und Nonce, speichert den Nonce serverseitig und leitet zum Meta-Dialog weiter. **`state` niemals ungeprüft zurückvertrauen.**
- `GET /v1/channels/connect/:platform/callback` → prüft `state`, tauscht Code gegen Token, ruft die verfügbaren Seiten und Instagram-Business-Konten ab und zeigt sie zur Auswahl. Erst nach Auswahl entsteht die `social_connections`-Zeile plus `social_connection_secrets`. Es entstehen nie Zeilen für Konten, die der Nutzer nicht ausgewählt hat.
- Token: Meta-Nutzertoken werden gegen ein langlebiges Seiten-Token getauscht. `token_expires_at` wird gesetzt, `scopes` festgehalten.
- `POST /v1/channels/:id/verify` → prüft die Verbindung, aktualisiert `status` und `last_verified_at`. Ein Cron prüft täglich alle Verbindungen und setzt `status = 'action_required'`, sobald ein Token in weniger als sieben Tagen abläuft oder die Prüfung fehlschlägt.
- Reconnect erhält die bestehende Zeile und ersetzt nur das Geheimnis, damit `publications`-Historie und `channel_scopes` nicht verloren gehen. Das ist der Grund, warum `external_account_id` Teil des Unique-Keys ist (`202608030001:90`).
- `DELETE /v1/channels/:id` trennt: `status = 'disconnected'`, `archived_at` gesetzt, Geheimnis gelöscht. Die Zeile bleibt, weil `publications` per FK darauf verweist (`:97`).

### 3. Zuordnung und Verantwortung

- `POST`/`DELETE /v1/channels/:id/scopes` — nur mit `social_account.manage`; ein Abteilungsadmin darf ausschließlich Kanäle freigeben, die seine eigene Abteilung besitzt.
- `PATCH /v1/channels/:id` für `display_name`, `purpose`, `responsible_profile_id`.
- Eigener Abteilungskanal: `POST .../connect/:platform/start` mit `ownerScope = 'department'` wird mit 403 abgewiesen, wenn `allow_department_owned_channels` nicht gilt. Die Fehlermeldung nennt den Grund und die zuständige Ebene, damit die Abteilung weiß, wen sie fragen muss.
- Die verantwortliche Person muss Mitglied im Verein sein. Paket 010 verhindert ihr Entfernen, solange sie zugewiesen ist.

### 4. Durchsetzung

`resolveAvailableChannels(scope)` ist die einzige Funktion, die entscheidet, welche Kanäle wählbar sind, und wird benutzt von:

- der Auswahl beim Einplanen in der Oberfläche
- dem Einplanungsendpunkt
- dem `publish-content`-Workflow unmittelbar vor dem Provideraufruf

Die dritte Prüfung ist nicht redundant: zwischen Planung und Ausführung kann ein Token ablaufen, eine Freigabe entzogen oder ein Kontingent erschöpft werden. Fällt sie negativ aus, wird die Publikation auf `action_required` gesetzt und **nicht** blind wiederholt — das entspricht der Regel aus `plans/README.md`, nach einem unklaren Ergebnis zu reconciliieren statt zu retryen.

**Wichtig für die Umsetzung**: der tatsächliche Einplanungspfad aus Paket 011 ist `POST /v1/post-versions/:id/schedule` → die SQL-Funktion `public.schedule_publication` (`security definer`, `grant execute … to authenticated` — direkt per RPC erreichbar, wie jede privilegierte Funktion in diesem Projekt). Diese Funktion kennt heute nur `allowedChannelIds` und das Kontingent; sie kennt keine Kanal-Scope-Zuordnung, keinen `archived`/`confidential`-Status und keine verantwortliche Person, weil diese Konzepte erst mit diesem Paket entstehen. `resolveAvailableChannels(scope)` allein reicht nicht — wer die neuen Prüfungen durchsetzen will, muss den **Funktionskörper von `schedule_publication` selbst ändern**, sonst bleibt der direkte RPC-Aufruf ein Bypass genau der Art, die Paket 011 adversarial bei `request_approval` gefunden und beheben musste (siehe `plans/011-regelwerk-richtlinien-und-kontingente.md`, Abschnitt „Umsetzung: Ergebnis und Abweichungen vom Plan“).

### 5. Oberfläche

Neue Seite `pages/kanaele.vue`:

- Karten je Kanal: Plattform, Kontoname, Zweck, Besitzebene, Status als Ampel, Tokenablauf im Klartext („läuft in 34 Tagen ab“), verantwortliche Person, letzte Prüfung
- `action_required` ist prominent und nennt die konkrete Handlung („Verbindung erneuern“), nicht nur den Zustand
- Zuordnungsmatrix: Abteilungen und Teams als Zeilen, Kanäle als Spalten, Häkchen für Freigaben. Für einen Verein mit vier Abteilungen und zwei Kanälen ist das eine Ansicht, die man in fünf Sekunden versteht.
- Hinweisblock zu den rechtlichen Pflichten, die an einem Kanal hängen — Details und Verlinkung liefert Paket 020
- Empty State: „Noch ist kein Kanal verbunden. Ihr könnt Beiträge vorbereiten, aber nicht veröffentlichen.“ Diese Formulierung ist wichtig, weil sie ehrlich beschreibt, was fehlt.

### 6. Rückbau

| Ort | Heute | Danach |
|---|---|---|
| `pages/einstellungen.vue:1` | ✓ bereits mit Paket 011 entfernt (Seite wurde vollständig zur Richtlinienseite) | echte Verbindungen auf `pages/kanaele.vue` — ✓ erledigt |
| `packages/config:172-174` | ✓ `PUBLISHING_PROVIDER: 'fake' \| 'meta'`, Meta-App-Variablen | erledigt |
| `social_connections.token_ciphertext` für `authenticated` lesbar | ✓ Geheimnisse in `social_connection_secrets` ohne Policy für `authenticated` | erledigt |
| Publikationsziele im Beitragsentwurf | `resolveAvailableChannels`/`GET /v1/post-versions/:id/available-channels` existieren, haben aber noch keinen Aufrufer | offen, bis Paket 005/006 einen echten Submission→Post-Pfad bauen (dieselbe Lücke, die Paket 011 bereits für Freigabe/Einplanung dokumentiert hat) |

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- pgTAP: `authenticated` liest keine Zeile aus `social_connection_secrets`; `select token_ciphertext` auf `social_connections` schlägt fehl bzw. die Spalte existiert nicht mehr; `channel_scopes` mit falscher Scope-Kombination verstößt gegen CHECK; **zwei vereinsweite `channel_scopes`-Zeilen für denselben Kanal verstoßen gegen den Unique-Index** — mit `NULL` in `department_id` und `team_id`, also genau dem Fall, den ein gewöhnlicher Unique-Key durchlässt; Abteilungskanal ohne `owner_department_id` verstößt gegen CHECK.
- `packages/secrets`-Tests: Runde durch `seal`/`open`; Entschlüsselung mit falscher `keyVersion` schlägt fehl; Entschlüsselung mit fremder AAD schlägt fehl; verändertes Ciphertext-Byte schlägt fehl (GCM-Auth-Tag); ein aus dem Backfill übernommenes Geheimnis ohne AAD ist lesbar und wird von der Rotation auf die aktuelle Form gehoben.
- Migrationstest: eine bestehende Verbindung mit Token behält nach der Migration ihr Geheimnis in `social_connection_secrets`; ein künstlich unterbrochener Backfill lässt die Migration scheitern statt die Spalten zu entfernen.
- API-Tests: Callback mit manipuliertem `state` → 400; Abteilungskanal bei verbotener Richtlinie → 403; Einplanen auf nicht freigegebenem Kanal → 409; Einplanen auf Kanal mit `action_required` → 409.
- manuell mit Meta-Testkonto: verbinden, Konto wählen, Kanal erscheint aktiv; Abteilung freigeben, Beitrag dort einplanbar; Freigabe entziehen, Kanal verschwindet aus der Auswahl; Token in der Datenbank manuell invalidieren, täglicher Check setzt `action_required`.

## Risiken und offene Entscheidungen

- **Meta-App-Review** ist ein externes Gate. `instagram_content_publish`, `pages_manage_posts` und `pages_read_engagement` erfordern eine geprüfte App mit Datenschutzerklärung, Löschanfrage-Endpunkt und Demonstrationsvideo. Das blockiert nicht die Implementierung gegen Testkonten, aber den Pilotbetrieb. Vorlauf einplanen.
- **Instagram-Voraussetzungen**: Publishing über die Graph API verlangt ein Instagram-**Professional**-Konto, verknüpft mit einer Facebook-Seite. Ein privates Vereinskonto funktioniert nicht. Das muss die Oberfläche beim Verbinden erklären, sonst wird jeder Fehlschlag als Softwarefehler gelesen.
- **Schlüsselmanagement**: `SOCIAL_TOKEN_KEYS` in Umgebungsvariablen ist für den Start angemessen und für den Dauerbetrieb dünn. Ein KMS oder Supabase Vault ist der nächste Schritt; das Interface `SecretBox` ist genau dafür die Grenze.
- **Ein Konto in zwei Vereinen**: `unique (organization_id, platform, external_account_id)` erlaubt dasselbe Instagram-Konto in zwei Vereinen. Technisch unkritisch, fachlich ein Warnsignal. Beim Verbinden sollte ein Hinweis erscheinen, wenn das Konto bereits anderswo verbunden ist — ohne den anderen Verein zu nennen.
- **`policy_scope`-Enum** wird hier mitgenutzt; angelegt wird es in Paket 023 (nicht mehr in 011). Wird 012 vor 023 umgesetzt, muss der Typ in dieser Migration entstehen. Reihenfolge einhalten oder Abhängigkeit auflösen.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt in einer Migration (`2026080701_channel_scoping_and_secrets.sql`), `resolveAvailableChannels` in `packages/domain`, den entsprechenden Contracts-Erweiterungen, den API-Endpunkten für Kanalverwaltung, Zuordnung und OAuth (`apps/api/src/app.ts`), `MetaOAuthClient`/`RealMetaOAuthClient`/`FakeMetaOAuthClient` in `packages/publishing`, und der Oberfläche auf `pages/kanaele.vue`. 267 pgTAP-Tests (30 neue in `channel_scoping_and_secrets.test.sql`, plus eine Fixture-Korrektur in `policy_review_routes.test.sql`, siehe unten), 72 API-Tests, 40 Domain-Tests, 7 Publishing-Tests, `pnpm lint`/`typecheck`/`test`/`build` grün, `pnpm db:reset`/`db:test` grün, manuell im Browser gegengeprüft (Richtlinien-Checkboxen mit echtem PUT-Roundtrip nach Reload, Abteilungskanal-Auswahl erscheint/verschwindet abhängig von `allow_department_owned_channels`, `GET .../connect/instagram/start` liefert gegen den echten lokalen Stack eine korrekt aufgebaute Meta-Autorisierungs-URL, `GET .../connect/instagram/callback` mit ungültigem `state` leitet mit der richtigen Fehlermeldung auf `/kanaele` um). Ohne echte Meta-App-Zugangsdaten ungetestet: der tatsächliche Code-Tausch, Kontoauswahl und Veröffentlichung gegen ein reales Testkonto — das bleibt das externe Gate aus „Risiken und offene Entscheidungen“.

### Abweichungen von der Phase-1-Evidenz

- **`packages/secrets` existierte bereits** (aus Paket 011, für LLM-Provider-Schlüssel) mit exakt dem im Plan skizzierten `SecretBox`-Interface, aber unter den Umgebungsvariablen `SECRET_BOX_KEYS`/`SECRET_BOX_CURRENT_KEY_VERSION` statt der geplanten `SOCIAL_TOKEN_KEYS`/`SOCIAL_TOKEN_KEY_CURRENT`. Kein neues Paket angelegt — Social-Connection-Tokens teilen sich denselben Schlüsselsatz. Der Helfer `createSecretBoxFromEnvironment`/`ciphertextToBytea` zog von `apps/api/src/llmProviders.ts` nach einer neuen `apps/api/src/secretBox.ts`, damit ein zweiter, kanalfremder Aufrufer nicht aus einer LLM-spezifischen Datei importiert.
- **`pages/einstellungen.vue`s Rückbau-Zeile war bereits erledigt**: Paket 011 hatte die Seite vollständig zur Richtlinienseite umgebaut und die hartkodierten „Instagram Verbunden“-Zeilen dabei bereits entfernt. Nichts mehr zurückzubauen.

### Entscheidungen, die der Plan offenließ

- **OAuth-Zwischenspeicher**: der Plan beschreibt den Ablauf (Token tauschen, verfügbare Konten anzeigen, erst nach Auswahl eine `social_connections`-Zeile anlegen), legt aber kein Schema dafür fest. Umgesetzt als zwei neue, `service_role`-only Tabellen ohne jede Policy für `authenticated` (`oauth_states` für den Nonce, `oauth_pending_connections` für die abgerufene Kontenliste) — dasselbe Schutzniveau wie `social_connection_secrets`. Jeder Seiten-Zugriffstoken in `available_accounts` ist einzeln versiegelt (AAD = `pendingId:externalAccountId`), nicht die ganze Zeile auf einmal; das Nutzertoken selbst wird nach dem Abruf der Konten nicht weiter aufbewahrt, da nur die bereits abgeleiteten Seiten-Tokens gebraucht werden.
- **`GET /v1/channels/connect/:platform/start` antwortet mit JSON, nicht mit einem Redirect**: eine vollständige Browser-Navigation trägt keinen `Authorization`-Header, ein `requireAuth` auf diesem Pfad wäre also nie erfüllbar gewesen. Die Oberfläche ruft den Endpunkt per `fetch` auf und navigiert danach selbst zur zurückgelieferten `authorizationUrl`. Nur `.../callback` (von Meta direkt angesteuert) läuft ohne `requireAuth`, mit dem `state`-Nonce als alleiniger Vertrauensgrenze.
- **`department_admin` hatte keine `social_account.manage`-Berechtigung**: weder in `packages/authorization` noch im SQL-Gegenstück gab es vor diesem Paket eine abteilungsscoped Rolle mit dieser Permission (`social_manager` ist eine Vereinsrolle) — ein Abteilungsadmin hätte nie einen abteilungseigenen Kanal verwalten können, obwohl genau das der Zweck des Features ist. Ergänzt in beiden Permission-Tabellen, mit Kommentar zur Begründung.
- **`social_connections`' bestehende `connections_select`-Policy verlangte `is_organization_member`** (eine Organisationsrolle) statt `is_any_member_of_organization`. Ein reiner Abteilungsadmin ohne Organisationsrolle konnte dadurch die eigene, abteilungseigene Kanalzeile nicht lesen — was `channel_scopes_insert`s `EXISTS`-Unterabfrage gegen `social_connections` unterläuft, da Unterabfragen in RLS-Policies der RLS der referenzierten Tabelle unterliegen (beim eigenen Review dieses Pakets gefunden, siehe unten). Auf `is_any_member_of_organization` geweitet, analog zu `channel_quotas_select` aus Paket 011.
- **Vertraulichkeits-Sichtbarkeit ist fail-open bei fehlender Publikation, nicht fail-closed**: der erste Entwurf von `authz.post_is_not_confidential_only` verweigerte die vereinsweite Sichtbarkeit, sobald zur aktuellen Version keine `publications`-Zeile existierte — das brach bestehende `post_visibility.test.sql`-Fälle, die einen Beitrag direkt auf `published` setzen, ohne je `schedule_publication` durchlaufen zu haben (ein legitimes Testmuster, kein unmöglicher Produktionszustand, den man erzwingen müsste). Korrigiert: restriktiv wird es nur, wenn Publikationen existieren **und** alle davon vertraulich sind; keine Publikation ist keine Aussage über Vertraulichkeit.
- **Kein Hatchet-Cron für Token-Ablaufprüfung und Schlüsselrotation**: der Stack hat weiterhin keinen Scheduler (Paket 004 bleibt „in Arbeit“) — dieselbe Lage wie bei `mark_stalled_approval_stages()` aus Paket 011. `flag_channels_needing_reconnect()` und `cleanup_expired_oauth_state()` existieren als fertige, nur für `service_role` aufrufbare SQL-Funktionen, die ein künftiger Scheduler lediglich verdrahten muss.

### Beim eigenen Review dieses Pakets gefunden und behoben

- **`channel_scopes_insert` schlug für jeden reinen Abteilungsadmin fehl**, unabhängig davon, ob er den Kanal besaß: die RLS-Policy prüft per `EXISTS`-Unterabfrage gegen `social_connections`, und diese Unterabfrage unterliegt selbst `social_connections`' eigener `SELECT`-Policy — die (siehe oben) eine Organisationsrolle verlangte. Ohne die Weitung von `connections_select` wäre die gesamte Abteilungskanal-Freigabe für jeden Abteilungsadmin ohne Organisationsrolle unbenutzbar gewesen.
- **`department_admin` fehlte `social_account.manage` vollständig** (siehe oben) — ohne diese Ergänzung hätte keine Rolle einen abteilungseigenen Kanal verwalten können.
- **Row-Null-Semantik bei `IS NOT NULL` auf einem Composite-Rückgabewert**: ein pgTAP-Test prüfte `schedule_publication(...) is not null`, was bei einem teilweise `NULL`-wertigen Feld (hier `scheduled_for`) in Postgres auf `false` auswertet, obwohl die Zeile selbst existiert — reine Testkorrektur (`select status from ...` statt `... is not null`), kein Code-Fund.
