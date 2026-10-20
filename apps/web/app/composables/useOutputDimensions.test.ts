import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOutputDimensions } from './useOutputDimensions'

describe('useOutputDimensions', () => {
  const crop = { width: 1200, height: 800 }
  const error = ref('')

  beforeEach(() => {
    error.value = ''
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a locked output size proportional to a later crop change', () => {
    const output = useOutputDimensions({ cropDimensions: () => crop, error })
    output.updateOutputWidth('600')
    expect([output.outputWidth.value, output.outputHeight.value]).toEqual([600, 400])

    output.followCrop(1000, 1000)

    expect([output.outputWidth.value, output.outputHeight.value]).toEqual([600, 600])
  })

  it('falls back to the crop size when following the crop would exceed the limits', () => {
    const output = useOutputDimensions({ cropDimensions: () => crop, error })
    output.updateOutputWidth('6000')
    expect(output.outputHeight.value).toBe(4000)

    output.followCrop(1000, 2000)

    expect([output.outputWidth.value, output.outputHeight.value]).toEqual([0, 0])
    expect(output.outputDimensionsLabel.value).toBe('1200 × 800 px')
  })

  it('leaves an unlocked output size alone and reports invalid input', () => {
    const output = useOutputDimensions({ cropDimensions: () => crop, error })
    output.keepAspectRatio.value = false
    output.setOutputDimensions({ width: 300, height: 300 })

    output.followCrop(1000, 2000)
    output.updateOutputHeight('abc')

    expect([output.outputWidth.value, output.outputHeight.value]).toEqual([300, 300])
    expect(error.value).toBe('Die Höhe muss eine positive Zahl sein.')
  })
})
