import type { FastifyRequest } from 'fastify'
import type { z } from 'zod'

export type MultipartUploadResult<T> =
  | { ok: true; buffer: Buffer; fields: T }
  | { ok: false; status: number; error: string }

/**
 * Liest genau eine hochgeladene Datei samt begleitender Formularfelder und validiert die Felder
 * mit Zod. Die Datei wird zuerst vollstaendig gelesen: busboy fuellt filePart.fields erst, sobald
 * der Datei-Stream durchgelaufen ist. Der vom Client gemeldete MIME-Typ steht der Schema-
 * Pruefung als Feld `mimetype` zur Verfuegung; schlaegt genau dieses Feld fehl, antwortet die
 * Route mit `unsupportedMimetypeError` statt mit dem allgemeinen invalid_request.
 */
export async function readMultipartUpload<Schema extends z.ZodType>(
  request: FastifyRequest,
  schema: Schema,
  options: { fileSize?: number; unsupportedMimetypeError?: string } = {},
): Promise<MultipartUploadResult<z.output<Schema>>> {
  const filePart = await request.file(
    options.fileSize === undefined ? undefined : { limits: { fileSize: options.fileSize } },
  )
  if (!filePart) return { ok: false, status: 400, error: 'invalid_request' }
  let buffer: Buffer
  try {
    buffer = await filePart.toBuffer()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE')
      return { ok: false, status: 413, error: 'file_too_large' }
    throw error
  }
  const rawFields = Object.fromEntries(
    Object.entries(filePart.fields).map(([key, field]) => [
      key,
      field && 'value' in field ? field.value : undefined,
    ]),
  )
  const parsed = schema.safeParse({ ...rawFields, mimetype: filePart.mimetype })
  if (!parsed.success) {
    const mimetypeRejected = parsed.error.issues.some((issue) => issue.path[0] === 'mimetype')
    return {
      ok: false,
      status: 400,
      error:
        mimetypeRejected && options.unsupportedMimetypeError
          ? options.unsupportedMimetypeError
          : 'invalid_request',
    }
  }
  return { ok: true, buffer, fields: parsed.data }
}
