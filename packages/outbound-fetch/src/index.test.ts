import { describe, expect, it } from 'vitest'
import { createGuardedFetch, fetchPublicBinary, fetchPublicUrl, isAllowedOutboundUrl, isBlockedAddress, OutboundFetchError } from './index.js'

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init })
}

describe('isAllowedOutboundUrl', () => {
  it('accepts a public https url', () => {
    expect(isAllowedOutboundUrl('https://example.com/feed.ics')).toBe(true)
  })

  it.each([
    ['http://example.com/feed.ics', 'http gaebe den Feed im Klartext preis'],
    ['ftp://example.com/feed.ics', 'kein anderes Protokoll hat als Quelle einen Zweck'],
    ['https://localhost/feed.ics', 'Loopback ueber den Namen'],
    ['https://api.localhost/feed.ics', 'Loopback ueber eine Unterdomaene'],
    ['https://printer.local/feed.ics', 'mDNS-Namen zeigen nie ins oeffentliche Netz'],
    ['https://vault.internal/feed.ics', 'interne Suffixe ebensowenig'],
    ['https://127.0.0.1/feed.ics', 'Loopback als Literal'],
    ['https://169.254.169.254/latest/meta-data/', 'Cloud-Metadatendienst'],
    ['https://10.0.0.5/feed.ics', 'privates Netz (RFC 1918)'],
    ['https://172.16.4.1/feed.ics', 'privates Netz (RFC 1918)'],
    ['https://192.168.1.1/feed.ics', 'privates Netz (RFC 1918)'],
    ['https://[::1]/feed.ics', 'IPv6-Loopback'],
    ['https://[fd00::1]/feed.ics', 'IPv6 Unique Local'],
    ['nonsense', 'keine gueltige Adresse'],
  ])('rejects %s (%s)', (url) => {
    expect(isAllowedOutboundUrl(url)).toBe(false)
  })

  it('rejects an IPv4 address written as IPv6 -- sonst umgeht sie die IPv4-Pruefung', () => {
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
  })
})

// Namensaufloesung im Test fest verdrahtet -- sonst haengen diese Tests am echten DNS.
const publicLookup = async () => ['93.184.216.34']

