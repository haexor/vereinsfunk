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

**Die Zuordnung alt zu neu läuft nicht über `position`.** `position` ist eine Reihenfolge, keine Identität: eine Richtlinienänderung kann eine Ebene einfügen, entfernen oder verschieben, und dann bezeichnet dieselbe Nummer eine andere Stufe. Der Schlüssel ist stattdessen `(scope, scope_department_id, scope_team_id, is_minor_stage)` — genau die Felder, aus denen `buildStageDefinitions` eine Stufe erzeugt, und die eine Ebene eindeutig benennen. Daraus folgen drei Fälle, die der Plan explizit festlegen muss:

- **Neue Route enthält eine erfüllte Stufe nicht mehr** (die Ebene verlangt jetzt keine Prüfung): die erfüllte Stufe **bleibt** stehen, samt Entscheidungen, und wird vor den neuen Stufen einsortiert. Eine erbrachte Freigabe wird nicht nachträglich weggeräumt, nur weil die Regel sich geändert hat.
- **Neue Route enthält eine Stufe, die es vorher nicht gab**: wird als neue Stufe angelegt, `status = 'pending'`, und öffnet nach der Reihe.
- **Schlüssel doppelt** (zwei Stufen derselben Ebene): kann `buildStageDefinitions` nicht erzeugen — genau eine Stufe je Ebene plus höchstens eine Minderjährigenstufe. Tritt es doch auf, ist das ein Datenfehler und die RPC bricht mit `ambiguous_stage_mapping` ab, statt zu raten.

