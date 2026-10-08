# 055 – Modulsichtbarkeit nach Mitgliedschaft und Rechten

## Ergebnis

Jede Person sieht in der Oberfläche genau die Module, die **für sie** gelten. Bisher gelten die Module des gewählten Arbeitsbereichs, unabhängig davon, wo sie Mitglied ist und was sie darf.

- **Ebenen mit eigener Mitgliedschaft zählen.**
  - Wer nur einer Mannschaft angehört, sieht die Module, die in dieser Mannschaft wirken.
  - Hat eine Abteilung Social Media für die U13 abgewählt, sieht eine Spielerin der U13 Social Media nicht mehr, auch wenn sie im Arbeitsbereich „Verein“ steht.
- **Ohne Recht keine Bedienelemente.** Ein Modul erscheint nur, wenn die Person dort mindestens ein Recht dieses Moduls hat. Eine Spielerin (nur `training.view`) sieht PlayerBoard, aber weder „Neuer Beitrag“ noch Beiträge, Freigaben oder die Social-Media-Kacheln.
- **Aktionen nach Recht.**
  - „Beitrag erstellen“ (Seitenleiste, Startseite) und die Erstell-Links im Kalender verlangen `post.create`.
  - „PlayerBoard verwalten“ verlangt `playerboard.manage`.
- **Die Erklärseite unterscheidet.**
  - „Modul ist hier nicht aktiviert“, mit Grund und zuständiger Stelle.
  - „Du hast hier keinen Zugriff auf dieses Modul“.

Die Staffelung selbst bleibt, wie sie mit 051 gebaut ist und wie der Betreiber sie bestätigt hat (2026-10-08):
- Der Verein legt fest, welche Abteilungen welche Module bekommen.
- Die Abteilung schränkt für sich und ihre Mannschaften weiter ein.
- Mannschaften schränken weiter ein, nie erweitern.

Dieses Paket ändert nur, **wie die Oberfläche** diese Einstellungen für eine Person auswertet. Datenbank und API bleiben unverändert; sie setzen Modul und Rechte schon heute je Ziel-Scope durch.

## Ausgangslage und Evidenz

Geplant auf `573df17` am 2026-10-08.

- **Arbeitsbereich statt Mitgliedschaft.** `useScopeModules()` (`apps/web/app/composables/useScopeModules.ts`) wertet über `scopeModulesFor()` (`apps/web/app/modules/registry.ts`) nur den Eintrag des Arbeitsbereichs aus, also Verein oder Abteilung.
  - Mannschaften sind kein Arbeitsbereich. Die Abwahl eines Moduls auf Mannschaftsebene wirkt deshalb in der Oberfläche nie.
  - Ein reines Mannschaftsmitglied landet beim ersten Öffnen auf Vereinsebene (`defaultScope()` in `useScope.ts`) und sieht die Module des Vereins.
- **Keine Rechteprüfung beim Einblenden.** Seitenleiste (`layouts/default.vue`, Modulgruppen und „Beitrag erstellen“), Startseite (`pages/index.vue`, „Neuer Beitrag“, Kennzahlen, Beiträge, Redaktionsplan) und Kalender (`pages/kalender.vue`, Erstell-Links) blenden Social Media ein, sobald das Modul aktiv ist.
  - Gefunden im Browser-Test zu 052 PR 4: Die Spielerin sieht „Neuer Beitrag“ und die Social-Media-Kacheln.
  - Speichern könnte sie nichts; `requirePermission` lehnt mit `403` ab.
- **Folgefehler auf der Startseite.** `loadDashboard()` fragt auch für reine Mannschaftsmitglieder `GET /v1/onboarding` an und bekommt `404` (Konsolenfehler).
- **Die Daten liegen schon vor.**
  - `GET /v1/organizations/:id/scope-modules` liefert jedem Mitglied den wirksamen Modulstatus aller Ebenen, Mannschaften eingeschlossen (`apps/api/src/routes/modules.ts`).
  - Die Sitzung (`useSession()`) kennt die Rollen je Verein, Abteilung und Mannschaft.
  - `permissionModule` (`packages/authorization`) ordnet jedes Recht einem Modul oder dem Rahmen zu.

## Fachliches Modell

