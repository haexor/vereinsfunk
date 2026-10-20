import sharp, { type Metadata } from 'sharp'

export const MAX_IMAGE_STYLE_INPUT_PIXELS = 40_000_000

export function limitedSharp(input: Buffer, options: Parameters<typeof sharp>[1] = {}) {
  return sharp(input, { ...options, limitInputPixels: MAX_IMAGE_STYLE_INPUT_PIXELS })
}

// Eigener Fehlertyp aus demselben Grund wie GmicNotEnabledError: ein Foto ueber
// MAX_IMAGE_STYLE_INPUT_PIXELS ist eine erwartbare Ablehnung (413), kein Serverfehler.
export class ImageTooLargeError extends Error {
  constructor() {
    super('image_too_large')
  }
}

// Liest nur die Kopfdaten und deshalb bewusst ohne limitInputPixels: sharp setzt die Grenze sonst
// schon hier mit einem eigenen, generischen Fehler durch, und ein zu grosses Foto waere nicht mehr
// von einer unlesbaren Datei zu unterscheiden. Ein unbekanntes Format wirft weiterhin sharps Fehler.
export async function assertImageStyleInputSize(buffer: Buffer): Promise<Metadata> {
  const metadata = await sharp(buffer, { limitInputPixels: false }).metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_STYLE_INPUT_PIXELS)
    throw new ImageTooLargeError()
  return metadata
}
