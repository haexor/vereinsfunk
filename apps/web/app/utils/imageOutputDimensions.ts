export type ImageDimensions = { width: number; height: number }

export const MAX_OUTPUT_DIMENSION = 8192
export const MAX_OUTPUT_PIXELS = 32_000_000

export function outputSizeError({ width, height }: ImageDimensions) {
  if (width > MAX_OUTPUT_DIMENSION || height > MAX_OUTPUT_DIMENSION)
    return `Die Ausgabegröße darf höchstens ${MAX_OUTPUT_DIMENSION} px je Seite betragen.`
  if (width * height > MAX_OUTPUT_PIXELS)
    return 'Die Ausgabegröße darf höchstens 32 Megapixel betragen.'
  return ''
}

export function readOutputDimension(value: string) {
  const dimension = Math.round(Number(value))
  return Number.isSafeInteger(dimension) && dimension > 0 ? dimension : undefined
}
