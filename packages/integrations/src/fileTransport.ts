import { parse } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import type { SourceTransport } from './types.js'

export type FileFormat = 'csv' | 'xlsx'

/**
 * Datei-Transport: liest eine als Buffer übergebene CSV- oder XLSX-Datei zeilenweise in rohe
 * Records. Keine Interpretation der Spalten -- DomainAdapter.normalize() wendet das
 * FieldMapping an, nicht der Transport. Alle Werte kommen als String zurück (auch aus
 * XLSX-Zellen mit Zahl-/Datumsformat), damit beide Dateiformate demselben Adapter dieselbe
 * Rohform liefern.
 *
 * Bibliothekswahl: csv-parse (0 Laufzeitabhängigkeiten, ESM-nativ) und exceljs -- nicht xlsx/
 * SheetJS, dessen npm-Veröffentlichung bei 0.18.5 mit zwei unbehobenen High-Severity-CVEs
 * (Prototype Pollution, ReDoS) hängen geblieben ist, weil SheetJS gepatchte Versionen nur noch
 * über die eigene CDN vertreibt, nicht über npm. exceljs ist für genau dieses Format aktiv
 * gepflegt und wird hier ausschließlich lesend auf eine von einem Verein hochgeladene, also
 * nicht vertrauenswürdige Datei angewendet.
 *
 * Datei und URL holt dieser Transport nicht selbst; der Buffer kommt von außen (API-Schicht).
 */
export class FileSourceTransport implements SourceTransport {
  readonly kind = 'file' as const
  readonly key: string
  private readonly format: FileFormat
  private readonly buffer: Buffer

  constructor(options: { key: string; format: FileFormat; buffer: Buffer }) {
    this.key = options.key
    this.format = options.format
    this.buffer = options.buffer
  }

  // options.since ist für Dateiimporte wirkungslos: eine Datei kennt kein "seit wann", jede
  // Zeile wird geliefert (siehe Plan, Abschnitt Transporte). Filterung ist Sache des Bereichs.
  // Der Parameter bleibt Teil der Signatur (SourceTransport-Interface, per Referenz aus
  // packages/integrations aufgerufen); `void options` haelt ihn ohne eslint-disable "benutzt".
  async *read(options: { since?: Date } = {}): AsyncIterable<Readonly<Record<string, unknown>>> {
    void options
    const rows = this.format === 'csv' ? this.readCsv() : await this.readXlsx()
    for (const row of rows) yield row
  }

  private readCsv(): Record<string, string>[] {
    return parse(this.buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]
  }

  private async readXlsx(): Promise<Record<string, string>[]> {
    const workbook = new ExcelJS.Workbook()
    // exceljs' mitgelieferte Typen sind gegen eine aeltere @types/node-Version geschrieben, deren
    // Buffer-Typ nicht generisch war -- strukturell inkompatibel mit dem heutigen Buffer<ArrayBufferLike>,
    // obwohl es sich zur Laufzeit um denselben Node-Buffer handelt. `as unknown as Buffer` scheitert
    // an derselben Inkompatibilitaet (zwei strukturell verschiedene "Buffer"-Deklarationen), deshalb
    // hier ausnahmsweise `any` an der Bibliotheksgrenze.
    await workbook.xlsx.load(this.buffer as any)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return []

    let headers: string[] = []
    const rows: Record<string, string>[] = []
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // ExcelJS.Row.values ist 1-indiziert; values[0] ist immer undefined.
      const values = (row.values as unknown[]).slice(1)
      if (rowNumber === 1) {
        headers = values.map((value) => cellToString(value))
        return
      }
      const record: Record<string, string> = {}
      headers.forEach((header, index) => {
        record[header] = cellToString(values[index])
      })
      rows.push(record)
    })
    return rows
  }
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    // Rich Text (`{ richText: [...] }`) oder eine Formelzelle (`{ formula, result }`).
    const record = value as Record<string, unknown>
    if ('result' in record) return cellToString(record.result)
    if ('richText' in record && Array.isArray(record.richText)) {
      return (record.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('')
    }
    if ('text' in record) return cellToString(record.text)
  }
  return String(value)
}