### Ankerebenen

Ankerebenen sind die Ebenen im aktiven Arbeitsbereich, auf denen die Person eine eigene Rolle hat:

| Arbeitsbereich | Ankerebenen |
|---|---|
| Verein | der Verein (bei einer Vereinsrolle), jede Abteilung mit eigener Abteilungsrolle, jede Mannschaft mit eigener Mannschaftsrolle |
| Abteilung D | D (bei einer Vereins- oder Abteilungsrolle für D), jede Mannschaft in D mit eigener Mannschaftsrolle |

Die Rollen auf einer Ankerebene sind wie bei `useCan()` die Rollen dieser Ebene und aller darüber.

### Sichtbarkeit eines Moduls

```text
sichtbar(Modul) = es gibt eine Ankerebene A mit
                    Modul wirkt auf A                                     (scope-modules)
                  und die Rollen auf A enthalten ein Recht p mit permissionModule[p] = Modul
```

- Weil untere Ebenen nur abwählen können, ändert sich für Vereinsrollen nichts: Der Vereinseintrag enthält alles, was darunter wirken kann.
- **Ist der Modulstatus unbekannt** (lädt noch, Ladefehler), gilt er weiter als wirksam, wie in 051 („fail open“, damit ein Netzwerkfehler niemanden aussperrt).
  - Die Rechteprüfung gilt trotzdem, sie hängt nur an der Sitzung.
  - Eine Spielerin sieht Social Media also auch dann nicht, wenn die Modulliste nicht lädt.

### Drei Zustände je Modul

| Zustand | Bedeutung | Oberfläche |
|---|---|---|
| `visible` | wirkt auf einer Ankerebene, Recht vorhanden | Navigation, Seiten, Kacheln |
| `disabled` | die Person hätte ein Recht, aber auf keiner ihrer Ankerebenen wirkt das Modul | ausgeblendet; Direktaufruf → „nicht aktiviert“ mit Grund der ersten betroffenen Ankerebene |
| `no_access` | kein Recht des Moduls auf einer Ankerebene | ausgeblendet; Direktaufruf → „kein Zugriff“, ohne Verweis auf die Modulverwaltung |

### Aktionen nach Recht

- **`canUse(permission)`:** wahr, wenn auf einer Ankerebene das Modul des Rechts wirkt und die Rollen dort das Recht enthalten. Für Rechte des Rahmens zählt nur die Rolle.
- **Navigationseinträge im Modul-Registry** bekommen optional `permissions` (eines davon genügt):
  - PlayerBoard „Kategorien“ und „Einstellungen“: `playerboard.manage`.
  - Alle übrigen Einträge erscheinen mit dem Modul.
- **„Beitrag erstellen“** in Seitenleiste und Startseite und die Erstell-Links im Kalender verlangen `canUse('post.create')`.
- **Der Social-Media-Teil der Startseite** lädt nur bei sichtbarem Modul. Das beseitigt den `404` auf `/v1/onboarding` für Mannschaftsmitglieder. Die Karte „Social Media ist nicht aktiviert“ erscheint nur im Zustand `disabled`, nicht bei `no_access`.

## Umsetzung

Ein PR, nur `apps/web`:

- `apps/web/app/modules/registry.ts`:
  - `anchorScopes()`, `moduleAvailability()` und `canUsePermission()` als reine Funktionen über Modulliste, Sitzungs-Scopes und Arbeitsbereich.
  - `permissions` an `ModuleNavItem`; Tests in `registry.test.ts`.
- `useScopeModules()`:
  - liest zusätzlich die Sitzung;
  - liefert `availability(module)`, `isEnabled(module)` (= `visible`), `canUse(permission)` und `explanation(module)` (Ankerebene samt Grund für die Erklärseite);
  - `enabled` listet die sichtbaren Module.
- Aufrufer: `layouts/default.vue` (Modulgruppen, Einträge nach `permissions`, „Beitrag erstellen“), `pages/index.vue`, `pages/kalender.vue`, `pages/modul-inaktiv.vue` (zwei Texte), `middleware/module.global.ts` (unverändert über `isEnabled`).

## Verifikation

