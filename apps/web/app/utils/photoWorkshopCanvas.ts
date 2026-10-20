// Canvas-Bausteine der Bildwerkstatt (PhotoImageWorkshop.vue): Vorschau- und Upload-Kodierung, das
// Laden von Bildern fuer den Export und das Zusammensetzen aus Foto, Rahmen und Logo.

export type LogoPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'

/** Kodiert den Canvas als JPEG, auf hoechstens maxSide Pixel an der laengeren Seite verkleinert. */
export function canvasBlob(canvas: HTMLCanvasElement, maxSide?: number, quality = 0.92): Promise<Blob> {
  const scale = maxSide ? Math.min(1, maxSide / Math.max(canvas.width, canvas.height)) : 1
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.round(canvas.width * scale))
  target.height = Math.max(1, Math.round(canvas.height * scale))
  target.getContext('2d')?.drawImage(canvas, 0, 0, target.width, target.height)
  return new Promise((resolve, reject) => target.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('image_encoding_failed')),
    'image/jpeg',
    quality,
  ))
}

export async function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// Signierte Storage-URLs gehen erst ueber eine Blob-URL in den Canvas, damit er beim Export nicht
// durch eine fremde Herkunft gesperrt wird.
export async function loadCanvasImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('asset_download_failed')
  return loadBlobImage(await response.blob())
}

function drawLogo(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, position: LogoPosition) {
  const margin = Math.round(Math.min(width, height) * 0.04)
  const logoWidth = Math.max(1, Math.round(width * 0.16))
  const logoHeight = Math.max(1, Math.round((logoWidth * image.naturalHeight) / image.naturalWidth))
  const x = position.endsWith('right') ? width - margin - logoWidth : margin
  const y = position.startsWith('bottom') ? height - margin - logoHeight : margin
  context.drawImage(image, x, y, logoWidth, logoHeight)
}

/** Setzt das Ausgabebild in der Zielgroesse zusammen: Foto, darueber Rahmen und Logo. */
export async function composeWorkshopImage(options: {
  image: CanvasImageSource
  width: number
  height: number
  frameUrl: string | null
  logoUrl: string | null
  logoPosition: LogoPosition
  type: 'image/png' | 'image/jpeg'
}): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = options.width
  canvas.height = options.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas_unavailable')
  context.drawImage(options.image, 0, 0, canvas.width, canvas.height)
  if (options.frameUrl) {
    const frame = await loadCanvasImage(options.frameUrl)
    context.drawImage(frame, 0, 0, canvas.width, canvas.height)
  }
  if (options.logoUrl) drawLogo(context, await loadCanvasImage(options.logoUrl), canvas.width, canvas.height, options.logoPosition)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, options.type, 0.92))
  if (!blob) throw new Error('image_export_failed')
  return blob
}
