# 054 – Verzeichnis ohne Elternkontakt, eigene E-Mail je Person

## Ergebnis

Das Mitgliederverzeichnis kennt keinen Elternkontakt mehr. Eine minderjährige Person wird mit Name, optionalem Geburtsjahr und Mannschaft geführt, wie jede andere auch. Dafür bekommt jede Person eine eigene, optionale E-Mail-Adresse, über die sie später eingeladen werden kann.

**Betreiberentscheidung 2026-10-06:** Die Eltern-E-Mail wird komplett entfernt. Wer einem Verein beitritt, hat die Erlaubnis der Eltern, und die Einwilligung zu Fotos geben die Eltern beim Eintritt ab oder nicht. Ein gespeicherter Elternkontakt macht alles nur komplizierter, ohne gebraucht zu werden. Es gibt auch keine Elternkonten.

Das Paket ist eine Rahmenänderung und Voraussetzung für 052: Erst ohne die Pflicht zur Eltern-E-Mail können Trainer aktive minderjährige Spieler selbst anlegen.

## Ausgangslage und Evidenz

Geplant auf `e3fb52d` am 2026-10-06.

- `directory_people.guardian_name`/`guardian_email` (`2026080703_integration_framework.sql:168`) und der Check `not is_minor or guardian_email is not null or status <> 'active'` (`:188`). Die Spalten sind vom Standard-Grant ausgenommen (`:299-310`) und werden nur über die Service-Rolle gelesen.
- `recompute_directory_minor_status()` (`:203-211`) schreibt wegen des Checks nur in Richtung „volljährig“.
- API: `apps/api/src/routes/directory.ts` (Felder beim Anlegen und Ändern, nur mit `department.manage`; Filter `missingGuardian`; `GET /v1/directory-people/:id/guardian-contact`; Fehlercode `guardian_contact_required`), `apps/api/src/routes/integrations.ts:251,383` (`canWriteGuardianContact`), `apps/api/src/services/sync/people.ts:100,124,154,186` (Import, `invalid_record`-Konflikt), `apps/api/src/routes/dataSubjects.ts:131,163` (`guardianContact` im Auskunftsexport), Kommentar in `apps/api/src/routes/publishing.ts:119`.
- Verträge: `packages/contracts/src/integrations.ts:135-148,190` (`DirectoryPersonGuardianContactSchema`, Felder in Create/Update), `packages/member-directory/src/person.ts:22`.
- Oberfläche: `apps/web/app/pages/verzeichnis.vue` (Formularfelder, Anzeige „Keine E-Mail hinterlegt“), `apps/web/app/pages/integrationen.vue:104` (Feldzuordnung „E-Mail Erziehungsberechtigte:r“).
- Tests, die `guardian_email` nur setzen, um den Check zu erfüllen: `supabase/tests/channel_scoping_and_secrets.test.sql:312`, `minor_author_approval_stage.test.sql:34`, dazu `consent_management.test.sql`, `directory_and_integrations.test.sql`, `apps/api/src/integrations.routes.test.ts`, `compliance.routes.test.ts`, `packages/contracts/src/integrations.test.ts`.
- `directory_people` hat keine E-Mail der Person selbst.
- **Nicht betroffen**: Einwilligungen (Paket 015). Bei Minderjährigen müssen weiterhin Erziehungsberechtigte unterschreiben (`signer_role = 'guardian'`). Die Papier-Einwilligung beim Eintritt (`origin = 'paper'`) braucht keine Adresse. Eine digitale Einwilligungsanfrage fragt die Empfängeradresse beim Versenden ab (`consent_requests.recipient_email`) und liest sie nicht aus dem Verzeichnis.

## Umsetzung

### Migration `<datum>_directory_without_guardian_contact.sql`

```sql
alter table public.directory_people
  -- unbenannter Tabellen-Check aus 2026080703:188; Name vorher über pg_constraint bestätigen
  drop constraint directory_people_check,
  drop column guardian_name,
  drop column guardian_email,
  add column email text check (email = lower(email) and char_length(email) <= 254);

-- E-Mail ist für alle lesbar, die die Person sehen dürfen (directory.read im Scope).
-- Trainer brauchen sie zum Einladen.
grant select (email) on public.directory_people to authenticated;
```

`recompute_directory_minor_status()` neu anlegen: schreibt in beide Richtungen, Kommentar zur Einschränkung entfällt.

**Achtung, unumkehrbar:** Das Löschen der Spalten löscht vorhandene Elternkontakte in jeder Umgebung, auch in Produktion. Das ist gewollt (Datenminimierung). Vor dem Deploy prüfen, ob die Produktion Elternkontakte enthält, und die Löschung in der Verarbeitungsdokumentation (Paket 020) vermerken.

### API und Verträge

