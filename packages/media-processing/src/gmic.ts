import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

// Diese drei Rezepte sind absichtlich Quellcode und keine Daten aus der Datenbank. G'MIC kann
// Dateien lesen, Befehle importieren und Programme ausfuehren; ein frei speicherbares Kommando
// waere daher keine "Filtereinstellung", sondern Remote-Code-Ausfuehrung im API-Container.
const CURATED_GMIC_RECIPES = {
  comic: ['cartoon', '3,50,10,0.25,3,16'],
  gmic_vintage: ['old_photo'],
  gmic_poster: ['poster_hope', '3'],
} as const

export type CuratedGmicEffect = keyof typeof CURATED_GMIC_RECIPES

export interface ImageEffectProvider {
  readonly id: string
  supports(effect: string): effect is CuratedGmicEffect
  apply(effect: CuratedGmicEffect, sourceBuffer: Buffer): Promise<Buffer>
}

export interface GmicCommandExecutor {
  (binary: string, arguments_: readonly string[], cwd: string): Promise<void>
}

async function executeGmic(
  binary: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<void> {
  // Nie ueber eine Shell ausfuehren. Argumente, Pfade und Pipeline stammen alle entweder aus
  // diesem Modul oder aus mkdtemp(), also nicht aus einem Preset, Upload-Dateinamen oder Request.
  await execFile(binary, [...arguments_], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

export class GmicCliImageEffectProvider implements ImageEffectProvider {
  readonly id: string
  private readonly execute: GmicCommandExecutor

  constructor(options: { binary?: string; execute?: GmicCommandExecutor } = {}) {
    const binary = options.binary ?? 'gmic'
    if (!/^[a-zA-Z0-9_./-]+$/.test(binary)) throw new Error("invalid G'MIC binary path")
    this.id = `gmic-cli:${binary}`
    this.binary = binary
    this.execute = options.execute ?? executeGmic
  }

  private readonly binary: string

  supports(effect: string): effect is CuratedGmicEffect {
    return Object.hasOwn(CURATED_GMIC_RECIPES, effect)
  }

  async apply(effect: CuratedGmicEffect, sourceBuffer: Buffer): Promise<Buffer> {
    const directory = await mkdtemp(join(tmpdir(), 'vereinsfunk-gmic-'))
    const inputPath = join(directory, 'input.img')
    const outputPath = join(directory, 'output.png')
    try {
      await writeFile(inputPath, sourceBuffer, { flag: 'wx' })
      // Die offizielle CLI-Syntax ist: input command [args] output output.png. PNG fixiert das
      // Zwischenformat, damit Sharp anschliessend Dimensionen/Alpha sicher pruefen kann.
      await this.execute(
        this.binary,
        [inputPath, ...CURATED_GMIC_RECIPES[effect], 'output', outputPath],
        directory,
      )
      return await readFile(outputPath)
    } catch (error) {
      // Stderr kann Dateinamen und interne G'MIC-Details enthalten; die API darf das nicht an
      // Mitglieder zurueckgeben. Der Error-Handler erzeugt eine korrelierbare, generische 500.
      throw new Error(`G'MIC image effect failed: ${effect}`, { cause: error })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
