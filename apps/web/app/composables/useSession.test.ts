import { AuthSessionMissingError } from '@supabase/supabase-js'
import { ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from './useSession'

describe('useSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats a missing or terminated auth session as logged out instead of failing', async () => {
    const states = new Map<string, Ref<unknown>>()
    vi.stubGlobal('useState', <T>(key: string, init: () => T) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key) as Ref<T>
    })
    vi.stubGlobal('useSupabaseClient', () => ({
      auth: { getUser: async () => ({ data: { user: null }, error: new AuthSessionMissingError() }) },
    }))

    const session = await useSession()

    expect(session.value).toBeNull()
  })

  it('still fails loudly on other auth errors', async () => {
    const states = new Map<string, Ref<unknown>>()
    vi.stubGlobal('useState', <T>(key: string, init: () => T) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key) as Ref<T>
    })
    vi.stubGlobal('useSupabaseClient', () => ({
      auth: { getUser: async () => ({ data: { user: null }, error: new Error('network down') }) },
    }))

    await expect(useSession()).rejects.toThrow('network down')
  })
})
