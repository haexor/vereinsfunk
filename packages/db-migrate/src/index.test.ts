import { describe, expect, it, vi } from 'vitest'
import { MigrationError, runPendingMigrations } from './index.js'

describe('runPendingMigrations', () => {
  it('resolves without throwing when the runner succeeds', async () => {
    const runner = vi.fn(async () => {})
    await expect(runPendingMigrations('postgresql://example', { runner })).resolves.toBeUndefined()
    expect(runner).toHaveBeenCalledWith('postgresql://example')
  })

  // Entscheidung 4 (Plan 036): ein fehlgeschlagener Push muss den Prozess hart beenden koennen --
  // runPendingMigrations faengt den Fehler nicht ab, sondern wirft einen eigenen, aussagekraeftigen.
  it('throws MigrationError with the underlying stderr when the runner fails', async () => {
    const runner = vi.fn(async () => {
      const error = new Error('Command failed') as Error & { stderr: string }
      error.stderr = 'relation "generation_candidates" already exists'
      throw error
    })
    await expect(runPendingMigrations('postgresql://example', { runner })).rejects.toThrow(MigrationError)
    await expect(runPendingMigrations('postgresql://example', { runner })).rejects.toThrow(/already exists/)
  })

  // Regression: `execFile`'s own error/stderr can echo the full invoked command line,
  // including `--db-url <databaseUrl>` -- a MigrationError must never carry the raw
  // connection string (with its password) into a container log.
  it('redacts the database URL from a thrown MigrationError', async () => {
    const databaseUrl = 'postgresql://postgres:secret-password@db.example:5432/postgres'
    const runner = vi.fn(async () => {
      const error = new Error(`Command failed: supabase db push --db-url ${databaseUrl}`) as Error & { stderr: string }
      error.stderr = `connection to ${databaseUrl} refused`
      throw error
    })
    let rejection: unknown
    try {
      await runPendingMigrations(databaseUrl, { runner })
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(MigrationError)
    expect((rejection as Error).message).not.toContain('secret-password')
    expect((rejection as Error).message).toContain('[redacted]')
  })

  it('logs before and after a successful run', async () => {
    const log = vi.fn()
    await runPendingMigrations('postgresql://example', { runner: async () => {}, log })
    expect(log).toHaveBeenCalledWith('applying pending database migrations')
    expect(log).toHaveBeenCalledWith('database migrations applied')
  })
})