- Vitest für die reinen Funktionen:
  - Vereinsrolle, Abteilungsrolle, reines Mannschaftsmitglied;
  - Abwahl auf Mannschaftsebene;
  - unbekannte Modulliste;
  - Spielerin ohne Social-Media-Recht;
  - Abteilungsleitung einer anderen Abteilung im Arbeitsbereich „Verein“.
- `pnpm lint`, `typecheck`, `test`, `build` grün.
- **Im Browser gegen den lokalen Stack, als Spielerin:**
  - keine Social-Media-Gruppe, kein „Beitrag erstellen“, keine Social-Media-Kacheln, kein `404` auf `/v1/onboarding`;
  - `/beitraege` direkt aufgerufen zeigt „kein Zugriff“.
- **Abwahl auf Mannschaftsebene:** Social Media wird für die U13 abgewählt; ein Trainer, der nur der U13 angehört, sieht Social Media nicht mehr.
- **Als Vereinsinhaberin:** unverändert.

## Bewusst nicht enthalten

- **Rahmen-Navigation nach Rechten.** „Verein verwalten“ (Struktur, Mitglieder, Verzeichnis, …) erscheint weiterhin für alle; die Seiten selbst zeigen bei fehlendem Recht einen Hinweis. Ein eigenes Paket, falls gewünscht.
- **Mannschaft als Arbeitsbereich in der Seitenleiste.** Nicht nötig: Die Ankerebenen decken Mannschaftsmitglieder ab, ohne dass jemand eine Mannschaft auswählen muss.
- **Änderungen an API oder Datenbank.** Die Durchsetzung dort ist schon je Ziel-Scope korrekt (051).

## Umsetzung: Ergebnis und Abweichungen

Umgesetzt am 2026-10-08:
- **Modul-Registry** (`apps/web/app/modules/registry.ts`): `anchorScopes()`, `moduleAvailability()`, `canUsePermission()`; `permissions` an Navigationseinträgen; PlayerBoard „Kategorien“ und „Einstellungen“ mit `playerboard.manage`.
- **`useScopeModules()`:** `availability()`, `isEnabled()` (nur `visible`), `canUse()` und `explanation()`.
- **Seitenleiste:**
  - Modulgruppen und Einträge nach Sichtbarkeit und Rechten.
  - „Beitrag erstellen“ mit `post.create`.
- **Startseite:**
  - Social-Media-Teil nur bei sichtbarem Modul; ohne jedes Social-Media-Recht auch kein Hinweis „nicht aktiviert“.
  - „Neuer Beitrag“ mit `post.create`.
  - Der Hinweis nennt die Ebene, auf der das Modul abgewählt ist.
- **Kalender:** Erstell-Links mit `post.create`.
- **„Modul inaktiv“:** zwei Fälle, „nicht aktiviert“ (mit Grund der betroffenen Ankerebene) und „kein Zugriff“.

Verifiziert:
- `pnpm lint`, `typecheck`, `test` (alle 38 Tasks), `build` grün.
- Sieben neue Vitest-Fälle in `registry.test.ts`.
- Datenbank, API und Pakete sind unverändert, deshalb kein neuer pgTAP-Lauf.
- Im Browser gegen den lokalen Stack:
  - **Vereinsinhaberin wählt auf „Module“ Social Media für die U13 ab:** Ihre eigene Oberfläche bleibt unverändert, mit Social-Media-Gruppe, „Beitrag erstellen“, Kacheln und „PlayerBoard verwalten“.
  - **Spielerin der U13:**
    - keine Social-Media-Gruppe, kein „Beitrag erstellen“, keine Social-Media-Kacheln und kein Hinweis;
    - kein „PlayerBoard verwalten“;
    - kein `404` mehr auf `/v1/onboarding`;
    - `/beitraege` zeigt „Du hast hier keinen Zugriff auf Social Media“.
  - **Trainer, der nur der U13 angehört** (Arbeitsbereich „Verein“):
    - keine Social-Media-Gruppe, kein „Beitrag erstellen“;
    - auf der Startseite „In U13 ist Social Media nicht aktiviert“;
    - `/beitraege` zeigt „Social Media ist in U13 nicht aktiviert“;
    - „PlayerBoard verwalten“ und `/playerboard/kategorien` bleiben erreichbar.

Abweichungen: keine.
