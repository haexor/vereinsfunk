import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { FileSourceTransport } from './fileTransport.js'

async function collect(transport: FileSourceTransport): Promise<Readonly<Record<string, unknown>>[]> {
  const rows: Readonly<Record<string, unknown>>[] = []
  for await (const row of transport.read({})) rows.push(row)
  return rows
}

describe('FileSourceTransport', () => {
  it('reads raw records from a CSV buffer with a header row', async () => {
    const csv = 'Vorname,Nachname,Geburtsjahr\nAnna,Beck,2010\nTom,Meyer,2005\n'
    const transport = new FileSourceTransport({ key: 'members.csv', format: 'csv', buffer: Buffer.from(csv, 'utf-8') })
    const rows = await collect(transport)
    expect(rows).toEqual([
      { Vorname: 'Anna', Nachname: 'Beck', Geburtsjahr: '2010' },
      { Vorname: 'Tom', Nachname: 'Meyer', Geburtsjahr: '2005' },
    ])
  })

  it('does not interpret column values -- everything stays a raw string', async () => {
    const csv = 'IBAN,Aktiv\nDE00000000000000000000,true\n'
    const transport = new FileSourceTransport({ key: 'members.csv', format: 'csv', buffer: Buffer.from(csv, 'utf-8') })
    const rows = await collect(transport)
    expect(rows[0]?.['Aktiv']).toBe('true')
    expect(typeof rows[0]?.['Aktiv']).toBe('string')
  })

  it('reads raw records from an XLSX buffer with a header row', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Mitglieder')
    worksheet.addRow(['Vorname', 'Nachname', 'Geburtsjahr'])
    worksheet.addRow(['Anna', 'Beck', 2010])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const transport = new FileSourceTransport({ key: 'members.xlsx', format: 'xlsx', buffer })
    const rows = await collect(transport)
    expect(rows).toEqual([{ Vorname: 'Anna', Nachname: 'Beck', Geburtsjahr: '2010' }])
    expect(typeof rows[0]?.['Geburtsjahr']).toBe('string')
  })

  it('ignores options.since for file transports and returns every row', async () => {
    const csv = 'Vorname\nAnna\nTom\n'
    const transport = new FileSourceTransport({ key: 'members.csv', format: 'csv', buffer: Buffer.from(csv, 'utf-8') })
    const rows: unknown[] = []
    for await (const row of transport.read({ since: new Date('2099-01-01') })) rows.push(row)
    expect(rows).toHaveLength(2)
  })
})