- Alle `guardianName`/`guardianEmail`-Felder, `DirectoryPersonGuardianContactSchema`, der Endpunkt `…/guardian-contact`, der Filter `missingGuardian`, die `department.manage`-Sonderprüfung und der Fehlercode `guardian_contact_required` entfallen.
- Import: kein `invalid_record`-Konflikt mehr für fehlenden Elternkontakt, `canWriteGuardianContact` entfällt. Neues optionales Zielfeld `email` in der Feldzuordnung.
- `email` in Create/Update der Verzeichnisperson (gleiche Rechte wie die übrigen Felder: `directory.read` im Ziel-Scope). `CreateDirectoryPersonRequestSchema` und `UpdateDirectoryPersonRequestSchema` normalisieren die optionale Adresse mit `z.string().trim().toLowerCase().pipe(z.email())` vor der Formatprüfung.
- `PersonExternalSchema` validiert und normalisiert das optionale Importfeld `email` mit `z.string().trim().toLowerCase().pipe(z.email())`; ungültige Werte werden als `invalid_record`-Importkonflikt abgewiesen.
- Auskunftsexport: `guardianContact` raus, `email` rein.

### Oberfläche

- `/verzeichnis`: Elternfelder raus, E-Mail-Feld rein.
- `/integrationen`: Zuordnungsziel „E-Mail Erziehungsberechtigte:r“ durch „E-Mail“ ersetzen.

### Tests

- pgTAP: aktive minderjährige Person ohne Kontakt ist gültig; `recompute_directory_minor_status` macht eine volljährig geführte Person nach Korrektur des Geburtsjahrs wieder minderjährig; `email` wird klein geschrieben erzwungen; `authenticated` mit `directory.read` liest `email`, ohne Recht nicht.
- API- und Importtests weisen ungültige `email`-Werte zurück und bestätigen, dass gültige Adressen vor dem Speichern getrimmt und kleingeschrieben werden.
- Testdaten, die `guardian_email` nur für den Check gesetzt haben, entfernen; Tests für Elternkontakt-Endpunkt und -Rechte entfallen ersatzlos.

## Verifikation

- `pnpm lint`, `typecheck`, `test`, `build`, `db:test` grün nach frischem `supabase db reset`.
- `grep -rniE 'guardian_email|guardianEmail|guardian_name|guardianName'` über `apps`, `packages`, `supabase/migrations` neuer als diese Migration und `supabase/tests` findet nichts mehr. Ältere Migrationen bleiben unverändert (bereits angewendet).
- Manuell: Als `team_manager` einen minderjährigen Spieler ohne E-Mail anlegen, E-Mail später ergänzen.

## Risiken

- Ältere Pläne (014, 015, 019) beschreiben den Elternkontakt weiter. Sie bleiben als historischer Planungsstand stehen; `plans/README.md` verweist auf dieses Paket.

## Umsetzung: Ergebnis und Abweichungen vom Plan

Umgesetzt am 2026-10-06 in Migration `2026100601_directory_without_guardian_contact.sql` plus Verträgen, Import, API und Oberfläche wie oben beschrieben. Verifiziert: `pnpm lint`, `typecheck`, `test` (bis auf die Ausnahme unten), `build` grün; `pnpm db:test` nach frischem `supabase db reset` grün (45 Dateien, 1147 Assertions). Der `grep` aus „Verifikation“ findet nur noch die Negativ-Assertions, die das Fehlen der Felder prüfen.

Abweichungen:

- **Kein ausdrückliches `drop constraint`.** `DROP COLUMN guardian_email` entfernt den unbenannten Tabellen-Check automatisch, weil er die Spalte verwendet. Der vermutete Constraint-Name muss dafür nicht stimmen.
- **Der E-Mail-Check ist strenger als geplant:** Er verlangt neben Kleinschreibung auch eine getrimmte Adresse mit 3 bis 254 Zeichen. Schreibende Pfade normalisieren ohnehin vorher.
- **`email` nimmt am Sync-Abgleich teil** (`createPeopleMatchStrategy.fieldsOf`, `DirectoryPersonLocal.email`). Ohne das würde eine geänderte Adresse in der Quelle nie übernommen, solange sich sonst nichts ändert. Folgerichtig setzt eine manuelle Änderung der E-Mail über `PATCH /v1/directory-people/:id` `source_updated_at`, wie die übrigen abgeglichenen Felder. Eine Quelle ohne E-Mail-Spalte lässt die lokale Adresse unverändert.
- **Rückrichtung im Minderjährigkeitsabgleich** wird als eigenes Audit-Ereignis `directory_person.minor_status_corrected` protokolliert und setzt `became_adult_at` zurück.
- **Der Personen-Import kennt keine Sonderbehandlung mehr** für fehlgeschlagene Updates (Code `23514`). Diesen Fehler konnte nur der entfernte Check auslösen; jeder andere Fehler bricht den Lauf wie zuvor ab.
- **Nicht manuell im Browser geprüft.** „Als `team_manager` einen minderjährigen Spieler ohne E-Mail anlegen“ ist über einen API-Test abgedeckt (`integrations.routes.test.ts`), nicht über einen Durchlauf in der echten Oberfläche.
- **Lokal nicht lauffähig:** `apps/worker/src/websiteRenderer.logoScoring.test.ts` braucht einen installierten Playwright-Chromium und scheitert ohne ihn. Das ist unabhängig von diesem Paket.
