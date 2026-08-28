import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

// Diese Rezepte sind absichtlich Quellcode und keine Daten aus der Datenbank. Die Galerie zeigt
// den kompletten, fuer ein einzelnes Foto sinnvollen G'MIC-"Artistic"-Katalog. G'MIC kann Dateien
// lesen, Befehle importieren und Programme ausfuehren; ein frei speicherbares Kommando waere daher
// keine "Filtereinstellung", sondern Remote-Code-Ausfuehrung im API-Container.
const CURATED_GMIC_RECIPES = {
  // Bestehendes Preset bleibt kompatibel; der neue Katalog bietet zusätzlich die neutral
  // benannte G'MIC-Variante `gmic_cartoon`.
  comic: ['cartoon', '3,50,10,0.25,3,16'],
  gmic_vintage: ['old_photo'],
  gmic_poster: ['poster_hope', '3'],
  gmic_brushify: ['brushify'],
  gmic_cartoon: ['cartoon', '3,50,10,0.25,3,16'],
  gmic_color_ellipses: ['color_ellipses'],
  gmic_cubism: ['cubism'],
  gmic_ellipsionism: ['ellipsionism'],
  gmic_fire_edges: ['fire_edges'],
  gmic_fractalize: ['fractalize'],
  gmic_glow: ['glow'],
  gmic_halftone: ['halftone'],
  gmic_hardsketchbw: ['hardsketchbw'],
  gmic_hearts: ['hearts'],
  gmic_houghsketchbw: ['houghsketchbw'],
  gmic_lightrays: ['lightrays'],
  gmic_light_relief: ['light_relief'],
  gmic_linify: ['linify'],
  gmic_mosaic: ['mosaic'],
  gmic_pencilbw: ['pencilbw'],
  gmic_pixelsort: ['pixelsort'],
  gmic_polaroid: ['polaroid'],
  gmic_polygonize: ['polygonize'],
  gmic_poster_edges: ['poster_edges'],
  gmic_rodilius: ['rodilius'],
  gmic_sketchbw: ['sketchbw'],
  gmic_sponge: ['sponge'],
  gmic_stained_glass: ['stained_glass'],
  gmic_stars: ['stars'],
  gmic_stencil: ['stencil'],
  gmic_stencilbw: ['stencilbw'],
  gmic_tetris: ['tetris'],
  gmic_warhol: ['warhol'],
  gmic_weave: ['weave'],
  gmic_whirls: ['whirls'],
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
