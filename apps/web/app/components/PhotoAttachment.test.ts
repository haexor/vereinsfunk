import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'PhotoAttachment.vue'), 'utf8')

describe('PhotoAttachment', () => {
  it('reloads consents whenever the consent picker opens', () => {
    expect(component).toContain('@update:open="(open: boolean) => { if (open) void loadConsents() }"')
  })

  it('takes the upload result from the shared upload flow instead of re-reading media_assets', () => {
    expect(component).toContain('uploadMediaAsset(api')
    expect(component).not.toContain(".from('media_assets')")
  })
})
