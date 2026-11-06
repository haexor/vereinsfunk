import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as contracts from '@vereinsfunk/contracts'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { computed, reactive, ref, watch, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../utils/apiClient'
import * as consentPurposes from '../utils/consentPurposes'

// Execute the page's actual handlers with Vue state; only Nuxt services and HTTP are replaced.
// No browser/mount harness is configured in this package.
async function consentPage() {
  const source = readFileSync(new URL('./einwilligungen.vue', import.meta.url), 'utf8')
    .split('<script setup lang="ts">')[1]!
    .split('</script>')[0]!
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  })
  const request = vi.fn(async () => ({ id: 'created' }))
  const page = (await runInNewContext(
    `(async () => { ${compiled.outputText}; return { registerForm, requestForm, registerConsent, sendConsentRequest, registerError, requestError, registerNotice, requestNotice, consents, requests }; })()`,
    {
      exports: {},
      FormData,
      ref,
      reactive,
      computed,
      watch,
      require: (name: string) => {
        if (name === '@vereinsfunk/contracts') return contracts
        if (name === '../utils/apiClient') return { ApiRequestError }
        if (name === '../utils/consentPurposes') return consentPurposes
        throw new Error(`Unexpected page dependency: ${name}`)
      },
      useApiClient: () => ({ request }),
      useActiveScope: async () => ({
        organizationId: ref('org-1'),
        organization: ref({ departments: [] }),
      }),
      useCan: () => true,
      useScopedLoad: () => ({ ready: Promise.resolve() }),
    },
  )) as {
    registerForm: { directoryPersonId: string; purposes: string[]; mediaKinds: string[]; namingAllowed: boolean; signedAt: string; signerName: string; signerRole: string }
    requestForm: { directoryPersonId: string; purposes: string[]; recipientEmail: string; recipientRole: string }
    registerConsent: () => Promise<void>
    sendConsentRequest: () => Promise<void>
    registerError: Ref<string>
    requestError: Ref<string>
    registerNotice: Ref<string>
    requestNotice: Ref<string>
    consents: Ref<contracts.ConsentRecord[]>
    requests: Ref<contracts.ConsentRequest[]>
  }
  return { page, request }
}

describe('consent purpose submissions', () => {
  it.each(['paper', 'digital'])('sends selected purposes for %s consent', async (kind) => {
    const { page, request } = await consentPage()
    const form = kind === 'paper' ? page.registerForm : page.requestForm
    // Papier: Website vorausgewaehlt, damit Trainingsfotos ohne Zusatzklick freigegeben werden koennen.
    expect(form.purposes).toEqual(kind === 'paper' ? ['social_media', 'website'] : ['social_media'])
    form.directoryPersonId = 'person-1'
    form.purposes = ['website', 'internal']
    await (kind === 'paper' ? page.registerConsent() : page.sendConsentRequest())
    expect(request).toHaveBeenCalledOnce()
    const [path, options] = request.mock.calls[0]! as unknown as [
      string,
      { body: FormData | { requestedScope: { purposes: string[] } } },
    ]
    expect(path).toBe(kind === 'paper' ? '/v1/consents' : '/v1/consent-requests')
    const scope =
      options.body instanceof FormData
        ? JSON.parse(String(options.body.get('scopeStructured')))
        : options.body.requestedScope
    expect(scope.purposes).toEqual(['website', 'internal'])
  })

  it.each(['paper', 'digital'])('blocks %s consent without a purpose', async (kind) => {
    const { page, request } = await consentPage()
    const form = kind === 'paper' ? page.registerForm : page.requestForm
    form.directoryPersonId = 'person-1'
    form.purposes = []
    await (kind === 'paper' ? page.registerConsent() : page.sendConsentRequest())
    expect(request).not.toHaveBeenCalled()
    expect((kind === 'paper' ? page.registerError : page.requestError).value).toBe(
      'Bitte mindestens einen Zweck wählen.',
    )
  })

  it('explains and blocks a paper consent without a media kind', async () => {
    const { page, request } = await consentPage()
    page.registerForm.directoryPersonId = 'person-1'
    page.registerForm.mediaKinds = []

    await page.registerConsent()

    expect(request).not.toHaveBeenCalled()
    expect(page.registerError.value).toBe('Bitte mindestens eine Medienart auswählen.')
  })
})

