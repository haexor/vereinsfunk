# Prompt für die nächste Session

Alles unter der Trennlinie in eine neue Claude-Code-Session kopieren. Die Pläne selbst liegen in `plans/008`–`plans/020`, der Index in [plans/README.md](README.md).

---

Wir setzen die Planserie `plans/008`–`plans/020` um. Lies zuerst `plans/README.md` vollständig — dort stehen die Reihenfolge, die übergreifenden Regeln, das Rückbau-Inventar und die noch offenen Entscheidungen. Danach `AGENTS.md` und `docs/product/implementation-plan.md`.

**Du darfst und sollst Subagents und Workflows benutzen.** Das ist ausdrücklich gewünscht, weil die Pläne breit sind und viele Prüfungen unabhängig voneinander laufen können.

## Vorgehen je Arbeitspaket

Arbeite **ein Paket zu Ende**, bevor du das nächste anfängst. Halte dich an die Reihenfolge aus `plans/README.md`: 008 → 009 → 010 → 011 → 012, dann 013 (unabhängig, kann früher), 014 → 019 → 015, 016 jederzeit ab 011.

Beginne mit **008**. Ohne echte Authentifizierung lässt sich kein Dummy-Datensatz ehrlich ersetzen.

Je Paket in drei Phasen:

### Phase 1 — Plan gegen den Code verifizieren (parallel)

Die Pläne zitieren konkrete `file:line`-Stellen, geplant auf `b5c2eda6`. Bevor du etwas baust, lass mehrere Agents parallel prüfen, ob diese Aussagen noch stimmen. Jeder Agent nimmt einen Abschnitt „Ausgangslage und Evidenz“ und meldet je Behauptung: bestätigt, verschoben (neue Stelle), oder falsch.

Weicht etwas ab, aktualisiere zuerst den Plan und sag mir, was sich geändert hat. Baue nicht gegen eine veraltete Annahme.

### Phase 2 — Umsetzen

`EnterWorktree` vor der ersten Codeänderung, ein Branch je Paket. Nicht auf `main` arbeiten.

Innerhalb eines Pakets ist die Kette Migration → Domain → API → Oberfläche → Rückbau überwiegend seriell. Was sich sinnvoll parallelisieren lässt:

- reine Domainfunktionen samt Tests, sobald das fachliche Modell im Plan festliegt — unabhängig von der Migration
- pgTAP-Tests parallel zur Migration, aus dem Abschnitt „Verifikation“ heraus
- Oberflächenarbeit gegen die Zod-Contracts, sobald die Endpunkte vertraglich fest sind

Was **nicht** parallel laufen darf: zwei Agents an derselben Migrationsdatei, an `packages/contracts/src/index.ts` oder an `packages/domain/src/index.ts`. Diese Dateien sind in fast jedem Paket betroffen und erzeugen sonst Konflikte. Wenn mehrere Agents Dateien ändern, gib ihnen `isolation: "worktree"`.

### Phase 3 — Adversarial prüfen (parallel)

Vor dem Abschluss mehrere Prüfagents mit **unterschiedlichen Blickwinkeln**, nicht mehrere gleiche:

1. **Mandantentrennung** — trägt jede neue Tabelle `organization_id`, greifen zusammengesetzte Fremdschlüssel, existieren positive **und** negative RLS-Tests?
2. **Rechte** — kommt irgendwo jemand an Daten, die der Plan ihm ausdrücklich verwehrt? Der `Nicht erweitert`-Teil der Policy-Tabellen ist so wichtig wie der erweiterte.
3. **Geheimnisse** — landet ein Token, ein Elternkontakt, ein Einwilligungsnachweis oder ein Kommentartext in einem Log, einer API-Antwort oder einem `select` für `authenticated`?
4. **Verträge** — ist jede Systemgrenze mit Zod validiert, sind Grenzen und Fehlerfälle abgedeckt?
5. **Rückbau** — ist jeder Eintrag des Inventars für dieses Paket erledigt, und wurde nirgends ein erfundener Wert durch eine Null oder einen Platzhalter ersetzt?

Ein Fund gilt erst als echt, wenn er reproduzierbar ist. Lass unklare Funde von einem zweiten Agent widerlegen, statt sie ungeprüft zu übernehmen.

## Definition of Done je Paket

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Bei Datenbankänderungen zusätzlich:

```bash
pnpm db:start && pnpm db:reset && pnpm db:test
```

Alles muss grün sein. Ein rotes Ergebnis wird gemeldet, nicht umgangen. Danach den Statuswert des Pakets in `plans/README.md` auf `erledigt` setzen und die betroffenen Zeilen im Rückbau-Inventar abhaken.

## Verbindliche Regeln

- `AGENTS.md` gilt: jede mandantenbezogene Tabelle mit `organization_id`, zusammengesetzte Fremdschlüssel, RLS mit positiven und negativen Tests, Service Role nur in API und Workern, Provider nur hinter Interfaces, Zod an jeder Systemgrenze.
- Die übergreifenden Regeln beider Planserien in `plans/README.md` sind bindend — insbesondere: Vererbung verschärft nur, Freigabestufen sind additiv, eine Befreiung wirkt nur nach unten, keine Befreiung entfällt die Minderjährigenstufe, Zeit rechnet in der Vereinszeitzone, kein Import löscht, Datenminimierung durch Schema.
- **Kein erfundener Wert wird durch eine Null oder einen grauen Balken ersetzt.** Existiert eine Zahl noch nicht, steht dort ein benannter leerer Bereich mit Begründung.
- Chirurgische Änderungen: nur anfassen, was das Paket verlangt. Kein Refactoring angrenzenden Codes, kein Aufräumen fremden toten Codes — nur erwähnen.
- Minimaler Code. Keine Abstraktion für einen einzigen Aufrufer, keine Konfigurierbarkeit, die niemand angefordert hat.
- Commits und PR-Beschreibungen ohne jeden Hinweis auf Claude, Anthropic oder Claude Code. Kein `Co-Authored-By`, kein Generator-Footer.
- Deutsch in Produkttexten, Plänen und Commit-Messages. Code, Bezeichner und SQL bleiben englisch, wie im Bestand.
- Bei echten Mehrdeutigkeiten fragen, nicht raten. Bei eindeutigen Aufgaben direkt umsetzen.

## Was du wissen musst, bevor du anfängst

Zwei Sicherheitsbefunde, die Paket 008 und 012 begründen:

- `apps/api/src/app.ts:66-72` ist die gesamte Autorisierung der API. Es wird nur geprüft, **ob** ein `authorization`-Header existiert, und das nur bei `NODE_ENV === 'production'`. Keine Signaturprüfung, keine Permission. Lokal und im Test ist jeder Endpunkt offen.
- `social_connections` gewährt `authenticated` `select` auf die ganze Tabelle einschließlich `token_ciphertext` (Migration `202608030001:125,131`). Policy und Grant sind spaltenblind.

Weiterhin: es gibt keinen Supabase-Client im Code, `@supabase/supabase-js` ist zwar Abhängigkeit von `apps/web`, wird aber nirgends importiert. `public.profiles` hat keinen Trigger auf `auth.users`, ein echter Neuregistrierter hätte kein Profil. Für `public.organizations` existiert keine INSERT-Policy.

## Offene Entscheidungen

`plans/README.md` listet sie am Ende. Für 008 bis 013 blockiert keine davon — fang an. Vor 014, 015 und 020 brauchst du meine Antworten; frag dann gezielt nach, statt eine Annahme zu treffen.

Fang mit Paket 008 an. Zeig mir nach Phase 1 kurz, was von der Evidenz abgewichen ist, bevor du baust.
