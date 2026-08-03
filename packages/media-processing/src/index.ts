import { ObscuringStyleSchema, type FaceDecision } from '@vereinswerk/contracts'

export interface NormalizedBox { x: number; y: number; width: number; height: number }
export interface DetectedFace { box: NormalizedBox; confidence: number }
export interface FaceDetector { detect(image: Buffer): Promise<DetectedFace[]> }
export interface ImageAnonymizer { anonymize(input: Buffer, regions: readonly { box: NormalizedBox; decision: FaceDecision }[]): Promise<Buffer> }
export const opaqueStyles = new Set(['club_mascot', 'sports_ball', 'emoji', 'confetti_badge', 'brand_shape', 'scribble', 'pixelate', 'solid_blur'])

export function assertNormalizedBox(box: NormalizedBox): NormalizedBox {
  if (![box.x, box.y, box.width, box.height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || box.x + box.width > 1 || box.y + box.height > 1 || box.width === 0 || box.height === 0) throw new Error('Invalid normalized face box')
  return box
}

export function assertSafeObscuringDecision(decision: FaceDecision): void {
  if (decision.kind !== 'obscure') return
  const style = ObscuringStyleSchema.parse(decision.style)
  if (!opaqueStyles.has(style)) throw new Error('An opaque obscuring style is required')
}

/** Deliberately does no biometric matching; it is a deterministic test adapter only. */
export class ManualOnlyFaceDetector implements FaceDetector { async detect(): Promise<DetectedFace[]> { return [] } }
