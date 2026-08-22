import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { scoreLogoCandidates } from './websiteRenderer.js'

// Reine DOM-Heuristik -- kein jsdom im Repo vorhanden (bewusst: page.evaluate(scoreLogoCandidates)
// laeuft im echten Browser-Kontext gegen echte Vereinsseiten, ein String-/jsdom-Parser wuerde
// abweichendes Verhalten (getComputedStyle, closest(), :scope) nicht zuverlaessig nachbilden).
const FIXTURE_ORIGIN = 'https://verein.example.test'

let browser: Browser
let page: Page | undefined

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 30_000)

afterAll(async () => {
  await browser.close()
})

afterEach(async () => {
  await page?.close()
  page = undefined
})

async function scoreFixture(html: string) {
  page = await browser.newPage()
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) => route.fulfill({ body: html, contentType: 'text/html' }))
  await page.goto(`${FIXTURE_ORIGIN}/`)
  return page.evaluate(scoreLogoCandidates)
}

describe('scoreLogoCandidates', () => {
  it('findet ein Logo mit eigener Klasse ausserhalb von header/nav (Bug A: tsv-ifa-chemnitz.de)', async () => {
    const candidates = await scoreFixture(`
      <html><body>
        <div class="content">
          <img class="site-logo logo-ifa" src="/assets/logo-ifa.png" alt="TSV Verein">
        </div>
      </body></html>
    `)
    expect(candidates[0]?.url).toBe(`${FIXTURE_ORIGIN}/assets/logo-ifa.png`)
  })

  it('schliesst eine Sponsorenzeile im Header komplett aus, das echte Vereinslogo bleibt Kandidat (Bug B)', async () => {
    const candidates = await scoreFixture(`
      <html><body>
        <header>
          <img class="club-logo" src="/club-logo.png" alt="Vereinslogo">
          <div class="sponsors">
            <img src="/sponsor-1.png" alt="Sponsor 1">
            <img src="/sponsor-2.png" alt="Sponsor 2">
            <img src="/sponsor-3.png" alt="Sponsor 3">
          </div>
        </header>
      </body></html>
    `)
    const clubLogo = candidates.find((candidate) => candidate.url.endsWith('/club-logo.png'))
    const sponsor = candidates.find((candidate) => candidate.url.endsWith('/sponsor-1.png'))
    expect(clubLogo).toBeDefined()
    expect(sponsor).toBeUndefined()
    expect(candidates[0]?.url).toBe(clubLogo?.url)
  })

  it('dedupliziert dasselbe Bild ueber eine absolute img-src und ein relatives og:image', async () => {
    const candidates = await scoreFixture(`
      <html>
      <head><meta property="og:image" content="/shared-logo.png"></head>
      <body>
        <header><img class="logo" src="/shared-logo.png" alt="Logo"></header>
      </body>
      </html>
    `)
    const matches = candidates.filter((candidate) => candidate.url === `${FIXTURE_ORIGIN}/shared-logo.png`)
    expect(matches).toHaveLength(1)
    // Der echte DOM-Treffer gewinnt, nicht der Fallback-Sentinel-Score.
    expect(matches[0]!.score).toBeGreaterThan(0)
  })

  it('bevorzugt ein logo-klassiges Bild mit Home-Link gegenueber demselben ohne Home-Link', async () => {
    const candidates = await scoreFixture(`
      <html><body>
        <div class="content">
          <a href="/"><img class="brand-logo" src="/home-logo.png" alt="Logo"></a>
          <img class="brand-logo" src="/other-logo.png" alt="Logo">
        </div>
      </body></html>
    `)
    const withHomeLink = candidates.find((candidate) => candidate.url.endsWith('/home-logo.png'))
    const withoutHomeLink = candidates.find((candidate) => candidate.url.endsWith('/other-logo.png'))
    expect(withHomeLink!.score).toBeGreaterThan(withoutHomeLink!.score)
    expect(candidates[0]?.url).toBe(withHomeLink?.url)
  })

  it('faellt auf og:image und Favicon zurueck, wenn kein DOM-Kandidat existiert, in dieser Reihenfolge', async () => {
    const candidates = await scoreFixture(`
      <html>
      <head>
        <meta property="og:image" content="https://cdn.example.test/preview.png">
        <link rel="icon" href="/favicon.ico">
      </head>
      <body><p>Keine Bilder hier.</p></body>
      </html>
    `)
    expect(candidates).toEqual([
      { url: 'https://cdn.example.test/preview.png', score: -100 },
      { url: `${FIXTURE_ORIGIN}/favicon.ico`, score: -101 },
    ])
  })

  it('schliesst ein Social-Icon im Header komplett aus (Sponsor-Keyword-Ausschluss)', async () => {
    const candidates = await scoreFixture(`
      <html><body>
        <header>
          <img class="site-logo" src="/logo.png" alt="Vereinslogo">
          <a href="https://facebook.com/verein"><img class="facebook-icon" src="/facebook.png" alt="Facebook"></a>
        </header>
      </body></html>
    `)
    const logo = candidates.find((candidate) => candidate.url.endsWith('/logo.png'))
    const facebookIcon = candidates.find((candidate) => candidate.url.endsWith('/facebook.png'))
    expect(candidates[0]?.url).toBe(logo?.url)
    expect(facebookIcon).toBeUndefined()
  })

  it('liefert keinen Kandidaten fuer ein Social-Icon, wenn kein Vereinslogo auf der Seite existiert', async () => {
    const candidates = await scoreFixture(`
      <html><body>
        <header>
          <a href="https://facebook.com/verein"><img class="facebook-icon" src="/facebook.png" alt="Facebook"></a>
        </header>
      </body></html>
    `)
    expect(candidates.find((candidate) => candidate.url.endsWith('/facebook.png'))).toBeUndefined()
  })

  it('schliesst ein generisch benanntes Icon aus, das zu einem Social-Profil verlinkt', async () => {
    const candidates = await scoreFixture(`
      <html><body>
        <header>
          <img class="site-logo" src="/logo.png" alt="Vereinslogo">
          <a href="https://www.instagram.com/verein"><img class="icon" src="/icon-1.png" alt="Icon"></a>
        </header>
      </body></html>
    `)
    const logo = candidates.find((candidate) => candidate.url.endsWith('/logo.png'))
    const icon = candidates.find((candidate) => candidate.url.endsWith('/icon-1.png'))
    expect(candidates[0]?.url).toBe(logo?.url)
    expect(icon).toBeUndefined()
  })
})
