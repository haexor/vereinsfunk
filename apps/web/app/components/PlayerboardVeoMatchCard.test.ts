import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'PlayerboardVeoMatchCard.vue'), 'utf8')

describe('PlayerboardVeoMatchCard', () => {
  it('resets the player select to the saved assignment when saving fails', () => {
    const failure = component.match(/} catch \(error\) {[\s\S]*?errorMessage\.value =/)?.[0]
    expect(failure).toContain("select.value = assignedPlayer.value.get(`${jerseyNumber}`) ?? ''")
  })
})
