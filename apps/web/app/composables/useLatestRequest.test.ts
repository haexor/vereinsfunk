import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useLatestRequest, useScopedLoad } from './useLatestRequest'

describe('useLatestRequest', () => {
  it('only lets the most recently started run write its result', () => {
    const { begin } = useLatestRequest()
    const first = begin()
    const second = begin()

    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('drops every run once the owning scope is disposed', () => {
    const scope = effectScope()
    const isLatest = scope.run(() => useLatestRequest().begin())!

    scope.stop()

    expect(isLatest()).toBe(false)
  })
})

describe('useScopedLoad', () => {
  it('ignores a late answer for an earlier key after switching A -> B -> A', async () => {
    const key = ref('A')
    const resolvers: (() => void)[] = []
    const shown = ref<string | null>(null)
    let call = 0
    const { ready } = useScopedLoad(() => key.value, async (requested, isLatest) => {
      const label = `${requested}${++call}`
      await new Promise<void>((resolve) => resolvers.push(resolve))
      if (isLatest()) shown.value = label
    })
    resolvers.shift()!()
    await ready

    key.value = 'B'
    await nextTick()
    key.value = 'A'
    await nextTick()
    const [loadB, loadA] = [resolvers.shift()!, resolvers.shift()!]
    loadA()
    await Promise.resolve()
    loadB()
    await Promise.resolve()

    expect(shown.value).toBe('A3')
  })

  it('does not reload while the primitive key keeps its value', async () => {
    const scope = ref({ organizationId: 'A' })
    let loads = 0
    const { ready } = useScopedLoad(() => scope.value.organizationId, async () => { loads += 1 })
    await ready

    scope.value = { organizationId: 'A' }
    await nextTick()

    expect(loads).toBe(1)
  })
})
