# Data Model: Spielerprofil auf Vereinsebene

Es entsteht **keine neue Tabelle**. Das Profil ist eine lesende Sicht über vorhandene Tabellen.

## Beteiligte Entitäten (vorhanden)

| Entität | Tabelle | Rolle im Profil |
|---|---|---|
| Person im Verein | `directory_people` (`id`, `organization_id`, `first_name`, `last_name`, `status`, `profile_id`, `email`, `team_id`, `department_id`) | Ziel des Links, liefert Name und Status |
| Kadereintrag | `playerboard_players` (`team_id`, `directory_person_id`, `jersey_number`, `position`, `active`) | Mannschaften der Person; eine Person hat 0..n |
| Punkte | `playerboard_point_entries` über `authz.playerboard_ranking_rows` | Summen je Mannschaft und Kategorie, nur gespeicherte Trainings |
| Kategorie | `playerboard_point_categories` über `playerboard_effective_categories` | Namen und Reihenfolge |
| Mannschaft | `teams` | Name der Mannschaft |

## Neue Funktion

`public.person_profile(target_person_id uuid, period text default 'season') returns jsonb`

- `security definer`, `set search_path = public, pg_temp`, `revoke all ... from public`, `grant execute ... to authenticated, service_role`.
- Liefert `null`, wenn die Person nicht existiert **oder** für `auth.uid()` nicht sichtbar ist (Regeln siehe research.md §2, §3).
- `period`: `season` oder `all`; jeder andere Wert löst `invalid_period` aus. Bei `season` bestimmt `authz.current_season_start(season_start date, today date)` den Anfang je Mannschaft; ohne wirksamen Saisonbeginn gilt die gesamte Zeit.

`authz.current_season_start(season_start date, today date) returns date` (`immutable`): letzter Saisonstart (Monat/Tag) am oder vor `today`; ein 29. Februar wird in Nicht-Schaltjahren auf den 28. gesetzt; `null` bei `season_start is null`. Spiegel von `currentSeasonStart` in `packages/domain/src/playerboard.ts`.

### Rückgabe (jsonb)

```text
{
  "id": uuid,
  "organizationId": uuid,
  "firstName": text,
  "lastName": text,
  "status": "active" | "left" | ...,          -- wie directory_people.status
  "teams": [
    {
      "teamId": uuid,
      "teamName": text,
      "playerId": uuid,
      "jerseyNumber": int | null,
      "position": text | null,
      "active": boolean,
      "isSelf": boolean,                       -- Konto des Betrachters ist mit dieser Person verknüpft
      "rank": int,
      "total": int,
      "categoryTotals": { "<categoryId>": int }
    }
  ]
}
```

`teams` enthält nur Mannschaften, deren Kennzahlen die aufrufende Person sehen darf (`authz.can_view_playerboard_stats`). Eine Person im Kader einer Nachbarmannschaft, die der Betrachter nicht sieht, taucht dort nicht auf, auch nicht als leerer Eintrag.

## Validierungsregeln

- `target_person_id` ist eine UUID; die Route validiert sie vorab mit Zod, ein ungültiger Wert ergibt `400 invalid_request`.
- `period` ∈ `season | all`, Standard `season`.
- Die Rückgabe wird in der Route mit `PersonProfileSchema` geparst (Systemgrenze); nicht passende Daten ergeben `500`, nicht ein halb gefülltes Profil.
- Verwaltungsfelder (`email`, `hasAccount`) setzt **nur die Route** nach Prüfung von `training.manage`; die Funktion liefert sie nie.

## Zustandsübergänge

Keine. Das Profil ist schreibgeschützt; Pflege bleibt im Kader und im Verzeichnis.

## Mandantentrennung

- Jede Zeile trägt über `directory_people.organization_id` bzw. `teams.organization_id` den Verein; die Funktion verknüpft ausschließlich über zusammengesetzte Schlüssel `(organization_id, …)`, damit kein Cross-Tenant-Join entsteht.
- Die Funktion prüft Sichtbarkeit ausschließlich über bestehende `authz.*`-Funktionen, die ein Nichtmitglied mit `false`/`null` beantworten.
