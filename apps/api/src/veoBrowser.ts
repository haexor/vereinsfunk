import type { LoginBrowser } from '@vereinsfunk/veo-client'

/**
 * Paket 053: unsichtbares Chromium fuer die einmalige Veo-Anmeldung (wie playerboard). Playwright
 * wird erst beim ersten Login geladen, damit Start und Tests der API es nie brauchen.
 */
export async function launchVeoLoginBrowser(): Promise<LoginBrowser> {
  const { chromium } = await import('playwright')
  return chromium.launch({ headless: true })
}
