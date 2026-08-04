# 018 – Resonanz- und Sentimentanalyse

## Ergebnis

Der Verein sieht nicht nur, wie viele Menschen einen Beitrag gesehen haben, sondern wie er aufgenommen wurde: überwiegend zustimmend, gemischt, ablehnend. Auffällige Beiträge werden benannt — was besonders gut ankam und was nicht — und mit Anlass, Format und Kanal in Beziehung gesetzt. Kommentare, die Aufmerksamkeit brauchen, werden sichtbar, ohne dass jemand ständig die App der Plattform beobachtet.

## Warum dieses Paket ein eigenes Gate hat

Bis Paket 017 verarbeitet das System aggregierte Zahlen. Ab hier werden **Texte fremder Personen** verarbeitet, die nie mit uns in Kontakt getreten sind: Kommentare von Eltern, Mitgliedern, Gegnern, Fremden. Das sind personenbezogene Daten Dritter, verarbeitet ohne deren Einwilligung, und im Fall der Sentimentbewertung auch bewertet.

Das ist machbar und in der Praxis verbreitet, aber es ist eine Verarbeitung mit eigener Rechtsgrundlage, eigener Aufbewahrungsfrist, eigenem Löschkonzept und eigener Erwähnung im Verzeichnis der Verarbeitungstätigkeiten. Zusätzlich verlässt Kommentartext beim LLM-Aufruf das System, sofern kein lokales Modell verwendet wird.

Verbindliche Grenzen dieses Pakets:

> Es entstehen keine Personenprofile. Kommentare werden nicht personenbezogen gespeichert, nicht über Beiträge hinweg zusammengeführt und nicht nach Autor durchsuchbar gemacht. Es gibt keine Bewertung von Personen, nur von Beiträgen.

> Kommentartexte werden nach kurzer Frist gelöscht. Erhalten bleiben die aggregierten Bewertungen, nicht das Material.

Ohne diese beiden Zusagen ist das Paket nicht verantwortbar, und mit ihnen liefert es fast denselben Nutzen.

## Ausgangslage und Evidenz

Geplant auf `b5c2eda6` am 2026-08-04.

- Paket 017 liefert `publication_metrics` mit `comments` als Zahl. Der Sprung von der Zahl zum Inhalt ist der Gegenstand dieses Pakets.
- `packages/config/src/index.ts:17` enthält `OPENAI_API_KEY` als optionales Secret. Es gibt **keinen LLM-Adapter im Code** — `packages/content-engine` liefert ausschließlich `FakeContentGenerator` (`src/index.ts:18-42`). Das erste echte Modell im Projekt wäre entweder hier oder in Paket 001; die Adaptergrenze muss für beide taugen.
- `packages/contracts/src/index.ts:94` `SafetyFlagSchema` kennt `minor`, `missing_consent`, `uncertain_fact`, `sensitive_data`. Für Kommentarbewertung braucht es eigene Kategorien; diese Flags sind für Inhalte gedacht, nicht für Reaktionen.
- `plans/README.md` schließt „Gesichtserkennung, Personenabgleich oder biometrische Datenhaltung“ aus. Der Geist dieser Regel — keine Profile über Personen — gilt hier analog und wird oben ausdrücklich übernommen.
- `apps/api/src/app.ts:44` redigiert bereits `'*.access_token'` und `'*.media'` in Logs. Kommentartexte gehören in dieselbe Liste, sobald sie durch die API laufen.

## Scope

- Rechtsgrundlage, Aufbewahrung und Löschkonzept festlegen und dokumentieren
- Migration: Kommentar-Rohdaten mit kurzer Frist, Bewertungen mit langer Frist
- `packages/publishing`: `CommentsProvider` für Meta
- `packages/content-engine` oder neues `packages/text-analysis`: LLM-Adapter mit Structured Output, plus Fake-Adapter
- Hatchet-Workflow zum Abholen und Bewerten
- Oberfläche: Resonanz je Beitrag, Vergleich nach Anlass, Hinweisliste für Kommentare, die Aufmerksamkeit brauchen
- Opt-in je Verein

Nicht enthalten: Antworten auf Kommentare aus unserem System heraus, Moderation oder Löschen fremder Kommentare, Direktnachrichten, Erkennung einzelner Personen, Übersetzung.

## Rechtliche Einordnung

Der Verein ist Verantwortlicher, wir sind Auftragsverarbeiter. Der Verein braucht eine Rechtsgrundlage; in Betracht kommt ein berechtigtes Interesse an der Auswertung der Reaktionen auf eigene Veröffentlichungen — enger gefasst und leichter zu begründen als eine allgemeine Kommentaranalyse.

Praktische Folgen, die den Entwurf bestimmen:

