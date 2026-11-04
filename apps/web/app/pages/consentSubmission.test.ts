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
    `(async () => { ${compiled.outputText}; return { registerForm, requestForm, registerConsent, sendConsentRequest, registerError, requestError }; })()`,
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
    registerForm: { directoryPersonId: string; purposes: string[] }
    requestForm: { directoryPersonId: string; purposes: string[] }
    registerConsent: () => Promise<void>
    sendConsentRequest: () => Promise<void>
    registerError: Ref<string>
    requestError: Ref<string>
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
})
