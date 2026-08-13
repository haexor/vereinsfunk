import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

/**
 * Plan 036: der Boot-Hook, der `supabase/migrations` bei jedem Container-Start anwendet --
 * Watchtower tauscht Images unabhaengig von jedem Ansible-Lauf aus, ein Hook im Prozessstart
 * selbst ist der einzige Punkt, den dieses Rollout-Modell zuverlaessig trifft.
 */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

export type MigrationCliRunner = (databaseUrl: string) => Promise<void>

// `supabase db push --workdir` erwartet das Verzeichnis, das den Ordner `supabase/` enthaelt --
// dessen Tiefe relativ zum Prozess-cwd unterscheidet sich zwischen den beiden Aufrufkontexten
// dieses Pakets: `pnpm --filter @vereinsfunk/api dev` startet mit cwd=apps/api (zwei Ebenen
// unter dem Repo-Root, wo supabase/migrations liegt), das Laufzeit-Image dagegen mit cwd=/app,
// wohin apps/api/Dockerfile bzw. apps/worker/Dockerfile supabase/migrations direkt hineinkopieren.
// Erkennung statt einer weiteren Umgebungsvariable: die waere selbst wieder ein Ort, an dem genau
// die Art von Drift entstehen kann, die dieser Plan beheben soll.
function resolveMigrationsWorkdir(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..', '..')]
  const found = candidates.find((dir) => existsSync(path.join(dir, 'supabase', 'migrations')))
  if (!found) throw new MigrationError(`could not locate supabase/migrations from any of: ${candidates.join(', ')}`)
  return found
}

// `supabase` ist ein CLI-Paket, dessen bin-Eintrag (dist/supabase.js) selbst wieder die
// heruntergeladene, plattformspezifische Binary aufruft -- require.resolve statt eines fest
// verdrahteten node_modules/.bin-Pfads, weil pnpms hoisted-Layout im Laufzeit-Image (siehe
// apps/api/Dockerfile, `deploy --legacy --config.node-linker=hoisted`) anders aussieht als das
// isolierte Dev-Layout.
function resolveSupabaseCliEntry(): string {
  const packageJsonPath = require.resolve('supabase/package.json')
  const packageJson = require(packageJsonPath) as { bin?: Record<string, string> }
  const relativeBin = packageJson.bin?.supabase
  if (!relativeBin) throw new MigrationError('supabase package does not declare a "supabase" bin entry')
  return path.join(path.dirname(packageJsonPath), relativeBin)
}

const defaultCliRunner: MigrationCliRunner = async (databaseUrl) => {
  const cliEntry = resolveSupabaseCliEntry()
  const workdir = resolveMigrationsWorkdir()
  await execFileAsync(process.execPath, [cliEntry, 'db', 'push', '--yes', '--workdir', workdir, '--db-url', databaseUrl])
}

export interface RunPendingMigrationsOptions {
  /** Nur für Tests; sonst der echte `supabase db push`-Aufruf. */
  runner?: MigrationCliRunner
  log?: (message: string) => void
}

/**
 * Wendet ausstehende Migrationen an und wirft bei jedem Fehler -- der Aufrufer (apps/api/src/server.ts,
 * apps/worker/src/index.ts) faengt das bewusst nicht ab. Ein Container, der deswegen ueber seine
 * bestehende Restart-Policy neu startet, ist ein sichtbarer Zustand; eine API, die still gegen ein
 * halb migriertes Schema weiterlaeuft, ist genau der unsichtbare Fehler, den dieser Hook verhindern soll.
 */
// `execFile`'s own error/`stderr` can echo the full invoked command line, including
// `--db-url <databaseUrl>` -- redact the literal connection string before it reaches a
// MigrationError, and from there any log that prints it.
function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('[redacted]') : text
}

export async function runPendingMigrations(databaseUrl: string, options: RunPendingMigrationsOptions = {}): Promise<void> {
  const { runner = defaultCliRunner, log = () => {} } = options
  log('applying pending database migrations')
  try {
    await runner(databaseUrl)
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: unknown }).stderr) : ''
    const message = error instanceof Error ? error.message : String(error)
    throw new MigrationError(redact(`supabase db push failed: ${message}${stderr ? ` -- ${stderr}` : ''}`, databaseUrl))
  }
  log('database migrations applied')
}
