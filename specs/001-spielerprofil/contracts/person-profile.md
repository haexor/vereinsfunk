# Contract: Personenprofil

Schnittstellen, die dieses Feature neu bereitstellt. Die Zod-Schemas entstehen in `packages/contracts/src/personProfile.ts`; dieses Dokument legt die Form fest, nicht den Code.

## HTTP

### `GET /v1/people/:id/profile`

| | |
|---|---|
| Authentifizierung | Pflicht (`requireAuth`), sonst `401` |
| Pfad | `id`: UUID der Verzeichnisperson |
| Query | `period`: `season` (Standard) oder `all` |

**Antworten**

| Status | Bedingung | Body |
|---|---|---|
| `200` | Person sichtbar | `PersonProfile` (unten) |
| `400` | `id` oder `period` ungültig | `{ error: 'invalid_request', correlationId }` |
| `401` | nicht angemeldet | wie überall |
| `404` | Person unbekannt **oder** nicht sichtbar, **ununterscheidbar** (gleicher Body, gleicher Header-Satz) | `{ error: 'not_found', correlationId }` |

Kein `403`. Kein Hinweis im Body, ob die Person existiert.

**`PersonProfile`**

```text
{
  id: uuid,
  firstName: string,
  lastName: string,
  status: DirectoryPersonStatus,
  teams: [
    {
      teamId: uuid,
      teamName: string,
      playerId: uuid,
      jerseyNumber: number | null,
      position: string | null,
      active: boolean,
      isSelf: boolean,
      rank: number,
      total: number,
      categories: [ { name: string, points: number } ]    // Reihenfolge der Mannschaft
    }
  ],
  // Nur mit training.manage in mindestens einer der sichtbaren Mannschaften:
  email?: string | null,
  hasAccount?: boolean
}
```

Nie enthalten: Geburtsjahr, `isMinor`, Elternkontakte, Konto-Id.

**Garantien**

1. Ohne `training.manage` fehlen `email` und `hasAccount` als Schlüssel (nicht `null`).
2. `teams` enthält nur Mannschaften, deren Kennzahlen der Betrachter sehen darf.
3. `teams[].total` und `categories` stimmen mit `GET /v1/playerboard/teams/:teamId/ranking` für denselben Zeitraum überein.
4. Antwort ist `Cache-Control: private, no-store` (personenbezogen).

## Datenbank

### `public.person_profile(target_person_id uuid, period text default 'season') returns jsonb`

Beschreibung und Rückgabeform: [data-model.md](../data-model.md). Aufrufbar durch `authenticated` und `service_role`; alle Sichtbarkeitsprüfungen laufen innerhalb der Funktion anhand von `auth.uid()`.

## UI-Vertrag

### Route `/personen/[id]`

- Erreichbar für angemeldete Konten; die Seite zeigt den Fall `404` als verständliche „Person nicht gefunden“-Seite (FR-014) ohne technische Details.
- Zeigt: Name, Statuskennzeichen (inaktiv/ausgetreten), je Mannschaft eine Karte mit Trikot, Position, Rang, Gesamtpunkten und aufklappbaren Kategorien, einen Umschalter „Laufende Saison / Gesamte Zeit“.
- Trainer sehen zusätzlich E-Mail und Kontostatus.

### Komponente `PersonLink`

| Prop | Typ | Bedeutung |
|---|---|---|
| `personId` | `string \| null \| undefined` | Ziel; fehlt sie, rendert die Komponente den Slot als reinen Text (kein Link, kein Fokusziel) |
| Slot | Inhalt | Anzeigename |

Verhalten: Ziel `/personen/${personId}`; sichtbarer Fokusring (`focus-ring`); Touchfläche ≥ 44 px, wenn die Umgebung nicht selbst eine Zeilenhöhe vorgibt; kein `target="_blank"`.
