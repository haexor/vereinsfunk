import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pagesDirectory = join(import.meta.dirname, '.')

describe('channel page composition', () => {
  it('keeps loading and mutations behind the channel composable', () => {
    const page = readFileSync(join(pagesDirectory, 'kanaele.vue'), 'utf8')
    const composable = readFileSync(join(pagesDirectory, '../composables/useChannels.ts'), 'utf8')

    expect(page).toContain('useChannels()')
    expect(page).toContain('<ChannelCard')
    expect(page).not.toContain('useApiClient()')
    expect(page).not.toContain('$fetch')
    expect(composable).toContain('async function load()')
    expect(composable).toContain("method: 'PATCH'")
    expect(composable).toContain("method: 'POST'")
  })
})
