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

  describe('on the public team page', () => {
    /** Laedt die Middleware mit Fakes; liefert den Aufruf und was er bewirkt hat. */
    async function visit(path: string, session: unknown) {
      const navigateTo = vi.fn((target: unknown) => target)
      const createError = vi.fn((input: unknown) => Object.assign(new Error('page error'), input))
      vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: unknown) => middleware)
      vi.stubGlobal('useCookie', () => ref(true))
      vi.stubGlobal('navigateTo', navigateTo)
      vi.stubGlobal('createError', createError)
      vi.stubGlobal('useSession', async () => ref(session))
      const { default: middleware } = await import('./auth.global')
      const target = { path, fullPath: path }
      const result = await Promise.resolve(middleware(target as never, target as never)).then(() => 'passed' as const, (error: unknown) => error)
      return { result, navigateTo, createError }
    }

    it('lets the three-segment address through without a session', async () => {
      const { result, navigateTo } = await visit('/mannschaft/sv-nordstadt/handball/u13', null)

      expect(result).toBe('passed')
      expect(navigateTo).not.toHaveBeenCalled()
    })

    it.each([
      ['anonymous', null],
      ['signed-in', SESSION],
    ])('answers the earlier two-segment address with a 404 for a %s visitor, without any redirect', async (_name, session) => {
      const { result, navigateTo, createError } = await visit('/mannschaft/sv-nordstadt/u13', session)

      expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }))
      expect(result).toMatchObject({ statusCode: 404 })
      expect(navigateTo).not.toHaveBeenCalled()
    })

    it.each([
      '/mannschaft',
      '/mannschaft/sv-nordstadt',
      '/mannschaft/sv-nordstadt/handball/u13/fotos',
      '/mannschaft/sv-nordstadt/Handball/u13',
      '/mannschaft/sv-nordstadt/handball/u13/',
    ])('keeps %s behind the sign-in for an anonymous visitor', async (path) => {
      const { navigateTo } = await visit(path, null)

      expect(navigateTo).toHaveBeenCalledWith({ path: '/anmelden', query: { redirect: path } })
    })
  })
})