Die Tests dazu sind nicht optional: eingefügte, entfernte, verschobene und doppelte Stufe je ein Fall.

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
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  -- Bewusst OHNE Prüfer-IDs: nur Position, Label, Ebene und die ANZAHL der Prüfer je Stufe.
  stages_before jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, approval_request_id)
    references public.approval_requests(organization_id, id) on delete restrict
);
```

`on delete restrict`, nicht `cascade` — dieselbe Wahl wie bei `audit_events.organization_id` (`202608020001:248`). Ein Audit-Eintrag, der mit dem auditierten Objekt verschwindet, ist kein Audit-Eintrag. Praktische Folge: eine `approval_request` mit Route-Änderungen ist nicht mehr löschbar, solange diese Zeilen stehen. Das ist gewollt; wer einen Verein löscht, muss den Trail bewusst mit abräumen (dieselbe Aufgabe, die `audit_events` schon heute stellt und die Paket 020, Datenschutzbetrieb, ohnehin für alle Trails lösen muss).

RLS: lesbar für dieselben Personen wie `approval_requests_select` (`2026080606:445`) — Vereinsmitglieder mit Organisationsrolle, zugewiesene Prüfer und **der Autor der Version**. Schreibend ausschließlich über die RPC. `changed_by` bleibt lesbar, anders als bei `policy_reviewers.created_by`: wer in eine laufende Freigabe eingreift, muss dem Autor gegenüber benannt sein — das ist der Zweck der Begründungspflicht.

**`stages_before` darf keine Prüfer-IDs enthalten.** Sonst wäre die Tabelle ein Umweg um genau die Regel, die Paket 011 in der Review-Runde eingezogen hat: der Autor sieht die Zusammensetzung einer nie geöffneten Stufe nicht (`opened_at is null` → `reviewerUserIds: null`). Ein Verlauf, der die alten Snapshots vollständig speichert und dem Autor zeigt, gibt ihm genau die Namen, die die Live-Antwort verbirgt — und zusätzlich die Namen, die inzwischen ausgetauscht wurden. Gespeichert wird deshalb eine **redigierte Projektion**: je Stufe `position`, `label`, `scope`, `status` und `reviewerCount`. Wer die vollen Snapshots forensisch braucht, findet sie im `audit_events`-Eintrag desselben Vorgangs, der `organization.manage` verlangt. Ein API-Test hält das fest.

`stages_before` als `jsonb` statt einer Historientabelle je Stufe: der Zweck ist Nachvollziehbarkeit („vorher standen dort drei Prüfer der Abteilung"), nicht Abfragbarkeit. Eine zweite Stufentabelle wäre teurer und würde die Fremdschlüssel der `approval_decisions` verdoppeln.

Zusätzlich: `authz.can_decide_stage` bekommt `and request.invalidated_at is null`, gemeinsam mit dieser RPC ausgeliefert.

## Umsetzung

### 1. Validierung aus `request_approval` herauslösen

`request_approval` (`2026080606:775`) enthält den Block, der Positionen, Prüferkreise, Mitgliedschaft und Minderjährigenstufe prüft. Als `authz.assert_valid_stage_list(target_organization_id uuid, target_post_version_id uuid, stages jsonb)` herausziehen und aus `request_approval` und der neuen RPC aufrufen. **Kein Duplikat** — eine zweite, ähnliche Prüfung wäre genau der Weg, auf dem die beiden Pfade auseinanderlaufen.

Verifizieren: die 44 bestehenden pgTAP-Tests von `policy_review_routes.test.sql` laufen unverändert grün, insbesondere die vier, die `invalid_stage_positions`, `empty_reviewer_snapshot`, `invalid_reviewer_snapshot` und `minor_stage_required` prüfen.

### 2. `public.reresolve_approval_route(target_approval_request_id uuid, reason text)`

`security definer`. **Kein `stages`-Parameter** — und das ist der wichtigste Satz dieses Plans.

Der erste Entwurf ließ die API die Route berechnen und als `stages` an die RPC übergeben, wie `request_approval` es tut. Das ist derselbe Fehler, den Paket 011 bei `request_approval` gefunden und dort nur *halb* behoben hat: bei einem Grant an `authenticated` ist die RPC direkt aufrufbar, die sorgfältige TS-Berechnung in `apps/api` ist dann nicht beteiligt, und `assert_valid_stage_list` prüft Struktur und Mitgliedschaft — **nicht**, ob die Liste der aktuellen Richtlinie und dem aktuellen Vertrauen entspricht. Ein Verwalter könnte damit jede beliebige Vereinsperson als Prüferin einsetzen und `review_mode = 'named'` seiner eigenen Ebene aushebeln. Bei einer Funktion, deren Zweck das Umschreiben eines laufenden Prüfkreises ist, wäre das die Lücke selbst, nicht ein Randfall.

Die RPC leitet die Route deshalb **selbst** ab. Das ist die eigentliche Arbeit dieses Pakets und die Stelle, an der eine Entscheidung fällt:

- **Variante A (empfohlen): Routenauflösung in SQL.** `buildStageDefinitions` + `resolveReviewRoute` als SQL-Funktion `authz.resolve_review_route(post_version_id)` nachbauen, die aus `policy_settings`, `policy_reviewers`, `member_review_trust` und den Mitgliedschaften dieselbe Route liefert. Die RPC ruft nur sie. Preis: die Routenlogik existiert zweimal (TS für die Vorschau, SQL für die Durchsetzung) und muss durch Tests aneinander gebunden werden — dieselbe Route für denselben Zustand, geprüft über beide Wege.
- **Variante B: Grant zurücknehmen.** `reresolve_approval_route` nur an `service_role`; die API ruft sie mit dem Service-Client, nachdem sie Berechtigung und Route selbst geprüft hat. Preis: Fastify wird für diesen Pfad zur einzigen Durchsetzung, RLS ist keine zweite Verteidigungslinie mehr. `AGENTS.md` deckt das („Fastify ist die vertrauenswürdige Servergrenze für … Service-Role-Zugriffe"), es weicht aber vom Muster jeder bisherigen privilegierten Funktion in diesem Projekt ab.

**Dieselbe Frage steht für `request_approval` offen** und betrifft bereits ausgelieferten Code — siehe „Risiken und offene Entscheidungen". Beide Pfade sollten dieselbe Variante wählen; sie in diesem Paket zu trennen, hieße die Lücke einmal zu schließen und einmal offen zu lassen.

Ablauf der RPC, unabhängig von der Variante:

1. Anfrage, Version und Beitrag `for update` laden; `post.status = 'awaiting_approval'` verlangen, sonst `invalid_status`.
2. `has_department_permission(post.department_id, 'department.manage')`, sonst `insufficient_permission`.
3. `version.created_by_user_id <> auth.uid()`, sonst `author_cannot_reresolve`.
4. `char_length(btrim(reason)) >= 10`, sonst `reason_required` — in der RPC, nicht nur im Zod-Schema der API: eine direkt aufgerufene RPC sieht das Schema nicht.
5. `invalidated_at` **nach** dem `for update` erneut prüfen (siehe Schritt 5 unten): zwischen einer `stable` Vorprüfung und dem Schreiben kann der Medien-Trigger dazwischenkommen.
6. Route ableiten, `assert_valid_stage_list` darauf anwenden (Gürtel und Hosenträger, auch wenn die Liste jetzt selbst berechnet ist).
7. Redigierte `stages_before`-Projektion bilden, Zeile in `approval_route_changes` schreiben, vollständigen Vorher-Nachher-Zustand zusätzlich in `audit_events`.
8. Stufen über den Schlüssel `(scope, scope_department_id, scope_team_id, is_minor_stage)` zuordnen und nach der Tabelle in „Fachliches Modell" ersetzen, erweitern oder stehen lassen; Positionen anschließend lückenlos neu durchnummerieren, erfüllte zuerst.
9. Genau eine Stufe öffnen: die niedrigste nicht erfüllte. `opened_at`/`deadline_at` aus `deadline_hours` neu berechnen, wie `request_approval` es für Position 1 tut.
10. `required_approvals`/`requires_minor_approval` der Anfrage nachziehen, `invalidated_at` auf `null` zurücksetzen (die Route ist bewusst neu bewertet worden).

Verifizieren: pgTAP für jede Zeile der Zustandstabelle, die vier Zuordnungsfälle, die vier Ablehnungsfälle aus Schritt 1–4, und — bei Variante A — ein Test, der TS- und SQL-Auflösung für denselben Datenstand gegeneinander stellt.

### 3. `POST /v1/approval-requests/:id/reresolve`

Analog zu `POST /v1/post-versions/:id/request-approval` (`apps/api/src/app.ts:2339`), aber ohne Routen-Parameter: die API prüft, meldet Blocker aus `resolveReviewRoute` als `422 unfulfillable_stage` mit Nennung der Ebene (**Vorschau**, damit die Verwaltung vor dem Absenden sieht, was entsteht) und ruft dann die RPC, die die Route selbst ableitet. Contract: `ReresolveApprovalRouteRequestSchema { reason: z.string().trim().min(10).max(2000) }`, Antwort wie `RequestApprovalResponseSchema` plus die neue Stufenliste. Fehlerabbildung: `author_cannot_reresolve` → 403, `invalid_status` → 409, `reason_required` → 400, `ambiguous_stage_mapping` → 409, der Rest wie bei `request-approval`.

Verifizieren: API-Tests für 403 (Autor), 409 (falscher Status), 422 (unerfüllbare neue Route) und den Erfolgsfall.

### 4. Oberfläche

`/freigaben` zeigt heute nur Stufen, die auf die anfragende Person warten. Für diesen Eingriff braucht es die Gegenansicht: **festhängende Freigaben der eigenen Ebene**.

Der Filter ist dabei **nicht** `isOverdue` allein. Die beiden Fälle, um die es in diesem Paket eigentlich geht, treten vor Ablauf einer Frist auf — und ohne Frist überhaupt nie: eine Stufe hat keine, wenn `review_deadline_hours` nicht gesetzt ist, und `deadline_at` bleibt dann `null`. Eine Liste, die nur auf überfällig filtert, zeigt genau die Blockaden nicht, für die die Neuauflösung gebaut wird. Aufgenommen wird deshalb jede offene oder überfällige Stufe der verwalteten Ebenen, die mindestens eines erfüllt:

- die Frist ist überschritten (`isOverdue`),
- die Anfrage ist invalidiert (`invalidated_at`, Medium hat sich geändert),
- der `reviewer_snapshot` ist nicht mehr erfüllbar: keine der genannten Personen ist noch aktives Vereinsmitglied, oder es sind weniger nicht-abgelaufene Mitglieder darin als `minimum_approvals` verlangt.

Der dritte Punkt braucht einen eigenen Endpunkt oder ein Feld in der Stufenantwort (`unresolvableReviewers`), das die API aus dem Snapshot gegen die aktuellen Mitgliedschaften berechnet — dieselbe Ablaufprüfung, die `authz.is_user_member_of_organization` in SQL macht. API- und UI-Pfad für alle drei Auslöser sind zu testen.

In `GET /v1/post-versions/:id/approval` die Einträge aus `approval_route_changes` mitliefern (die redigierte Projektion, siehe „Datenmodell"), damit der Autor in der Freigabeansicht liest, dass und warum die Route geändert wurde. Die Sichtbarkeitsregel für `reviewerUserIds` (`opened_at is null` → `null` für den Autor) bleibt unberührt und darf über den Verlauf nicht umgangen werden.

### 5. `invalidated_at` wirksam machen

`and request.invalidated_at is null` in `authz.can_decide_stage`. Damit ist eine Freigabe, deren Medium sich geändert hat, nicht mehr entscheidbar — und die Neuauflösung aus Schritt 2 ist der Weg zurück. Beides zusammen ausliefern, nie getrennt.

Der Guard im Helper genügt für den Lesepfad und für `approval_decisions_insert` (`2026080606:469`), und `decide_approval_stage` ruft `can_decide_stage` unbedingt als erstes auf. Er genügt aber **nicht** gegen ein Rennen: `can_decide_stage` ist `stable` und läuft vor dem `for update` auf die Stufe, der Medien-Trigger kann dazwischen zuschlagen. `decide_approval_stage` prüft `invalidated_at` deshalb **nach** dem Sperren der Anfrage ein zweites Mal und bricht dann mit `approval_invalidated` ab (→ 409). Der pgTAP-Test geht über den echten Entscheidungs-RPC, nicht nur über den Helper: Medium ändern, `decide_approval_stage` aufrufen, Ablehnung prüfen, neu auflösen, erneut aufrufen, Erfolg prüfen.

Verifizieren: pgTAP — Mediumderivat ändern, Trigger setzt `invalidated_at`, `can_decide_stage` ist danach `false`, nach `reresolve_approval_route` wieder `true`.

## Verifikation

- pgTAP: jede Zeile der Zustandstabelle; eine Stufe mit einer echten Entscheidung verliert diese Entscheidung nicht; die Minderjährigenstufe überlebt jede Neuauflösung; Positionen bleiben lückenlos; ein Nicht-Verwaltender wird abgewiesen; der Autor wird abgewiesen; `approval_route_changes` ist für den Autor lesbar und für ein unbeteiligtes Mitglied eines fremden Vereins nicht.
- API-Tests: die vier Fehlerabbildungen plus Erfolgsfall.
- Manuell: eine Route mit zwei Stufen anlegen, die innere Prüferin aus dem Verein entfernen, Frist überschreiten, als Abteilungsleitung neu auflösen, als neu benannte Prüferin entscheiden. **Einschränkung**: solange die Inhalts-Pipeline fehlt (Pakete 001–007, siehe `plans/NEXT-SESSION.md`), entsteht `post_version` nur per direktem DB-/RPC-Eingriff — der manuelle Durchlauf ist damit nur halb echt.

## Risiken und offene Entscheidungen

- **`request_approval` hat dieselbe Lücke, und die ist bereits ausgeliefert.** Die Funktion nimmt `stages` samt `reviewerSnapshot` vom Aufrufer und ist per Grant an `authenticated` direkt aufrufbar. Paket 011 hat daran das Wesentliche behoben — `self_approval_allowed`/`allow_same_reviewer_across_stages` werden selbst berechnet, die Minderjährigenstufe ist erzwungen, Positionen sind lückenlos, jede genannte Person muss echtes Vereinsmitglied sein — aber **nicht**, dass die genannten Prüfer die *konfigurierten* sind. Eine Person mit `post.submit` kann ihre Freigabe also per direktem RPC-Aufruf an einen selbst gewählten, wohlwollenden Vereinskollegen richten statt an die unter `review_mode = 'named'` eingetragenen Prüfer. Nicht umgehbar bleiben dabei: Selbstfreigabe bei `self_approval_allowed = false` und die Vereinsgrenze. Die Wirkung ist „falscher Prüfer innerhalb des Vereins", nicht „gar kein Prüfer" — aber bei einer `named`-Konfiguration ist genau das der Zweck der Konfiguration. **Am schwersten wiegt es bei der Minderjährigenstufe**: geprüft wird, dass eine Stufe mit `isMinorStage` *vorhanden* ist, nicht dass ihr Prüfkreis die Freigabeberechtigten der Vereinsebene sind. Ein Einreichender kann sie also mit einem beliebigen Vereinsmitglied besetzen und damit formal erfüllen. Nach `plans/011` („Vertrauen und Minderjährige") ist gerade diese Stufe der Grund, warum Spieler und Eltern überhaupt einreichen dürfen — sie darf nicht nur der Form nach existieren. **Das ist eine Entscheidung, die vor diesem Paket fällt**, weil beide Pfade dieselbe Variante wählen müssen (A oder B aus Abschnitt 2). Bis dahin gilt: die Konfiguration `review_mode = 'named'` ist gegen einen wohlmeinenden Verein wirksam, nicht gegen einen Einreichenden, der die RPC direkt aufruft.
- **Der Eingriff ist mächtig.** Wer die Route neu auflöst, bestimmt neu, wer freigibt. Die Gegengewichte sind: Verwaltungsrecht im Scope, Autor ausgeschlossen, Begründung ab zehn Zeichen Pflicht, vorheriger Zustand festgehalten, für den Autor lesbar. Das ist bewusst kein technisches Verbot, sondern Nachvollziehbarkeit — ein Verein, der sich selbst betrügen will, kann das über die Richtlinie ohnehin.
- **„Alle offenen Freigaben neu bewerten"** (der Notfallknopf aus `plans/011`) bleibt draußen. Ein Massen-Eingriff hat ein anderes Risikoprofil: er ändert viele Routen gleichzeitig, braucht eine Vorschau über alle betroffenen Beiträge und eine Begründung je Verein statt je Beitrag. Erst sinnvoll, wenn dieser Einzelfall in Betrieb ist.
- **Benachrichtigung** der neu benannten Prüfer: die RPC läuft synchron auf Nutzeraktion, eine E-Mail wäre hier ohne Scheduler möglich. Die Bündelungsregel aus Paket 011 („höchstens eine E-Mail pro Stunde") ist aber nicht gebaut. Vorschlag: in diesem Paket keine E-Mail, sondern gemeinsam mit der übrigen Prüfer-Benachrichtigung nach Paket 004.
- **Offen zu bestätigen**: ob eine `rejected` Stufe wirklich nicht neu aufgelöst werden soll. Die Annahme hier ist, dass eine Ablehnung eine inhaltliche Aussage über die Version ist und eine neue Version erzeugen soll — nicht eine Wiederholung derselben Version mit anderen Prüfern. Wer das anders sieht, öffnet damit den Weg „Ablehnung wegverwalten", und das wäre gegen den Zweck der Freigabe.
