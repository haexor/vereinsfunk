import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

describe('usePolling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads once more when refreshed while a request started before a mutation is in flight', async () => {
    vi.stubGlobal('onUnmounted', () => {})
    let state = 'old'
    let shown = ''
    const releases: (() => void)[] = []
    const load = vi.fn(async () => {
      const snapshot = state
      await new Promise<void>((resolve) => releases.push(resolve))
      shown = snapshot
    })
    const { refresh } = usePolling(load, () => false)

    const poll = refresh()
    state = 'new'
    const afterMutation = refresh()
    releases.shift()!()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.shift()!()
    await Promise.all([poll, afterMutation])

    expect(load).toHaveBeenCalledTimes(2)
    expect(shown).toBe('new')
  })

  it('reports the failure of the latest run and ignores one of an outdated run', async () => {
    vi.stubGlobal('onUnmounted', () => {})
    let call = 0
    const releases: (() => void)[] = []
    const { refresh } = usePolling(async () => {
      call += 1
      const failing = call === 1
      await new Promise<void>((resolve) => releases.push(resolve))
      if (failing) throw new Error('outdated')
    }, () => false)

    const poll = refresh()
    const afterMutation = refresh()
    releases.shift()!()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.shift()!()

    await expect(Promise.all([poll, afterMutation])).resolves.toBeDefined()
  })
})