- **Opt-in je Verein**, nicht per Default aktiv. Eine Richtlinie in `policy_settings` (Paket 011) schaltet es ein, mit einem erklärenden Text vor der Aktivierung.
- **Aufbewahrung Kommentartext: 30 Tage.** Danach löscht ein Job den Text und behält die Bewertung. Der Wert ist konfigurierbar nach unten, nicht nach oben.
- **Kein Autorname, keine Autor-ID im Klartext.** Die Plattform liefert beides; gespeichert wird nur ein gepfefferter Hash, ausschließlich zur Erkennung mehrfacher Kommentare am **selben** Beitrag. Über Beiträge hinweg wird nicht verknüpft — dafür wird der Pfeffer pro Publikation abgeleitet, sodass derselbe Autor an zwei Beiträgen verschiedene Hashes erhält.
- **Auftragsverarbeitung mit dem LLM-Anbieter** ist Voraussetzung, inklusive Zusicherung, dass Eingaben nicht zum Training verwendet werden, und Klarheit über den Verarbeitungsort. Ohne diesen Vertrag darf das Paket nicht produktiv gehen. Ein lokal betriebenes Modell wäre die Alternative mit dem geringsten Übermittlungsrisiko und dem höchsten Betriebsaufwand.
- Aufnahme in das Verarbeitungsverzeichnis und in die Datenschutzerklärung des Vereins (Paket 020).

## Datenmodell

Migration `2026080411_comment_sentiment.sql`:

```sql
-- Rohtext mit kurzer Lebensdauer.
create table public.publication_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publication_id uuid not null,
  external_comment_id text not null,
  author_hash text not null,              -- pro Publikation abgeleitet, nicht global
  body text,                              -- wird nach der Frist auf null gesetzt
  body_language text,
  is_reply boolean not null default false,
  like_count integer,
  published_at timestamptz not null,
  collected_at timestamptz not null default now(),
  purge_after date not null,
  purged_at timestamptz,
  unique (publication_id, external_comment_id),
  unique (organization_id, id),
  foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade
);
create index publication_comments_purge_idx on public.publication_comments (purge_after)
  where purged_at is null;

-- Bewertung mit langer Lebensdauer.
create table public.comment_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publication_comment_id uuid not null,
  sentiment text not null check (sentiment in ('positive','neutral','negative','mixed','unclear')),
  confidence numeric(4,3) check (confidence >= 0 and confidence <= 1),
  categories text[] not null default '{}',
  needs_attention boolean not null default false,
  attention_reason text,
  model_key text not null, prompt_version text not null, schema_version text not null,
  assessed_at timestamptz not null default now(),
  unique (publication_comment_id, prompt_version),
  foreign key (organization_id, publication_comment_id)
    references public.publication_comments(organization_id, id) on delete cascade
);

-- Aggregat je Publikation; überlebt die Löschung der Texte.
create table public.publication_resonance (
  organization_id uuid not null,
  publication_id uuid not null,
  comments_total integer not null default 0, comments_assessed integer not null default 0,
  positive integer not null default 0, neutral integer not null default 0,
  negative integer not null default 0, mixed integer not null default 0, unclear integer not null default 0,
  needs_attention integer not null default 0,
  top_categories text[] not null default '{}',
  computed_at timestamptz not null default now(),
  primary key (organization_id, publication_id),
  foreign key (organization_id, publication_id)
    references public.publications(organization_id, id) on delete cascade
);
```

`purge_after` als Spalte statt als Berechnung: die Frist wird beim Anlegen festgeschrieben. Ändert ein Verein später seine Einstellung, gilt für Bestandsdaten die kürzere der beiden Fristen — nie die längere.

`unique (publication_comment_id, prompt_version)` erlaubt Neubewertung mit einem neuen Prompt, ohne die alte zu verlieren. Das ist notwendig, um eine Modelländerung zu bewerten, statt ihr zu vertrauen.

`categories` als offene Zeichenkettenliste mit einer in `packages/domain` gepflegten Menge: `praise`, `question`, `criticism`, `correction`, `off_topic`, `spam`, `insult`, `personal_data`, `minor_mentioned`, `legal_concern`.

`needs_attention` ist der praktisch wertvollste Teil dieses Pakets. Eine Beleidigung, eine Frage, ein Hinweis „das Kind auf Bild 2 darf nicht gezeigt werden“ oder ein Kommentar, der selbst personenbezogene Daten enthält — das sind Dinge, auf die ein Verein reagieren muss. Sie sind wichtiger als jede Sentimentstatistik und werden deshalb getrennt geführt, nicht in einer Prozentzahl aufgelöst.

RLS: `publication_comments` und `comment_assessments` nur mit `analytics.view` **und** aktiviertem Opt-in lesbar. Schreiben ausschließlich über Service Role. `body` per Spaltenrechten weiter einschränken, damit nicht jede Person mit Leserecht Fremdtexte liest.

