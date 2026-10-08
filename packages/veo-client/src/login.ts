import { VeoError } from './errors.js'

// Paket 053, PR 1 (aus playerboard app/server/utils/veo/login.ts): Veo hat keine Login-API. Die
// Anmeldung laeuft deshalb einmalig in einem echten, unsichtbaren Browser ueber Veos eigene
// Login-Seite; uebrig bleibt nur das auth.veo.co-Session-Cookie. Das Passwort existiert nur als
// Argument und im Browserprozess -- nie im Log, nie gespeichert.
//
// Den Browser reicht der Aufrufer herein (Playwright im Worker oder in der API). So haengt dieses
// Paket nicht an Playwright, und Tests laufen mit einem Fake.

const LOGIN_URL = 'https://app.veo.co/accounts/login/'
const LOGIN_TIMEOUT_MS = 30_000

// Der Ausschnitt der Playwright-API, den die Anmeldung braucht.
export interface LoginLocator {
  first(): LoginLocator
  waitFor(options: { state: 'visible'; timeout: number }): Promise<void>
  fill(value: string): Promise<void>
  press(key: string): Promise<void>
  click(options: { timeout: number }): Promise<void>
}
export interface LoginPage {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>
  locator(selector: string): LoginLocator
  getByRole(role: 'button', options: { name: RegExp }): LoginLocator
  waitForURL(predicate: (url: URL) => boolean, options: { timeout: number }): Promise<void>
  url(): string
}
export interface LoginBrowserContext {
  newPage(): Promise<LoginPage>
  cookies(url: string): Promise<readonly { name: string; value: string }[]>
}
export interface LoginBrowser {
  newContext(): Promise<LoginBrowserContext>
  close(): Promise<void>
}

/** Meldet sich mit E-Mail und Passwort bei Veo an und liefert das Session-Cookie (`name=value; ...`). */
export async function captureSessionViaLogin(email: string, password: string, launchBrowser: () => Promise<LoginBrowser>): Promise<string> {
  const browser = await launchBrowser()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT_MS })

    // Cookie-Hinweis wegklicken, falls vorhanden -- darf die Anmeldung nie blockieren.
    await page.getByRole('button', { name: /akzeptieren|accept|zustimmen/i }).click({ timeout: 3_000 }).catch(() => undefined)

    // Felder ueber den Typ statt ueber sichtbare Beschriftungen: Veos Formulartexte sind nicht
    // dokumentiert und koennen sich aendern.
    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
    const passwordInput = page.locator('input[type="password"]').first()
    try {
      await emailInput.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS })
    } catch {
      throw new VeoError('upstream_changed', 'Veo login form not found')
    }
    await emailInput.fill(email)
    await passwordInput.fill(password)
    await Promise.all([
      page.waitForURL((url) => url.hostname === 'app.veo.co' && !url.pathname.startsWith('/accounts/login'), { timeout: LOGIN_TIMEOUT_MS }).catch(() => undefined),
      passwordInput.press('Enter'),
    ])

    const landed = new URL(page.url())
    if (landed.hostname !== 'app.veo.co' || landed.pathname.startsWith('/accounts/login')) {
      throw new VeoError('login_failed', 'Veo login failed (still on the login page)')
    }
    const cookies = await context.cookies('https://auth.veo.co')
    if (cookies.length === 0) throw new VeoError('login_failed', 'Veo login set no auth.veo.co session cookie')
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  } finally {
    await browser.close()
  }
}