describe('fetchPublicUrl', () => {
  it('returns the body of an allowed target', async () => {
    const text = await fetchPublicUrl('https://example.com/feed.ics', {
      lookupImpl: publicLookup,
      fetchImpl: async () => response('BEGIN:VCALENDAR\nEND:VCALENDAR'),
    })
    expect(text).toContain('BEGIN:VCALENDAR')
  })

  it('refuses a blocked target before any request goes out', async () => {
    let called = false
    await expect(
      fetchPublicUrl('https://169.254.169.254/latest/meta-data/', {
        fetchImpl: async () => {
          called = true
          return response('secrets')
        },
      }),
    ).rejects.toMatchObject({ reason: 'blocked_url' })
    expect(called).toBe(false)
  })

  it('refuses a public-looking name that resolves into the internal network', async () => {
    // Der eigentliche Grund fuer die Namensaufloesung: die Literal-Pruefung allein waere mit einem
    // A-Record auf 127.0.0.1 in einer Zeile umgangen.
    await expect(
      fetchPublicUrl('https://feed.example.com/feed.ics', {
        lookupImpl: async () => ['127.0.0.1'],
        fetchImpl: async () => response('secrets'),
      }),
    ).rejects.toMatchObject({ reason: 'blocked_url' })
  })

  it('re-checks the target of a redirect -- sonst waere die erste Pruefung wertlos', async () => {
    const targets: string[] = []
    await expect(
      fetchPublicUrl('https://example.com/feed.ics', {
        lookupImpl: publicLookup,
        fetchImpl: async (input) => {
          targets.push(String(input))
          return response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
        },
      }),
    ).rejects.toMatchObject({ reason: 'blocked_url' })
    // Nur der erste, erlaubte Aufruf ging raus; das Weiterleitungsziel wurde nie abgerufen.
    expect(targets).toEqual(['https://example.com/feed.ics'])
  })

  it('follows an allowed redirect', async () => {
    const text = await fetchPublicUrl('https://example.com/feed.ics', {
      lookupImpl: publicLookup,
      fetchImpl: async (input) =>
        String(input) === 'https://example.com/feed.ics'
          ? response('', { status: 302, headers: { location: 'https://cdn.example.com/feed.ics' } })
          : response('BEGIN:VCALENDAR'),
    })
    expect(text).toBe('BEGIN:VCALENDAR')
  })

  it('gives up after too many redirects', async () => {
    await expect(
      fetchPublicUrl('https://example.com/feed.ics', {
        maxRedirects: 2,
        lookupImpl: publicLookup,
        fetchImpl: async () => response('', { status: 302, headers: { location: 'https://example.com/next.ics' } }),
      }),
    ).rejects.toBeInstanceOf(OutboundFetchError)
  })

  it('classifies an unparseable redirect location as OutboundFetchError instead of throwing a raw TypeError', async () => {
    await expect(
      fetchPublicUrl('https://example.com/feed.ics', {
        lookupImpl: publicLookup,
        fetchImpl: async () => response('', { status: 302, headers: { location: 'http://' } }),
      }),
    ).rejects.toMatchObject({ reason: 'request_failed' })
  })

  it('refuses a body larger than the limit, even when content-length lies', async () => {
    await expect(
      fetchPublicUrl('https://example.com/feed.ics', {
        maxBytes: 8,
        lookupImpl: publicLookup,
        fetchImpl: async () => response('weit mehr als acht Bytes'),
      }),
    ).rejects.toMatchObject({ reason: 'too_large' })
  })

  it('refuses a body whose declared content-length already exceeds the limit', async () => {
    await expect(
      fetchPublicUrl('https://example.com/feed.ics', {
        maxBytes: 8,
        lookupImpl: publicLookup,
        fetchImpl: async () => response('x', { headers: { 'content-length': '9000' } }),
      }),
    ).rejects.toMatchObject({ reason: 'too_large' })
  })

  it('sends the supplied headers', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    await fetchPublicUrl('https://example.com/v1/models', {
      headers: { authorization: 'Bearer secret-token' },
      lookupImpl: publicLookup,
      fetchImpl: async (_input, init) => {
        seen.push(init?.headers as Record<string, string> | undefined)
        return response('{}')
      },
    })
    expect(seen).toEqual([{ authorization: 'Bearer secret-token' }])
  })

  it('keeps the authorization header on a same-origin redirect', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    await fetchPublicUrl('https://example.com/v1/models', {
      headers: { authorization: 'Bearer secret-token' },
      lookupImpl: publicLookup,
      fetchImpl: async (input, init) => {
        seen.push(init?.headers as Record<string, string> | undefined)
        return String(input) === 'https://example.com/v1/models'
          ? response('', { status: 302, headers: { location: 'https://example.com/v2/models' } })
          : response('{}')
      },
    })
    expect(seen).toEqual([{ authorization: 'Bearer secret-token' }, { authorization: 'Bearer secret-token' }])
  })

  it('drops the authorization header on a cross-origin redirect -- sonst bekaeme die Gegenstelle einen fremden Schluessel', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    await fetchPublicUrl('https://example.com/v1/models', {
      headers: { authorization: 'Bearer secret-token', accept: 'application/json' },
      lookupImpl: publicLookup,
      fetchImpl: async (input, init) => {
        seen.push(init?.headers as Record<string, string> | undefined)
        return String(input) === 'https://example.com/v1/models'
          ? response('', { status: 302, headers: { location: 'https://elsewhere.example/v1/models' } })
          : response('{}')
      },
    })
    expect(seen[1]).toEqual({ accept: 'application/json' })
  })

  it('drops the x-api-key header on a cross-origin redirect -- derselbe Fall fuer den Anthropic-Adapter', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    await fetchPublicUrl('https://example.com/v1/models', {
      headers: { 'x-api-key': 'secret-key', accept: 'application/json' },
      lookupImpl: publicLookup,
      fetchImpl: async (input, init) => {
        seen.push(init?.headers as Record<string, string> | undefined)
        return String(input) === 'https://example.com/v1/models'
          ? response('', { status: 302, headers: { location: 'https://elsewhere.example/v1/models' } })
          : response('{}')
      },
    })
    expect(seen[1]).toEqual({ accept: 'application/json' })
  })
})