## Umsetzung

### 1. Kommentare abholen

`packages/publishing/src/comments.ts`:

```ts
export interface ExternalComment {
  externalId: string; authorReference: string
  body: string; publishedAt: string
  isReply: boolean; likeCount?: number
}
export interface CommentsProvider {
  readonly platform: Platform
  fetchComments(input: { externalId: string; since?: Date }): AsyncIterable<ExternalComment>
}
```

- `authorReference` wird vom Adapter geliefert und **vor dem Speichern** gehasht. Er darf die Adaptergrenze nicht im Klartext überschreiten — der Hash entsteht in der Schicht, die schreibt, mit dem publikationsspezifischen Pfeffer.
- Meta-Adapter über `/{media-id}/comments` bzw. `/{post-id}/comments`. Braucht `pages_read_engagement` und für Instagram `instagram_manage_comments`, also ein weiteres App-Review-Element über Paket 017 hinaus.
- Abrufplan gestaffelt wie in 017, aber kürzer: +6 h, +24 h, +72 h, +7 Tage. Danach nicht mehr — späte Kommentare an alten Beiträgen sind selten und rechtfertigen keinen dauerhaften Abruf.
- Kommentare, die auf der Plattform gelöscht wurden, werden bei uns ebenfalls gelöscht, wenn sie in einem Abruf fehlen. Wer seinen Kommentar zurückzieht, soll ihn nicht in unserer Datenbank überleben lassen.

### 2. Bewertung

Neues Paket `packages/text-analysis`:

```ts
export interface SentimentAnalyzer {
  readonly modelKey: string
  readonly promptVersion: string
  analyze(input: readonly { id: string; body: string }[]): Promise<readonly CommentAssessment[]>
}
```

- **Redaktion vor der Übermittlung, nicht danach.** `analyze()` bekommt `body` und schickt ihn an das Modell; die Kategorie `personal_data` kommt aus derselben Antwort **zurück**. Damit ist der Kommentar längst übermittelt, wenn festgestellt wird, dass er Namen, Adressen oder Kontaktdaten Dritter enthält — die Kategorie ist ein Befund, keine Kontrolle. Vor dem Aufruf läuft deshalb eine regelbasierte Vorredaktion: E-Mail-Adressen, Telefonnummern, Straßen mit Hausnummer, URLs und die Namen aus `directory_people` desselben Vereins werden durch Marker wie `[NAME]`, `[MAIL]` ersetzt. Was ersetzt wurde, wird gezählt und protokolliert, nicht im Klartext. Die Bewertung arbeitet auf dem redigierten Text; für die Aufmerksamkeitsliste bleibt der Originaltext lokal und wird dort angezeigt.
  - Das ist bewusst grob und fängt nicht jeden Fall. Es senkt die Menge übermittelter Personendaten deutlich, und mehr ist ohne genau die Personenerkennung nicht erreichbar, die dieses Paket ausschließt. Ein Verein, der auch dieses Restrisiko nicht tragen will, braucht das lokal betriebene Modell — deshalb bleibt die Adaptergrenze in beide Richtungen offen.
- Structured Output per Zod-Schema, damit die Antwort validiert und nicht geparst wird. Ungültige Antworten werden verworfen und als `unclear` protokolliert, nie geraten.
- Stapelverarbeitung: 20 Kommentare pro Aufruf senkt Kosten deutlich. Die Zuordnung erfolgt über mitgegebene IDs, und eine Antwort mit fehlenden oder zusätzlichen IDs wird komplett verworfen — teilweise Zuordnung ist die stille Fehlerquelle bei Stapeln.
- **Prompt-Regeln**: bewerte den Kommentar in Bezug auf den Beitrag, nicht die Person; gib `unclear` bei Ironie, Dialekt oder zu kurzem Text; erfinde keine Kategorie; melde `personal_data`, wenn der Kommentar Namen, Adressen oder Kontaktdaten Dritter enthält.
- `FakeSentimentAnalyzer` mit deterministischer Regelheuristik für lokale Entwicklung und Tests, gewählt über die Konfiguration.
- Kostengrenze je Verein und Monat, konfigurierbar. Wird sie erreicht, stoppt die Bewertung, die Kommentare bleiben unbewertet und die Oberfläche sagt das. Eine unbegrenzte LLM-Ausgabe an einer eingehenden Datenmenge ist ein offenes Kostenrisiko.
- Bewertung läuft im Worker, nie in der API und nie im Browser. Der Kommentartext darf nicht durch einen Request-Log laufen; `redact` in `apps/api/src/app.ts:44` wird um die entsprechenden Pfade erweitert.

### 3. Löschjob

Täglicher Hatchet-Cron:

