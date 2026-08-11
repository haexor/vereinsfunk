// Jede pgTAP-Datei muss genau eine Transaktion sein, die am Ende zurueckgerollt wird.
//
// Der Grund ist ein realer, zweimal unabhaengig durchgerutschter Fehler (Paket 015 und Paket 016):
// consent_management.test.sql und metrics.test.sql schlossen mit "commit;" statt "rollback;". Ihre
// Fixtures blieben damit in der Datenbank stehen, und der naechste "pnpm db:test" ohne "db:reset"
// dazwischen brach in diesen Dateien schon am eigenen ersten Fixture-Insert ab (duplicate key auf
// auth.users) -- noch VOR der ersten Assertion. Das liest sich als "planned 30 tests but ran 0" und
// sieht aus wie ein Fehler in der Sache, ist aber nur ein Datenrest des Vorlaufs. Nebenbei blieben
// die Testdaten in der lokalen Entwicklungsdatenbank liegen.
//
// Geprueft werden bewusst nur die beiden Klammern (erste Anweisung "begin;", letzte "rollback;"):
// das ist genau die Form, in der der Fehler zweimal auftrat, und sie kann nicht fehlalarmieren. Ein
// zusaetzlicher Scan auf "commit;"/"end;" mitten in der Datei bliebe ungenau, weil "end;" auch jeden
// plpgsql-Block beendet.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = fileURLToPath(new URL('../supabase/tests/', import.meta.url))
const files = readdirSync(testsDir).filter((name) => name.endsWith('.test.sql')).sort()

const problems = []
for (const name of files) {
  const statements = readFileSync(join(testsDir, name), 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
  if (statements.at(0) !== 'begin;') problems.push(`${name}: erste Anweisung ist "${statements.at(0)}", erwartet "begin;"`)
  if (statements.at(-1) !== 'rollback;') problems.push(`${name}: letzte Anweisung ist "${statements.at(-1)}", erwartet "rollback;"`)
}

if (problems.length > 0) {
  console.error(`\n${problems.length} pgTAP-Datei(en) rollen ihre Fixtures nicht zurueck:\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\nEine Datei, die nicht mit "begin;" oeffnet und mit "rollback;" schliesst, laesst ihre Fixtures\n' +
    'in der Datenbank stehen. Der naechste "pnpm db:test" ohne "db:reset" dazwischen bricht dann in\n' +
    'dieser Datei vor der ersten Assertion ab ("planned N tests but ran 0") und sieht aus wie ein\n' +
    'fachlicher Fehler. Letzte Zeile auf "rollback;" aendern -- die Assertions laufen ohnehin alle\n' +
    'vor "select * from finish();" und brauchen kein Commit.\n',
  )
  process.exit(1)
}

console.log(`pgTAP-Isolation: ${files.length} Testdateien oeffnen mit begin; und schliessen mit rollback;`)
