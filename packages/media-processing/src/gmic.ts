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
  // `poster_hope` allein ist fuer echte Vereinsfotos zu hart: Die Standardstufe 3 erzeugt
  // grosse, flache Farbinseln und sichtbare Rasterstreifen. Die etwas niedrigere Stufe 5 trennt
  // die Farbflächen klarer, ein kleines G'MIC-Blur beruhigt die Hochfrequenz-Artefakte und eine
  // 55%-Mischung mit dem Original hält Gesichter, Trikots und Hintergrund lesbar. `[0]` fuegt eine
  // Kopie des Eingangsbildes hinzu; der Effekt laeuft gezielt nur auf dieser Kopie.
  gmic_poster: [
    '[0]',
    'poster_hope[1]',
    '5',
    'blur[1]',
    '0.75',
    'blend[0,1]',
    'alpha,0.55',
  ],
  // G'MIC custom commands consume the following token as their optional-arguments string. Without
  // the explicit `,`, the following `output` command becomes that arguments string and the
  // command fails before creating its derivative. A comma asks G'MIC to use the documented
  // defaults and, crucially, terminates the custom command.
  //
  // brushify is the exception: it requires a separate brush image. Build the small deterministic
  // brush inline, apply it only to the source image, then remove it before writing the result.
  gmic_brushify: [
    '40,40',
    'gaussian[-1]',
    '10,4',
    'spread[-1]',
    '10,0',
    'brushify[0]',
    '[1],1',
    'remove[1]',
  ],
  gmic_cartoon: ['cartoon', '3,50,10,0.25,3,16'],
  gmic_color_ellipses: ['color_ellipses', ','],
  gmic_cubism: ['cubism', ','],
  gmic_ellipsionism: ['ellipsionism', ','],
  gmic_fire_edges: ['fire_edges', ','],
  gmic_fractalize: ['fractalize', ','],
  gmic_glow: ['glow', ','],
  gmic_halftone: ['halftone', ','],
  // Die G'MIC-Standardeinstellungen erzeugen ein fast vollflaechiges Kreuzschraffur-Bild.
  // Eine Kopie des Originals bleibt deshalb als Basis erhalten; die weichere Skizze wird nur
  // mit 40% Deckkraft daruebergelegt. So bleiben Gesichter und Bildaufbau erkennbar.
  gmic_hardsketchbw: [
    '[0]',
    'hardsketchbw[1]',
    '200,70,0.08,12,1',
    'blend[0,1]',
    'alpha,0.4',
  ],
  gmic_hearts: ['hearts', ','],
  // Houghsketchbw arbeitet standardmaessig mit sehr vielen Abstimmungslinien und verliert dabei
  // das Motiv. Weniger Dichte plus eine transparente Mischung liefert technische Konturen, ohne
  // das Foto in ein reines Linienraster zu verwandeln.
  gmic_houghsketchbw: [
    '[0]',
    'houghsketchbw[1]',
    '35,4,55,0.05,50%',
    'blend[0,1]',
    'alpha,0.38',
  ],
  gmic_lightrays: ['lightrays', ','],
  gmic_light_relief: ['light_relief', ','],
  gmic_linify: ['linify', ','],
  gmic_mosaic: ['mosaic', ','],
  gmic_pencilbw: ['pencilbw', ','],
  gmic_pixelsort: ['pixelsort', ','],
  gmic_polaroid: ['polaroid', ','],
  gmic_polygonize: ['polygonize', ','],
  gmic_poster_edges: ['poster_edges', ','],
  gmic_rodilius: ['rodilius', ','],
  // `sketchbw` liefert allein eine helle Zeichenflaeche mit feinen Linien und verwirft das Foto.
  // Die Skizze wird deshalb auf einer Kopie erzeugt und mit 35% Deckkraft ueber das Original gelegt.
  gmic_sketchbw: ['[0]', 'sketchbw[1]', ',', 'blend[0,1]', 'alpha,0.35'],
  gmic_sponge: ['sponge', ','],
  gmic_stained_glass: ['stained_glass', ','],
  gmic_stars: ['stars', ','],
  gmic_stencil: ['stencil', ','],
  gmic_stencilbw: ['stencilbw', ','],
  gmic_tetris: ['tetris', ','],
  gmic_warhol: ['warhol', ','],
  gmic_weave: ['weave', ','],
  gmic_whirls: ['whirls', ','],
} as const

export type CuratedGmicEffect = keyof typeof CURATED_GMIC_RECIPES

export interface ImageEffectProvider {
  readonly id: string
  supports(effect: string): effect is CuratedGmicEffect
  apply(effect: CuratedGmicEffect, sourceBuffer: Buffer, signal?: AbortSignal): Promise<Buffer>
}

export interface GmicCommandExecutor {
  (binary: string, arguments_: readonly string[], cwd: string, signal?: AbortSignal): Promise<void>
}

// The concrete CLI error intentionally stays server-side, but callers still need to distinguish
// a failed optional effect from an image/Sharp failure. The filter gallery can then retain the
// healthy previews and mark just this effect unavailable.
export class GmicImageEffectError extends Error {
  constructor(effect: CuratedGmicEffect, cause: unknown) {
    super(`G'MIC image effect failed: ${effect}`, { cause })
    this.name = 'GmicImageEffectError'
  }
}

async function executeGmic(
  binary: string,
  arguments_: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  // Nie ueber eine Shell ausfuehren. Argumente, Pfade und Pipeline stammen alle entweder aus
  // diesem Modul oder aus mkdtemp(), also nicht aus einem Preset, Upload-Dateinamen oder Request.
  await execFile(binary, [...arguments_], {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    ...(signal ? { signal } : {}),
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

  async apply(effect: CuratedGmicEffect, sourceBuffer: Buffer, signal?: AbortSignal): Promise<Buffer> {
    const directory = await mkdtemp(join(tmpdir(), 'vereinsfunk-gmic-'))
    const inputPath = join(directory, 'input.img')
    const outputPath = join(directory, 'output.png')
    try {
      await writeFile(inputPath, sourceBuffer, { flag: 'wx' })
      signal?.throwIfAborted()
      // Die offizielle CLI-Syntax ist: input command [args] output output.png. PNG fixiert das
      // Zwischenformat, damit Sharp anschliessend Dimensionen/Alpha sicher pruefen kann.
      await this.execute(
        this.binary,
        [inputPath, ...CURATED_GMIC_RECIPES[effect], 'output', outputPath],
        directory,
        signal,
      )
      signal?.throwIfAborted()
      return await readFile(outputPath)
    } catch (error) {
      // Stderr kann Dateinamen und interne G'MIC-Details enthalten; die API darf das nicht an
      // Mitglieder zurueckgeben. Der Error-Handler erzeugt eine korrelierbare, generische 500.
      if (signal?.aborted) throw error
      throw new GmicImageEffectError(effect, error)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