- setzt `body = null` und `purged_at = now()` für alle Zeilen mit `purge_after <= today`
- die Bewertung bleibt, das Aggregat bleibt
- ein Test prüft, dass nach der Frist **kein** Kommentartext mehr auffindbar ist, auch nicht in `comment_assessments` oder in einem Aggregatfeld

Dieser Job ist keine Aufräumarbeit, sondern die Einhaltung einer Zusage. Er gehört mit derselben Aufmerksamkeit getestet wie das Medien-Gate.

### 4. Oberfläche

- Je Beitrag ein Resonanzbalken positiv/neutral/negativ mit der Anzahl bewerteter Kommentare daneben. Bei weniger als fünf Kommentaren wird **kein** Verhältnis angezeigt, nur die Einzelbewertungen — bei drei Kommentaren ist „67 % positiv“ irreführend.
- Vergleich nach Anlass, Format und Kanal: „Trainingseinblicke kommen bei euch besser an als Spielergebnisse“, immer mit der zugrunde liegenden Anzahl.
- Liste „Braucht eure Aufmerksamkeit“ mit Beitragsbezug und Grund. Verlinkt auf den Kommentar bei der Plattform, weil dort geantwortet wird — nicht bei uns.
- Ehrlicher Hinweis zur Verlässlichkeit: automatische Sentimentbewertung irrt bei Ironie und Dialekt regelmäßig. Ein Satz an der richtigen Stelle verhindert, dass ein Verein aus einer Fehlklassifikation Schlüsse zieht.
- Deutlich sichtbar, dass und wann Kommentartexte gelöscht werden.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:reset`, `pnpm db:test`
- Adaptertests gegen aufgezeichnete Antworten; Autorreferenz erscheint nirgends im Klartext; derselbe Autor erhält an zwei Publikationen verschiedene Hashes.
- Analyzer-Tests: Stapel mit fehlender ID in der Antwort wird vollständig verworfen; ungültige Kategorie wird verworfen; Kostengrenze stoppt die Verarbeitung; deterministischer Fake liefert stabile Ergebnisse.
- Redaktionstests: ein Kommentar mit E-Mail-Adresse, Telefonnummer und dem Namen eines Kindes aus dem Verzeichnis erreicht den Adapter ausschließlich mit Markern — geprüft am Aufrufargument, nicht am Ergebnis. Das ist der Test, der die Zusage dieses Abschnitts trägt.
- Löschtests: nach `purge_after` ist `body` `null`, das Aggregat unverändert, die Bewertung erhalten; **eine Volltextsuche über alle Tabellen findet den Text nicht mehr.**
- pgTAP: Kommentare sind ohne `analytics.view` unsichtbar; Kommentare sind bei deaktiviertem Opt-in unsichtbar; `body` ist ohne erweiterte Berechtigung nicht lesbar; Kommentare eines fremden Vereins sind unsichtbar.
- manuell: Beitrag mit Kommentaren auf einem Testkonto, Abruf, Bewertung, Resonanzanzeige; ein beleidigender Testkommentar erscheint in der Aufmerksamkeitsliste; Löschfrist manuell vordatieren, Text verschwindet, Auswertung bleibt.

## Risiken und offene Entscheidungen

- **Rechtsgrundlage** ist die eigentliche Hürde, nicht die Technik. Sie sollte vor der Umsetzung geprüft werden, weil das Ergebnis den Umfang bestimmt: fällt die Bewertung fremder Texte weg, bleibt die reine Kommentarzahl aus Paket 017, und dieses Paket entfällt.
- **Übermittlung an einen LLM-Anbieter**: ohne Auftragsverarbeitungsvertrag und Trainingsausschluss ist der Betrieb nicht vertretbar. Ein europäisch gehostetes oder selbst betriebenes Modell ist die risikoärmere Variante und sollte im Vergleich bewertet werden.
- **Qualität deutscher Sentimentanalyse** bei Vereinssprache, Dialekt, Emojis und Ironie ist mäßig. Vor dem Bau der Oberfläche sollte eine Stichprobe von 100 echten Kommentaren manuell gegengeprüft werden. Liegt die Trefferquote unter etwa 80 %, ist die Kategorisierung (`question`, `criticism`, `insult`) wertvoller als die Sentimentachse — dann wird der Schwerpunkt verschoben.
- **Aufmerksamkeitsliste ohne Antwortmöglichkeit** ist ein halber Nutzen. Antworten aus dem System heraus wäre der nächste logische Schritt und ist hier bewusst ausgeschlossen, weil es eine weitere Schreibberechtigung auf der Plattform und einen Freigabeprozess für Antworten bräuchte.
- **Reihenfolge**: dieses Paket ist das letzte der Analysekette und das einzige, dessen Wegfall keinen anderen Plan beeinträchtigt. Wenn Zeit knapp ist, ist es der richtige Kandidat zum Verschieben.
