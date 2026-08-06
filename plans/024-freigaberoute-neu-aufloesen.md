# 024 – Freigaberoute bewusst neu auflösen

Entwurf, entstanden aus der zweiten Review-Runde zu Paket 011 (PR #18). Abhängigkeit: 011.

## Ergebnis

Eine laufende Freigabe kann feststecken, ohne dass jemand etwas falsch gemacht hat: die benannte Prüferin hat den Verein verlassen, ist drei Wochen im Urlaub, oder das Medium unter der Freigabe hat sich geändert und die Anfrage ist automatisch als ungültig markiert worden. Der eingefrorene `reviewer_snapshot` ist in diesen Fällen genau das Richtige und genau das Problem: er hält fest, wer entscheiden darf, auch wenn diese Person nicht mehr kann.

Dieses Paket baut den einen Ausweg, den Paket 011 dafür vorgesehen hat (`plans/011-regelwerk-richtlinien-und-kontingente.md`, „Risiken und offene Entscheidungen": „plus die Möglichkeit, eine Route bewusst neu aufzulösen. Letzteres ist ein Eingriff in eine laufende Freigabe und muss auditiert und begründet werden"):

- **Neu auflösen mit Begründung.** Wer die betroffene Ebene verwaltet, löst die noch nicht entschiedenen Stufen einer laufenden Freigabe neu auf — gegen die *heutige* Richtlinie und die *heutigen* Mitgliedschaften. Erfüllte Stufen bleiben erfüllt.
- **Der Eingriff ist sichtbar, nicht still.** Begründung ist Pflicht, der vorherige Zustand wird festgehalten, und der Autor kann lesen, dass und warum seine Route geändert wurde.
- **Eine ungültig gewordene Freigabe wird entscheidbar-nach-Neuauflösung statt still entscheidbar.** `invalidated_at` bekommt damit erstmals eine Wirkung im Lesepfad (siehe „Ausgangslage").

Ausdrücklich **nicht** in diesem Paket: „Verwaltende dürfen eine überfällige Stufe selbst entscheiden." Begründung unten — das wäre ein Selbstfreigabe-Pfad über die selbst gesetzte Frist.

## Warum ein eigenes Paket

Der Bugfix aus derselben Review-Runde (`stalled` bleibt entscheidbar, `authz.can_decide_stage`) ist in Paket 011 eingeflossen: eine Frist darf eine Prüfung weder herbeiführen noch verhindern. Damit ist der häufigste Fall — „niemand hat reagiert, aber alle könnten noch" — gelöst, ohne neue Konzepte.

Was bleibt, ist der Fall „die zuständige Person *kann* nicht mehr". Der braucht eine neue, privilegierte Operation mit Begründungspflicht, einer lesbaren Historie und einer Oberfläche. Das ist ein Eingriff in eine laufende Freigabe und damit sicherheitsrelevant in derselben Klasse wie `request_approval` selbst — es gehört nicht als Anhang in ein Review, sondern eigenständig geplant und adversarial geprüft.

## Ausgangslage und Evidenz

- `authz.can_decide_stage` (`supabase/migrations/2026080606_policies_and_review_routes.sql:330`) bindet die Entscheidung an einen Treffer im eingefrorenen `reviewer_snapshot` der Stufe. Es gibt **keinen** Pfad, der diesen Snapshot nach dem Anlegen der Route noch ändert.
- `public.request_approval` (`:775`) ist die einzige Stelle, die `approval_stages` erzeugt. Sie enthält die vollständige Validierung, die eine Neuauflösung ebenfalls braucht: lückenlose Positionen ab 1, kein leerer Prüferkreis, Minderjährigenstufe vorhanden, wenn `safety_flags` sie verlangt, jede `userId` gegen echte Vereinsmitgliedschaft, `self_approval_allowed`/`allow_same_reviewer_across_stages` selbst aus `policy_settings` berechnet statt vom Aufrufer übernommen.
- `resolveReviewRoute` (`packages/domain/src/index.ts:252`) und `buildStageDefinitions` (`apps/api/src/app.ts:2303`) berechnen eine Route bereits vollständig aus Richtlinie, Vertrauen und Mitgliedschaften. Für die Neuauflösung ist **keine neue Routenlogik** nötig, nur ein zweiter Aufrufer derselben Funktionen.
- `public.mark_stalled_approval_stages()` (`:1064`) markiert überfällige Stufen, wird von nichts aufgerufen (kein Scheduler, Paket 004). Dieses Paket **hängt nicht daran**: die API liefert `isOverdue` live aus `deadline_at`, die Oberfläche kann darauf aufsetzen.
- `approval_requests.invalidated_at` (`202608020001_initial_tenant_foundation.sql:208`) wird vom Trigger `public.invalidate_approvals_for_media_change()` (`202608030001_content_media_workflows_publishing.sql:110`) gesetzt, sobald sich ein Mediumderivat unter einer Freigabe ändert. **Kein Lesepfad prüft die Spalte** — weder `authz.can_decide_stage` noch `decide_approval_stage`. Eine Freigabe, deren Medium sich geändert hat, ist heute also weiterhin entscheidbar. Der Guard (`invalidated_at is null`) gehört in dieses Paket und **nicht früher**: ohne Neuauflösung würde er dieselbe Sackgasse erzeugen, die der `stalled`-Fix gerade beseitigt hat.
- `audit_events_select` (`202608020001:427`) verlangt `organization.manage`. Der Autor eines Beitrags kann den Audit-Trail also **nicht** lesen — eine Begründung, die nur dort landet, erreicht ihn nicht.
- `plans/011`, „Risiken und offene Entscheidungen" nennt zusätzlich den Notfallknopf „Alle offenen Freigaben neu bewerten" und schließt ihn dort aus. Er bleibt auch hier draußen, siehe „Risiken".

## Fachliches Modell

### Was neu aufgelöst wird und was stehen bleibt

Die Regel folgt der von `decide_approval_stage`: „eine bereits erfüllte innere Stufe bleibt stehen, sie war ja tatsächlich erfüllt."

| Stufe im Zustand | Verhalten bei der Neuauflösung |
|---|---|
| `satisfied` | bleibt unverändert, samt ihrer `approval_decisions` |
| `rejected` | Neuauflösung nicht möglich — der Beitrag ist `changes_requested`/`cancelled`, der reguläre Weg ist eine neue Version |
| `pending`, ohne Entscheidungen | wird ersetzt: neue Position, neuer Prüferkreis, neue Frist |
| `open`/`stalled`, ohne Entscheidungen | wird ersetzt |
| `open`/`stalled`, **mit** Entscheidungen (z. B. 1 von 2 Freigaben) | Stufe bleibt, nur der `reviewer_snapshot` wird auf den neu aufgelösten Kreis **erweitert** |
| `skipped` | bleibt `skipped` |

Der letzte Fall ist der Grund für „erweitern" statt „ersetzen": `approval_decisions.approval_stage_id` hängt per Fremdschlüssel mit `on delete cascade` an der Stufe (`2026080606:207`). Ein Ersetzen würde eine bereits abgegebene, echte Freigabe löschen. Eine Stufe, auf der jemand entschieden hat, ist außerdem nicht der Blockadefall — sie braucht nur einen zweiten Prüfer, der noch kann.

Was die Neuauflösung **nicht** darf, weil `resolveReviewRoute` es von sich aus verhindert und `request_approval` es zusätzlich prüft: die Minderjährigenstufe entfernen, einen leeren Prüferkreis erzeugen, Positionen mit Lücken hinterlassen, oder eine vereinsfremde Person als Prüferin eintragen. Die Neuauflösung muss deshalb **denselben Validierungsblock** benutzen wie `request_approval` — nicht eine zweite, ähnliche Fassung. Praktisch: den Block aus `request_approval` in eine eigene SQL-Funktion ziehen und aus beiden aufrufen.

### Wer darf das

Verwaltungsrecht im Scope des Beitrags: `authz.has_department_permission(post.department_id, 'department.manage')`. Das kaskadiert per Definition auf `has_organization_permission` — Vereinsleitung und Abteilungsleitung, nicht `post.approve`. Entscheiden und Route-Umbauen sind verschiedene Rechte.

Zusätzlich: **der Autor der Version darf seine eigene Route nie neu auflösen**, unabhängig von seinen Rollen. Sonst könnte ein Abteilungsadmin, der selbst einreicht, sich einen genehmen Prüferkreis verschaffen. Das ist billig zu prüfen (`version.created_by_user_id <> auth.uid()`) und schließt den offensichtlichen Missbrauch.

### Warum nicht „Verwaltende entscheiden überfällige Stufen selbst"

Die naheliegende Lösung wäre, `can_decide_stage` bei überschrittener Frist auf die Verwaltenden des Scopes auszuweiten. Sie ist ein Selbstfreigabe-Pfad:

`review_deadline_hours` wird von der Ebene selbst gesetzt, und dafür genügt `department.manage` (`set_policy_rules`, `2026080606:623`). Ein Abteilungsadmin stellt die Frist seiner eigenen Ebene auf eine Stunde, reicht ein, wartet, und gibt dann seinen eigenen Beitrag als „Verwaltender bei überfälliger Stufe" frei. Dagegen stünde nur `self_approval_allowed`, das per Default `true` ist. Damit wäre die Frist keine Beschleunigung der Prüfung, sondern ihre Umgehung — dieselbe Klasse Fund wie bei `request_approval` in Paket 011.

Die Neuauflösung hat das Problem nicht: sie erzeugt nur einen neuen Prüferkreis, den anschließend jemand **tatsächlich entscheiden** muss, und `resolveReviewRoute` wendet `self_approval_allowed` und die Minderjährigenregel dabei frisch an.

## Datenmodell

Eine neue Tabelle, weil der Audit-Trail den Autor nicht erreicht (siehe „Ausgangslage"):

```sql
create table public.approval_route_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  approval_request_id uuid not null,
  changed_by uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 10 and 2000),
  stages_before jsonb not null,   -- Positionen, Labels und Prüferkreise vor dem Eingriff
  created_at timestamptz not null default now(),
  foreign key (organization_id, approval_request_id)
    references public.approval_requests(organization_id, id) on delete cascade
);
```

RLS: lesbar für dieselben Personen wie `approval_requests_select` (`2026080606:445`) — Vereinsmitglieder mit Organisationsrolle, zugewiesene Prüfer und **der Autor der Version**. Schreibend ausschließlich über die RPC. `changed_by` bleibt lesbar, anders als bei `policy_reviewers.created_by`: wer in eine laufende Freigabe eingreift, muss dem Autor gegenüber benannt sein — das ist der Zweck der Begründungspflicht.

`stages_before` als `jsonb` statt einer Historientabelle je Stufe: der Zweck ist Nachvollziehbarkeit („vorher standen dort X und Y"), nicht Abfragbarkeit. Eine zweite Stufentabelle wäre teurer und würde die Fremdschlüssel der `approval_decisions` verdoppeln.

Zusätzlich: `authz.can_decide_stage` bekommt `and request.invalidated_at is null`, gemeinsam mit dieser RPC ausgeliefert.

## Umsetzung

### 1. Validierung aus `request_approval` herauslösen

`request_approval` (`2026080606:775`) enthält den Block, der Positionen, Prüferkreise, Mitgliedschaft und Minderjährigenstufe prüft. Als `authz.assert_valid_stage_list(target_organization_id uuid, target_post_version_id uuid, stages jsonb)` herausziehen und aus `request_approval` und der neuen RPC aufrufen. **Kein Duplikat** — eine zweite, ähnliche Prüfung wäre genau der Weg, auf dem die beiden Pfade auseinanderlaufen.

Verifizieren: die 44 bestehenden pgTAP-Tests von `policy_review_routes.test.sql` laufen unverändert grün, insbesondere die vier, die `invalid_stage_positions`, `empty_reviewer_snapshot`, `invalid_reviewer_snapshot` und `minor_stage_required` prüfen.

### 2. `public.reresolve_approval_route(target_approval_request_id uuid, stages jsonb, reason text)`

`security definer`, Grant an `authenticated` — und damit dieselbe Sorgfalt wie bei `request_approval`: jeder Parameter wird als vom Angreifer gewählt behandelt.

1. Anfrage und Beitrag `for update` laden; `post.status = 'awaiting_approval'` verlangen, sonst `invalid_status`.
2. `has_department_permission(post.department_id, 'department.manage')`, sonst `insufficient_permission`.
3. `version.created_by_user_id <> auth.uid()`, sonst `author_cannot_reresolve`.
4. `authz.assert_valid_stage_list(...)` auf die gelieferte Liste.
5. `stages_before` aus den aktuellen Stufen bilden, Zeile in `approval_route_changes` schreiben.
6. Stufen nach der Tabelle in „Fachliches Modell" ersetzen bzw. deren Snapshot erweitern; Positionen der bleibenden erfüllten Stufen beibehalten und die neuen dahinter lückenlos einreihen.
7. Genau eine Stufe öffnen: die niedrigste nicht erfüllte. `opened_at`/`deadline_at` aus `deadline_hours` neu berechnen, wie `request_approval` es für Position 1 tut.
8. `required_approvals`/`requires_minor_approval` der Anfrage nachziehen, `invalidated_at` auf `null` zurücksetzen (die Route ist bewusst neu bewertet worden).

Verifizieren: pgTAP für jede Zeile der Tabelle plus die vier Ablehnungsfälle aus Schritt 2–4.

### 3. `POST /v1/approval-requests/:id/reresolve`

Analog zu `POST /v1/post-versions/:id/request-approval` (`apps/api/src/app.ts:2339`): Route über `buildStageDefinitions` + `resolveReviewRoute` **frisch** berechnen, Blocker als `422 unfulfillable_stage` mit Nennung der Ebene melden, sonst die RPC aufrufen. Contract: `ReresolveApprovalRouteRequestSchema { reason: z.string().trim().min(10).max(2000) }`, Antwort wie `RequestApprovalResponseSchema` plus die neue Stufenliste. Fehlerabbildung: `author_cannot_reresolve` → 403, `invalid_status` → 409, der Rest wie bei `request-approval`.

Verifizieren: API-Tests für 403 (Autor), 409 (falscher Status), 422 (unerfüllbare neue Route) und den Erfolgsfall mit geprüftem RPC-Argument.

### 4. Oberfläche

`/freigaben` zeigt heute nur Stufen, die auf die anfragende Person warten. Für diesen Eingriff braucht es die Gegenansicht: **festhängende Freigaben der eigenen Ebene**. Kleinste ehrliche Fassung: ein Abschnitt „Festhängende Freigaben" mit den überfälligen Stufen (`isOverdue`) der Ebenen, die die Person verwaltet, je Eintrag der aktuelle Prüferkreis, die Frist und ein Button „Route neu auflösen" mit Pflicht-Begründungsfeld und einer Vorschau der neu aufgelösten Stufen vor dem Absenden.

In `GET /v1/post-versions/:id/approval` die Einträge aus `approval_route_changes` mitliefern, damit der Autor in der Freigabeansicht liest, dass und warum die Route geändert wurde. Die Sichtbarkeitsregel für `reviewerUserIds` (`opened_at is null` → `null` für den Autor) bleibt unberührt.

### 5. `invalidated_at` wirksam machen

`and request.invalidated_at is null` in `authz.can_decide_stage`. Damit ist eine Freigabe, deren Medium sich geändert hat, nicht mehr entscheidbar — und die Neuauflösung aus Schritt 2 ist der Weg zurück. Beides zusammen ausliefern, nie getrennt.

Verifizieren: pgTAP — Mediumderivat ändern, Trigger setzt `invalidated_at`, `can_decide_stage` ist danach `false`, nach `reresolve_approval_route` wieder `true`.

## Verifikation

- pgTAP: jede Zeile der Zustandstabelle; eine Stufe mit einer echten Entscheidung verliert diese Entscheidung nicht; die Minderjährigenstufe überlebt jede Neuauflösung; Positionen bleiben lückenlos; ein Nicht-Verwaltender wird abgewiesen; der Autor wird abgewiesen; `approval_route_changes` ist für den Autor lesbar und für ein unbeteiligtes Mitglied eines fremden Vereins nicht.
- API-Tests: die vier Fehlerabbildungen plus Erfolgsfall.
- Manuell: eine Route mit zwei Stufen anlegen, die innere Prüferin aus dem Verein entfernen, Frist überschreiten, als Abteilungsleitung neu auflösen, als neu benannte Prüferin entscheiden. **Einschränkung**: solange die Inhalts-Pipeline fehlt (Pakete 001–007, siehe `plans/NEXT-SESSION.md`), entsteht `post_version` nur per direktem DB-/RPC-Eingriff — der manuelle Durchlauf ist damit nur halb echt.

## Risiken und offene Entscheidungen

- **Der Eingriff ist mächtig.** Wer die Route neu auflöst, bestimmt neu, wer freigibt. Die Gegengewichte sind: Verwaltungsrecht im Scope, Autor ausgeschlossen, Begründung ab zehn Zeichen Pflicht, vorheriger Zustand festgehalten, für den Autor lesbar. Das ist bewusst kein technisches Verbot, sondern Nachvollziehbarkeit — ein Verein, der sich selbst betrügen will, kann das über die Richtlinie ohnehin.
- **„Alle offenen Freigaben neu bewerten"** (der Notfallknopf aus `plans/011`) bleibt draußen. Ein Massen-Eingriff hat ein anderes Risikoprofil: er ändert viele Routen gleichzeitig, braucht eine Vorschau über alle betroffenen Beiträge und eine Begründung je Verein statt je Beitrag. Erst sinnvoll, wenn dieser Einzelfall in Betrieb ist.
- **Benachrichtigung** der neu benannten Prüfer: die RPC läuft synchron auf Nutzeraktion, eine E-Mail wäre hier ohne Scheduler möglich. Die Bündelungsregel aus Paket 011 („höchstens eine E-Mail pro Stunde") ist aber nicht gebaut. Vorschlag: in diesem Paket keine E-Mail, sondern gemeinsam mit der übrigen Prüfer-Benachrichtigung nach Paket 004.
- **Offen zu bestätigen**: ob eine `rejected` Stufe wirklich nicht neu aufgelöst werden soll. Die Annahme hier ist, dass eine Ablehnung eine inhaltliche Aussage über die Version ist und eine neue Version erzeugen soll — nicht eine Wiederholung derselben Version mit anderen Prüfern. Wer das anders sieht, öffnet damit den Weg „Ablehnung wegverwalten", und das wäre gegen den Zweck der Freigabe.
