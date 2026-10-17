# Quickstart: Spielerprofil prüfen

Validierungsleitfaden, kein Implementierungscode. Verträge: [contracts/person-profile.md](contracts/person-profile.md), Daten: [data-model.md](data-model.md).

## Voraussetzungen

- Worktree `.worktrees/spielerprofil`, Branch `feat/spielerprofil`
- `pnpm install`
- Lokale Supabase-Instanz (`supabase start`); Migrationen eingespielt (`pnpm db:reset`)
- Zum Anschauen: Skill `run-web` (Nuxt-App lokal, Login, Screenshots)

## 1. Automatische Prüfungen

```sh
pnpm db:test        # pgTAP inkl. person_profile.test.sql
pnpm lint
pnpm typecheck
pnpm test           # API-Routentest, Web-Tests
pnpm build
```

**Erwartung**: alles grün. `person_profile.test.sql` deckt mindestens ab:

| Fall | Erwartung |
|---|---|
| Trainer der Mannschaft ruft Spieler seiner Mannschaft ab | Profil mit Mannschaft, Trikot, Position, Punkten |
| Spieler ruft Mitspieler ab (`stats_visibility` = `team`) | Profil sichtbar |
| Spieler ruft Person aus Nachbarmannschaft ab, ohne Sicht | `null` |
| Mitglied eines **anderen Vereins** ruft Person ab | `null`, gleich wie unbekannte Id |
| Unbekannte UUID | `null` |
| Person in zwei Mannschaften, Betrachter sieht nur eine | genau ein Eintrag in `teams` |
| Person ohne Kader, Betrachter mit `directory.read` | Profil mit leerer `teams` |
| Punkte je Mannschaft | gleich `playerboard_team_ranking` für denselben Zeitraum |

`personProfile.routes.test.ts` prüft zusätzlich:

| Fall | Erwartung |
|---|---|
| unbekannte und nicht sichtbare Person | `404`, identischer Body außer `correlationId` |
| Nicht-Trainer | Antwort ohne `email`/`hasAccount` |
| Trainer | `email` und `hasAccount` vorhanden |
| Minderjährige Person | weder Geburtsjahr noch `isMinor` in der Antwort |
| ungültige UUID / `period` | `400` |

## 2. Sichtprüfung im Browser (mit `run-web`)

1. Als Trainer anmelden, ein **abgeschlossenes** Training öffnen (`/playerboard/trainings/<id>`).
2. Auf einen Spielernamen klicken. **Erwartung**: `/personen/<id>` zeigt Name, Mannschaften, Trikot, Position, Saisonpunkte.
3. Umschalter auf „Gesamte Zeit“. **Erwartung**: Punkte stimmen mit der Rangliste im Zeitraum „Alle“ überein.
4. Dieselbe Person in einer zweiten Mannschaft anlegen und Profil erneut öffnen. **Erwartung**: ein Profil, zwei Mannschaftskarten.
5. In einem Training Punkte ändern und **sofort** auf einen Namen klicken, mit blockiertem Netz (DevTools offline). **Erwartung**: Rückfrage „Nicht alle Werte sind gespeichert …“, kein stiller Verlust (FR-013).
6. Alle Ansichten durchgehen und Namen anklicken: Rangliste, Saisonübersicht (Startseite und `/playerboard`), Kader, Foto-Zuordnung, Veo-Saison, Veo-Spielkarte. **Erwartung**: jeder Name mit zugeordneter Person ist ein Link auf dasselbe Profil.
7. Veo-Zeile ohne zugeordneten Spieler. **Erwartung**: kein Link.
8. Öffentliche Mannschaftsseite abmelden öffnen. **Erwartung**: keine Links, keine Ids im DOM (`#7 M. K.`).
9. Als Spieler (nur Mannschaftsmitglied) dasselbe Profil öffnen. **Erwartung**: keine E-Mail, kein Kontostatus.
10. Mit fremdem Vereinskonto die Profil-URL direkt aufrufen. **Erwartung**: „Person nicht gefunden“, in der Netzwerkansicht `404`.
11. Breite 360 px: Namen in Rangliste und Punkteeingabe tippbar (≥ 44 px), kein Querscrollen; Tab-Taste erreicht Namenslink und Aufklapp-Knopf getrennt.

## 3. Nachweis der Fertigstellung

- Alle Punkte aus Abschnitt 1 grün, Abschnitt 2 durchgespielt und im PR-Text festgehalten (Screenshots der Schritte 2, 4, 9, 10).
- `plans/058-spielerprofil.md` beschreibt Ergebnis, Verifikation und Abweichungen (Repo-Konvention).
