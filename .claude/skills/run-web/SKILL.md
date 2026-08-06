---
name: run-web
description: Startet die Nuxt-App (apps/web) lokal und treibt sie im Browser an — inklusive Login, Screenshots und optionalem visuellem Vergleich zweier Stände. Nutzen, wenn eine Änderung in der echten App gesehen werden soll und nicht nur in Tests.
---

# apps/web lokal starten und ansteuern

## Voraussetzungen

Die App braucht lokales Supabase und die API. Beide prüfen, nicht annehmen:

```bash
curl -s -o /dev/null -w "supabase %{http_code}\n" http://localhost:4260/rest/v1/
curl -s -o /dev/null -w "api      %{http_code}\n" http://localhost:4201/health
```

Antwortet Supabase nicht: `pnpm db:start`.

## apps/web/.env — der häufigste Stolperstein

`.env` ist gitignored und fehlt deshalb in **jedem frisch angelegten Worktree**. Ohne sie startet der Server, liefert aber auf jeder Route eine Nuxt-500-Seite mit `supabaseUrl is required`. Die 500-Seite nutzt das App-CSS nicht — sie sieht aus wie ein kaputtes Stylesheet, ist aber ein fehlendes Env.

```bash
cp /home/haex/Projekte/vereinsfunk/apps/web/.env apps/web/.env
```

Die Datei enthält `NUXT_PUBLIC_API_BASE`, `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`. Vorlage: `apps/web/.env.example`.

## Starten und stoppen

```bash
lsof -ti:4200 -sTCP:LISTEN | xargs -r kill    # immer zuerst, sonst EADDRINUSE
pnpm dev:web > /tmp/devserver.log 2>&1 &
timeout 150 bash -c 'until curl -sf http://localhost:4200 >/dev/null 2>&1; do sleep 2; done'
```

Auf den Port pollen, nicht `sleep`. Der erste Start dauert bis zu 60s.

Zwei Stände parallel gehen nicht — beide wollen Port 4200. Für einen Vergleich nacheinander fahren: Haupt-Checkout und Worktree haben getrennte `node_modules`, ein Branchwechsel ist dafür also nicht nötig.

## Anmelden

Seed-User aus `supabase/seed.sql`, Passwort für alle: `local-demo-password`

| E-Mail | Rolle |
|---|---|
| `lena@example.local` | Vereinsinhaberin — voller Zugriff, für die meisten Seiten die richtige Wahl |
| `jonas@example.local` | Mitglied |
| `betreiber@example.local` | Plattform-Admin, bewusst **ohne** Vereinsmitgliedschaft (für `/plattform-admin/*`) |

**Direkt `/anmelden` ansteuern, nicht `/`.** Von `/` aus läuft die Umleitung client-seitig, und `networkidle` ist durch, bevor das Formular im DOM steht — `fill` scheitert dann still und man landet wieder auf der Anmeldung.

Nach dem Klick auf das Ende der Umleitung warten, nicht auf `networkidle`:

```js
await page.goto('http://localhost:4200/anmelden', { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'lena@example.local')
await page.fill('input[type="password"]', 'local-demo-password')
await page.click('button:has-text("Anmelden")')
await page.waitForURL((u) => !u.pathname.startsWith('/anmelden'), { timeout: 60000 })
```

Die Session hängt am Browser-Context, ein Login pro Lauf reicht für alle Routen.

## Ansteuern

`chromium-cli` ist hier nicht installiert. Playwright-Browser liegen aber unter `~/.cache/ms-playwright`, ein eigenes Treiberverzeichnis genügt:

```bash
mkdir -p /tmp/driver && cd /tmp/driver
printf '{"name":"driver","private":true,"type":"module"}\n' > package.json
pnpm add playwright
```

Danach Skript mit `node`. Nach dem Login navigieren, `document.fonts.ready` abwarten (sonst misst man den Fallback-Font statt DM Sans / Manrope), dann `page.screenshot({ fullPage: true })`.

**Immer in den Screenshot schauen.** Eine weiße oder 500er-Seite ist kein Erfolg.

## Visueller Vergleich zweier Stände

Für Änderungen an CSS oder am Styling-Setup: beide Stände nacheinander screenshotten, dann pixelweise vergleichen. ImageMagick ist vorhanden.

```bash
compare -metric AE alt.png neu.png diff.png
```

Höhenunterschiede sind das wichtigste Signal — sie bedeuten Layout-Verschiebung, nicht Farbabweichung. Bei gleicher Höhe zeigt `diff.png`, *wo* es abweicht.

Das Nuxt-Devtools-Badge unten mittig zeigt die Renderdauer und weicht zwischen zwei Läufen immer ab. Ein paar hundert abweichende Pixel dort sind normal.

Reicht das Bild nicht, um die Ursache zu finden: Geometrie und Computed Styles aller Elemente in beiden Ständen dumpen (`getBoundingClientRect` plus `fontSize`, `lineHeight`, `paddingTop`, `marginTop`) und die JSON-Dumps vergleichen. Das zeigt das erste Element, dessen Metrik sich ändert — die Ursache — statt der vielen verschobenen Elemente darunter, die nur Folge sind.

## Aufräumen

```bash
lsof -ti:4200 -sTCP:LISTEN | xargs -r kill
```

Kopierte `apps/web/.env` im Worktree wieder löschen, damit sie nicht im Commit landet — sie ist zwar gitignored, aber ein `git add -f` oder ein anderes Ignore-Setup macht daraus schnell ein Leak.
