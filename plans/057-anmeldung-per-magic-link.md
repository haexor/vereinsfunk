# 057 – Anmeldung per Magic Link statt Passwort

## Ergebnis

Vereinsfunk kennt keine Passwörter mehr. Wer sich anmeldet, gibt nur die E-Mail-Adresse ein und bekommt einen Anmeldelink. Registrierung und Einladungen funktionieren genauso. Das entspricht playerboard, das Vereinsfunk unter `playerboard.de` abgelöst hat; dessen Nutzer hatten nie ein Passwort.

## Umsetzung

- **`/anmelden`:**
  - `signInWithOtp` mit `shouldCreateUser: false`; der Link führt über `/auth/callback` zum ursprünglichen Ziel (`redirect`).
  - Die Seite bestätigt immer gleich, ob es ein Konto gibt oder nicht (keine Aufzählung von Konten). Nur das Mail-Limit von Supabase Auth (HTTP 429) wird eigens gemeldet.
- **`/registrieren`:** `signInWithOtp` mit `shouldCreateUser: true` und Anzeigenamen; der Link bestätigt die Adresse und meldet an.
- **Einladungen** (Mitglieder und Plattform-Admins): `inviteUserByEmail` leitet direkt zur Annahme weiter, nicht mehr über `/passwort-neu`. Bestehende Konten bekommen wie bisher einen Magic Link.
- **Passwortseiten:**
  - `/passwort-vergessen` ist entfernt; alte Lesezeichen leiten auf `/anmelden` weiter.
  - `/passwort-neu` reicht nur noch zum `redirect` weiter, damit vor der Umstellung verschickte Einladungsmails funktionieren.
- **Mail-Vorlagen:** Deutsche Vorlagen für Supabase Auth liegen unter `apps/web/public/email-templates/` (Anmeldelink, Registrierung, Einladung, Adressänderung). Die selbst gehostete Instanz lädt sie per URL (`GOTRUE_MAILER_TEMPLATES_*`, ansible-Rolle `vereinsfunk-supabase`). So sind sie mit dem Code versioniert.

## Verifikation

- `pnpm lint`, `typecheck`, `test` grün. Die Einladungstests prüfen den direkten Weg zur Annahme.
- **Lokal im Browser** (Mails aus Mailpit):
  - Anmeldung eines bestehenden Kontos per Link landet auf dem ursprünglichen Ziel.
  - Eine unbekannte Adresse bekommt dieselbe Bestätigung und keine Mail.
  - Eine Registrierung ohne Passwort führt per Link ins Onboarding.
  - `/passwort-vergessen` leitet auf `/anmelden` weiter.

## Abweichungen und offene Punkte

- **Passwort-Anmeldung bei Supabase Auth bleibt technisch aktiv.** GoTrue kann sie nicht einzeln abschalten. Ohne Passwortfeld in der Oberfläche und ohne gesetzte Passwörter ist sie aber nicht nutzbar.
- **Lokale Entwicklung:** Die Supabase CLI verschickt weiter ihre englischen Standardmails. Die Vorlagen greifen nur auf der selbst gehosteten Instanz.

## Nachtrag: alte playerboard-Adressen (2026-10-09)

- **Fehler nach dem Go-live:** Wer über ein altes playerboard-Lesezeichen (`/login?redirect=/`) kam, landete nach dem Klick auf den Anmeldelink auf einer 404.
  - Die Anmeldung selbst klappte.
  - `/anmelden` übernahm `/login?redirect=/` als Ziel. Mit gesetzter Sitzung ließ die Middleware den Pfad durch, und Vereinsfunk hat keine solche Seite.
- **Lösung:** `routeRules` in `apps/web/nuxt.config.ts` leiten die alten Adressen dauerhaft (301) weiter:

  | Alte Adresse       | Ziel                                      |
  | ------------------ | ----------------------------------------- |
  | `/login`, `/start` | `/` (ohne Sitzung weiter auf `/anmelden`) |
  | `/callback`        | `/auth/callback`                          |
  | `/profile`         | `/profil`                                 |
  | `/invite/<token>`  | `/einladung?token=<token>`                |
  | `/t/**`            | `/playerboard`                            |

- **Nicht weitergeleitet:** Die alte öffentliche Rangliste `/public/{slug}/ranking` bleibt hinter der Anmeldung. Die neue öffentliche Seite braucht einen Verein- und einen Mannschafts-Slug und muss zuerst freigegeben werden.
- **Geprüft:** Lokal leiten alle Adressen mit und ohne Sitzungs-Cookie weiter. Vorher lieferte playerboard.de für `/login` mit Cookie eine 404.
