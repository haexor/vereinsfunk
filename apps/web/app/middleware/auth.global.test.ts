import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SESSION = { isPlatformAdmin: false, scopes: [{ organizationId: 'verein-1' }] }
const TARGET = { path: '/kanaele', fullPath: '/kanaele' }

describe('auth middleware on the client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('lets a persisted session through although the server-side hint cookie is missing', async () => {
    const navigateTo = vi.fn((target: unknown) => target)
    vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: unknown) => middleware)
    vi.stubGlobal('useCookie', () => ref(null))
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('useSession', async () => ref(SESSION))
    const { default: middleware } = await import('./auth.global')

    await middleware(TARGET as never, TARGET as never)

    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('sends a visitor without a session to the login page', async () => {
    const navigateTo = vi.fn((target: unknown) => target)
    vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: unknown) => middleware)
    vi.stubGlobal('useCookie', () => ref(true))
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('useSession', async () => ref(null))
    const { default: middleware } = await import('./auth.global')

    await middleware(TARGET as never, TARGET as never)

    expect(navigateTo).toHaveBeenCalledWith({ path: '/anmelden', query: { redirect: '/kanaele' } })
  })
})