describe('fetchPublicBinary', () => {
  // Ein PNG-Kopf: die ersten acht Bytes sind kein gueltiges UTF-8, ein TextDecoder wuerde sie
  // durch U+FFFD ersetzen und damit jede Magic-Byte-Pruefung stromabwaerts scheitern lassen.
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

  it('returns the bytes unchanged instead of decoding them as text', async () => {
    const bytes = await fetchPublicBinary('https://example.org/logo.png', {
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(pngHeader, { status: 200 }),
    })
    expect(Buffer.compare(bytes, pngHeader)).toBe(0)
  })

  it('follows a redirect to the same file -- Vereinsseiten verweisen auf ihre Bilder oft ohne www', async () => {
    // Der Fall, an dem die KI-Markenerkennung fuer tsv-ifa-chemnitz.de scheiterte: das <img> im
    // Header zeigt auf die Adresse ohne www, der Server leitet von dort dauerhaft auf www um.
    const bytes = await fetchPublicBinary('https://verein.example.org/asset/logo.png', {
      lookupImpl: publicLookup,
      fetchImpl: async (input) =>
        String(input) === 'https://verein.example.org/asset/logo.png'
          ? new Response('', { status: 301, headers: { location: 'https://www.verein.example.org/asset/logo.png' } })
          : new Response(pngHeader, { status: 200 }),
    })
    expect(Buffer.compare(bytes, pngHeader)).toBe(0)
  })

  it('re-checks the target of a redirect just like the text variant', async () => {
    const targets: string[] = []
    await expect(
      fetchPublicBinary('https://verein.example.org/asset/logo.png', {
        lookupImpl: publicLookup,
        fetchImpl: async (input) => {
          targets.push(String(input))
          return new Response('', { status: 301, headers: { location: 'https://169.254.169.254/latest/meta-data/' } })
        },
      }),
    ).rejects.toMatchObject({ reason: 'blocked_url' })
    expect(targets).toEqual(['https://verein.example.org/asset/logo.png'])
  })

  it('bounds each hop with a deadline -- die Adresse stammt aus dem HTML einer fremden Seite', async () => {
    // Vorher lag die Zeitgrenze im Aufrufer (brandWebsiteAnalysis.ts); seit sie hier steckt, muss
    // sie hier auch abgesichert sein. Ohne sie haelt eine Gegenstelle, die die Verbindung offen
    // laesst, den ganzen Analyse-Job bis zum 10-Minuten-Timeout des Hatchet-Schritts auf.
    await expect(
      fetchPublicBinary('https://verein.example.org/asset/logo.png', {
        timeoutMs: 5,
        lookupImpl: publicLookup,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      }),
    ).rejects.toMatchObject({ reason: 'request_failed' })
  })

  it('releases the body of a redirect it does not read', async () => {
    let cancelled = false
    const redirectBody = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('<html>moved</html>')) },
      cancel() { cancelled = true },
    })
    await fetchPublicBinary('https://verein.example.org/asset/logo.png', {
      lookupImpl: publicLookup,
      fetchImpl: async (input) =>
        String(input) === 'https://verein.example.org/asset/logo.png'
          ? new Response(redirectBody, { status: 301, headers: { location: 'https://www.verein.example.org/asset/logo.png' } })
          : new Response(pngHeader, { status: 200 }),
    })
    expect(cancelled).toBe(true)
  })

  it('refuses a body larger than the limit, even when content-length lies', async () => {
    await expect(
      fetchPublicBinary('https://verein.example.org/asset/logo.png', {
        maxBytes: 4,
        lookupImpl: publicLookup,
        fetchImpl: async () => new Response(pngHeader, { status: 200 }),
      }),
    ).rejects.toMatchObject({ reason: 'too_large' })
  })

  it('reports an unusable candidate as a failure instead of returning an error page as image bytes', async () => {
    await expect(
      fetchPublicBinary('https://verein.example.org/asset/missing.png', {
        lookupImpl: publicLookup,
        fetchImpl: async () => new Response('<html>404</html>', { status: 404 }),
      }),
    ).rejects.toMatchObject({ reason: 'request_failed' })
  })
})

describe('createGuardedFetch', () => {
  it('returns the response unchanged for an allowed target', async () => {
    const fetcher = createGuardedFetch({
      lookupImpl: publicLookup,
      fetchImpl: async () => response('{"ok":true}'),
    })
    const result = await fetcher('https://provider.example/v1/messages', { method: 'POST' })
    expect(await result.json()).toEqual({ ok: true })
  })

  it('refuses a blocked target before any request goes out', async () => {
    let called = false
    const fetcher = createGuardedFetch({ fetchImpl: async () => { called = true; return response('secrets') } })
    await expect(fetcher('https://169.254.169.254/v1/messages', {})).rejects.toMatchObject({ reason: 'blocked_url' })
    expect(called).toBe(false)
  })

  it('refuses a public-looking name that resolves into the internal network', async () => {
    const fetcher = createGuardedFetch({
      lookupImpl: async () => ['127.0.0.1'],
      fetchImpl: async () => response('secrets'),
    })
    await expect(fetcher('https://provider.example/v1/messages', {})).rejects.toMatchObject({ reason: 'blocked_url' })
  })

  it('refuses a redirect instead of following it', async () => {
    const targets: string[] = []
    const fetcher = createGuardedFetch({
      lookupImpl: publicLookup,
      fetchImpl: async (input) => {
        targets.push(String(input))
        return response('', { status: 302, headers: { location: 'https://169.254.169.254/v1/messages' } })
      },
    })
    await expect(fetcher('https://provider.example/v1/messages', {})).rejects.toMatchObject({ reason: 'blocked_url' })
    // Only the original, allowed target was fetched; the redirect's location is never requested.
    expect(targets).toEqual(['https://provider.example/v1/messages'])
  })

  it('refuses a body whose declared content-length already exceeds the limit', async () => {
    const fetcher = createGuardedFetch({
      maxBytes: 8,
      lookupImpl: publicLookup,
      fetchImpl: async () => response('x', { headers: { 'content-length': '9000' } }),
    })
    await expect(fetcher('https://provider.example/v1/messages', {})).rejects.toMatchObject({ reason: 'too_large' })
  })

  it('refuses a body larger than the limit, even when content-length lies', async () => {
    const fetcher = createGuardedFetch({
      maxBytes: 8,
      lookupImpl: publicLookup,
      fetchImpl: async () => response('weit mehr als acht Bytes'),
    })
    const result = await fetcher('https://provider.example/v1/messages', {})
    await expect(result.text()).rejects.toMatchObject({ reason: 'too_large' })
  })
})
