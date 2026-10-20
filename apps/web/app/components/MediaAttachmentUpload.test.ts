import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'MediaAttachmentUpload.vue'), 'utf8')

describe('MediaAttachmentUpload', () => {
  it('uploads through the reactive attachment so later state changes reach the list', () => {
    expect(component).toContain("const attachment = reactive<PendingAttachment & { file: File }>(")
  })

  it('shows a failed video review confirmation next to the review button', () => {
    const reviewBranch = component.match(/v-else-if="attachment.state === 'review'">[\s\S]*?<\/template>/)?.[0]
    expect(reviewBranch).toContain('{{ attachment.error }}')
  })

  it('only treats an empty model as an external reset while finished attachments exist', () => {
    expect(component).toContain("if (ids.length === 0 && attachments.value.some((attachment) => attachment.state === 'ready' && attachment.assetId !== null)) attachments.value = []")
  })
})