function storedConsent(overrides: Partial<contracts.ConsentRecord>): contracts.ConsentRecord {
  return {
    id: 'consent-1', organizationId: 'org-1', directoryPersonId: 'person-1', pseudonymousSubjectRef: null,
    scope: 'Zweck: Social Media', origin: 'paper', sourceId: null, signedAt: '2026-09-01', signerName: 'Eva Muster',
    signerRole: 'self', guardianConfirmed: false, validFrom: '2026-09-01T00:00:00+02:00', validUntil: null,
    revokedAt: null, revokedBy: null, revocationReason: null, supersededBy: null, status: 'valid',
    createdAt: '2026-09-01T10:00:00+02:00',
    scopeStructured: { purposes: ['social_media'], platforms: null, mediaKinds: ['photo', 'video'], contexts: ['training'], namingAllowed: true, departmentIds: null },
    ...overrides,
  }
}

describe('Vorbelegung nach Auswahl einer Person', () => {
  it('fuellt das Papierformular mit der gespeicherten Erklaerung und loest sie beim Speichern ab', async () => {
    const { page, request } = await consentPage()
    page.consents.value = [storedConsent({ id: 'old', createdAt: '2026-01-01T10:00:00+01:00', supersededBy: 'consent-1', status: 'superseded' }), storedConsent({})]

    page.registerForm.directoryPersonId = 'person-1'
    expect(page.registerForm).toMatchObject({ purposes: ['social_media'], mediaKinds: ['photo', 'video'], namingAllowed: true, signedAt: '2026-09-01', signerName: 'Eva Muster', signerRole: 'self' })

    page.registerForm.purposes = ['social_media', 'website']
    await page.registerConsent()
    const [path, options] = request.mock.calls[0]! as unknown as [string, { body: { scopeStructured: { purposes: string[]; contexts: string[] | null } } }]
    expect(path).toBe('/v1/consents/consent-1/supersede')
    expect(options.body.scopeStructured.purposes).toEqual(['social_media', 'website'])
    // Was das Formular nicht anbietet, bleibt wie in der bisherigen Version.
    expect(options.body.scopeStructured.contexts).toEqual(['training'])
    expect(page.consents.value[0]).toEqual({ id: 'created' })
    expect(page.consents.value.find((consent) => consent.id === 'consent-1')).toMatchObject({
      supersededBy: 'created',
      status: 'superseded',
    })
  })

  it('laesst die Person nach dem Speichern ausgewaehlt und zeigt den gespeicherten Stand', async () => {
    const { page, request } = await consentPage()
    page.consents.value = [storedConsent({})]
    const successor = storedConsent({ id: 'consent-2', createdAt: '2026-11-05T10:00:00+01:00', scopeStructured: { ...storedConsent({}).scopeStructured, purposes: ['social_media', 'website'] } })
    request.mockImplementationOnce(async () => successor as unknown as { id: string })

    page.registerForm.directoryPersonId = 'person-1'
    page.registerForm.purposes = ['social_media', 'website']
    await page.registerConsent()

    // Vorher sprang die Auswahl nach dem Speichern zurueck auf "Auswählen".
    expect(page.registerForm.directoryPersonId).toBe('person-1')
    expect(page.registerForm.purposes).toEqual(['social_media', 'website'])
  })

  it.each(['paper', 'digital'])('überschreibt beim verspäteten %s-Abschluss nicht das Formular der inzwischen gewählten Person', async (kind) => {
    const { page, request } = await consentPage()
    let resolveRequest!: (value: { id: string }) => void
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const form = kind === 'paper' ? page.registerForm : page.requestForm
    form.directoryPersonId = 'person-1'
    const pending = kind === 'paper' ? page.registerConsent() : page.sendConsentRequest()

    form.directoryPersonId = 'person-2'
    form.purposes = ['internal']
    resolveRequest({ id: 'created' })
    await pending

    expect(form.directoryPersonId).toBe('person-2')
    expect(form.purposes).toEqual(['internal'])
  })

  it.each(['paper', 'digital'])('clears the previous %s success notice when a new submission starts', async (kind) => {
    const { page, request } = await consentPage()
    let resolveRequest!: (value: { id: string }) => void
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const notice = kind === 'paper' ? page.registerNotice : page.requestNotice
    const form = kind === 'paper' ? page.registerForm : page.requestForm
    notice.value = 'Vorheriger Erfolg'
    form.directoryPersonId = 'person-1'
    const pending = kind === 'paper' ? page.registerConsent() : page.sendConsentRequest()

    expect(notice.value).toBe('')
    resolveRequest({ id: 'created' })
    await pending
  })

  it.each(['paper', 'digital'])('nennt beim %s-Formular eine fehlende Berechtigung als Grund', async (kind) => {
    const { page, request } = await consentPage()
    request.mockRejectedValueOnce(new ApiRequestError('forbidden', 403))
    const form = kind === 'paper' ? page.registerForm : page.requestForm
    form.directoryPersonId = 'person-1'
    await (kind === 'paper' ? page.registerConsent() : page.sendConsentRequest())
    // Vorher meldete die Seite einem Trainer ohne consent.manage nur "konnte nicht gespeichert werden".
    expect((kind === 'paper' ? page.registerError : page.requestError).value).toBe(
      'Dafür fehlt dir die Berechtigung. Einwilligungen pflegt die Vereins- oder Abteilungsleitung.',
    )
  })

  it('legt neben einer digital erteilten Einwilligung eine neue Papiererklaerung an', async () => {
    const { page, request } = await consentPage()
    page.consents.value = [storedConsent({ origin: 'digital' })]

    page.registerForm.directoryPersonId = 'person-1'
    expect(page.registerForm.mediaKinds).toEqual(['photo', 'video'])
    await page.registerConsent()
    expect((request.mock.calls[0]! as unknown as [string])[0]).toBe('/v1/consents')
  })

  it('setzt nach einem Widerruf und ohne gespeicherte Einwilligung die Vorgaben', async () => {
    const { page } = await consentPage()
    page.consents.value = [storedConsent({ revokedAt: '2026-10-01T10:00:00+02:00', status: 'revoked' })]

    page.registerForm.directoryPersonId = 'person-1'
    expect(page.registerForm).toMatchObject({ purposes: ['social_media', 'website'], mediaKinds: ['photo'], namingAllowed: false, signedAt: '', signerName: '', signerRole: 'guardian' })
  })

  it('uebernimmt Adresse und Umfang einer offenen digitalen Anfrage', async () => {
    const { page } = await consentPage()
    page.requests.value = [{
      id: 'request-1', organizationId: 'org-1', departmentId: 'dep-1', directoryPersonId: 'person-1',
      recipientEmail: 'eltern@example.org', recipientRole: 'guardian', textVersion: 'v1', status: 'sent',
      expiresAt: '2026-12-01T00:00:00+01:00', createdAt: '2026-11-01T10:00:00+01:00',
      requestedScope: { purposes: ['website'], platforms: null, mediaKinds: ['photo'], contexts: null, namingAllowed: false, departmentIds: null },
    } as contracts.ConsentRequest]

    page.requestForm.directoryPersonId = 'person-1'
    expect(page.requestForm).toMatchObject({ purposes: ['website'], recipientEmail: 'eltern@example.org', recipientRole: 'guardian' })
  })
})
