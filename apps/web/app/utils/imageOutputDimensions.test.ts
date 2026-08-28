import { describe, expect, it } from 'vitest'
import { MAX_OUTPUT_DIMENSION, outputSizeError, readOutputDimension } from './imageOutputDimensions'

describe('image output dimensions', () => {
  it('accepts safe dimensions', () => {
    expect(outputSizeError({ width: 6000, height: 5000 })).toBe('')
  })

  it('rejects a dimension above the supported canvas edge', () => {
    expect(outputSizeError({ width: MAX_OUTPUT_DIMENSION + 1, height: 1 })).toContain('8192 px')
  })

  it('rejects dimensions exceeding the pixel limit even when both edges are valid', () => {
    expect(outputSizeError({ width: 8000, height: 8000 })).toContain('32 Megapixel')
  })

  it('only parses positive, safe integer dimensions', () => {
    expect(readOutputDimension('1200.4')).toBe(1200)
    expect(readOutputDimension('0')).toBeUndefined()
    expect(readOutputDimension('Infinity')).toBeUndefined()
  })
})
