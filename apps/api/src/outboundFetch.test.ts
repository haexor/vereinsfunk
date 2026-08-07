import { describe, expect, it } from 'vitest'
import { fetchPublicUrl, isAllowedOutboundUrl, isBlockedAddress, OutboundFetchError } from './outboundFetch.js'

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
})
