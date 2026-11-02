import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  buildConsentRequestEmail,
  consentTextForVersion,
  currentOrganizationConsentText,
  DEFAULT_CONSENT_TEXT_TEMPLATE,
  DEFAULT_CONSENT_TEXT_VERSION,
} from './consent.js'

describe('default consent text versions', () => {
  it('uses a purpose-aware version for new requests while preserving the original text', async () => {
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    }))
    const client = { from } as unknown as SupabaseClient
    expect(await currentOrganizationConsentText(client, 'organization')).toEqual({
      id: null,
      body: DEFAULT_CONSENT_TEXT_TEMPLATE,
      createdAt: null,
    })
    from.mockClear()
    expect(DEFAULT_CONSENT_TEXT_VERSION).toBe('default-template-v2')
    expect(await consentTextForVersion(client, 'organization', DEFAULT_CONSENT_TEXT_VERSION)).toBe(
      DEFAULT_CONSENT_TEXT_TEMPLATE,
    )
    expect(DEFAULT_CONSENT_TEXT_TEMPLATE).toContain('ausdrücklich ausgewählten Zwecke')
    for (const purpose of ['Social Media', 'Vereinswebsite', 'Printmaterial', 'interne Nutzung']) {
      expect(DEFAULT_CONSENT_TEXT_TEMPLATE).toContain(purpose)
    }
    expect(await consentTextForVersion(client, 'organization', 'default-template'))
      .toBe(`Einwilligung zur Veröffentlichung von Fotos und Videos in sozialen Medien

Der Verein möchte über sein Vereinsleben berichten und dafür auch Fotos und Videos auf seinen Social-Media-Kanälen veröffentlichen. Mit dieser Einwilligung bestätigen Sie, dass Fotos und Videos im hier beschriebenen Umfang veröffentlicht werden dürfen.

Diese Einwilligung ist freiwillig. Sie können sie jederzeit ohne Angabe von Gründen für die Zukunft widerrufen; das beeinträchtigt nicht die Rechtmäßigkeit der bis zum Widerruf erfolgten Veröffentlichungen.`)
    expect(from).not.toHaveBeenCalled()
  })

  it('describes the requested scope in the linked page instead of assuming social media in the email', () => {
    const email = buildConsentRequestEmail({
      to: 'parent@example.test',
      organizationName: 'Verein',
      personLabel: 'Mia K.',
      respondUrl: 'https://example.test/einwilligung/token',
    })
    expect(email.text).toContain(
      'Die angefragten Zwecke und der genaue Umfang stehen auf der verlinkten Seite.',
    )
    expect(email.text).not.toContain('in sozialen Medien')
  })
})
