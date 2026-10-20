import { ImageStyleFilterSchema } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { IMAGE_STYLE_FILTER_OPTIONS } from './imageStyleFilterCatalog'

describe('image style filter catalog', () => {
  it('covers every filter accepted by the image-style contract exactly once', () => {
    expect(IMAGE_STYLE_FILTER_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...ImageStyleFilterSchema.options].sort(),
    )
  })
})
