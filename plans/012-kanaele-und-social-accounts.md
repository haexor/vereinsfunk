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

**Nachtrag aus dem Review von Paket 010** (Entscheidung des Nutzers am 2026-08-05): veröffentlichte Beiträge werden vereinsweit sichtbar (siehe Paket 011, „Vereinsweite Sichtbarkeit veröffentlichter Beiträge“). Dabei kam die Frage auf, ob ein Beitrag auch nur in einem **vertraulichen Kanal** landen kann — dann darf er nicht vereinsweit sichtbar sein. Diese Vertraulichkeit gehört an den Kanal, nicht an den Beitrag: der Einreichende kennt den Kanal noch nicht, die Kanalwahl trifft der Freigebende. Deshalb hier ein Feld `confidential boolean not null default false` auf `social_connections` — ein Beitrag, dessen Veröffentlichungsziele ausschließlich vertrauliche Kanäle sind, bleibt bei der abteilungsweiten Sichtbarkeit. Ob das über die Kanalvertraulichkeit oder allein über das `policy_settings`-Feld `posts_visible_org_wide` aus 011 gelöst wird, ist beim Umsetzen zu entscheiden — nicht beides unabhängig voneinander bauen.

Migration `2026080405_channel_scoping_and_secrets.sql`:

```sql
-- Wem gehört der Kanal?
alter table public.social_connections add column owner_scope public.policy_scope not null default 'organization';
alter table public.social_connections add column owner_department_id uuid;
alter table public.social_connections add column responsible_profile_id uuid references public.profiles(id);
alter table public.social_connections add column purpose text;      -- z. B. "Hauptkanal", "Jugendabteilung"
alter table public.social_connections add column archived_at timestamptz;
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

Vereinsweite Richtlinie, ergänzt in `policy_settings` aus Paket 011:

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
| `pages/einstellungen.vue:1` | „Instagram Verbunden · @sv_nordstadt“, „Facebook Verbunden · SV Nordstadt 1921“ | echte Verbindungen auf `pages/kanaele.vue`, Zeilen aus den Einstellungen entfernt |
| `packages/config:172-174` | `PUBLISHING_PROVIDER: 'fake' \| 'mixpost'`, Mixpost-URL und -Token | `'fake' \| 'meta'`, Meta-App-Variablen |
| `social_connections.token_ciphertext` für `authenticated` lesbar | Grant und Policy umfassen die ganze Tabelle | Geheimnisse in eigener Tabelle ohne Policy |
| Publikationsziele im Beitragsentwurf | ✓ 008: `useDemoData.ts` mit seinen `platforms`-Strings gelöscht, Liste ist ein Empty State | echte Ziele aus `channel_scopes` und `publications` |

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
- **`policy_scope`-Enum** wird hier aus Paket 011 mitgenutzt. Wird 012 vor 011 umgesetzt, muss der Typ in dieser Migration entstehen. Reihenfolge einhalten oder Abhängigkeit auflösen.
