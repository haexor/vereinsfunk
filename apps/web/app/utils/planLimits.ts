import type { MediaOrigin } from '@vereinsfunk/contracts'

// Anzeige der Tarifgrenzen (Plan 021) im Betreiberbereich: Tarif-Editor und Abweichungen je Verein
// zeigen dieselben Kontingente je Medienherkunft und nehmen den Speicher in MB entgegen.
export const MEDIA_ORIGIN_LABELS: Readonly<Record<MediaOrigin, string>> = { own_upload: 'Eigene Beiträge', ai_image: 'KI-Bilder', ai_video: 'KI-Videos' }
// Die API fuehrt Speichergrenzen in Bytes; MB hier binaer wie in formatBytes().
export const BYTES_PER_MB = 1024 * 1024
