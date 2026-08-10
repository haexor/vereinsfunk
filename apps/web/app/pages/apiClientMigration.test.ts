import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGES_DIR = join(import.meta.dirname, '.')

describe('API-client migration', () => {
  for (const page of ['marke.vue', 'mitglieder.vue', 'integrationen.vue']) {
    it(`${page} delegates browser requests to useApiClient`, () => {
      const source = readFileSync(join(PAGES_DIR, page), 'utf8')

      expect(source).toContain('useApiClient()')
      expect(source).not.toContain('useAuthHeader()')
      expect(source).not.toContain('config.public.apiBase')
      expect(source).not.toContain('$fetch')
    })
  }
})
