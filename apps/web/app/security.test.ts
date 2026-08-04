import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Der Service-Role-Key umgeht RLS und darf niemals ins Browser-Bundle gelangen.
// Dieser Test ist die im Plan 008 zugesicherte Absicherung dafuer.
const APP_DIR = join(import.meta.dirname, '.')

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return collectFiles(path)
    return path.endsWith('.ts') || path.endsWith('.vue') ? [path] : []
  })
}

describe('security', () => {
  it('never references SUPABASE_SERVICE_ROLE_KEY under apps/web/app', () => {
    const offenders = collectFiles(APP_DIR).filter((path) => {
      if (path === import.meta.filename) return false
      return readFileSync(path, 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY')
    })
    expect(offenders).toEqual([])
  })
})
