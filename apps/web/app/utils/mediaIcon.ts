import { FileAudio, FileVideo, ImagePlus } from '@lucide/vue'

export function iconForMimeType(mimeType: string) {
  if (mimeType.startsWith('video/')) return FileVideo
  if (mimeType.startsWith('audio/')) return FileAudio
  return ImagePlus
}
