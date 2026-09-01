import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { GmicCliImageEffectProvider } from './gmic.js'

describe('GmicCliImageEffectProvider', () => {
  it('executes only its curated comic recipe in a private temporary directory', async () => {
    let received: { binary: string; args: readonly string[]; cwd: string } | undefined
    const provider = new GmicCliImageEffectProvider({
      binary: '/usr/bin/gmic',
      execute: async (binary, args, cwd) => {
        received = { binary, args, cwd }
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await expect(provider.apply('comic', Buffer.from('input'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
    expect(received).toMatchObject({
      binary: '/usr/bin/gmic',
      args: expect.arrayContaining(['cartoon', '3,50,10,0.25,3,16']),
    })
    expect(received!.args[0]).toMatch(/vereinsfunk-gmic-/)
    expect(received!.args.at(-1)).toMatch(/output\.png$/)
  })

  it('terminates defaulted custom commands before the output command', async () => {
    let received: readonly string[] | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, args, cwd) => {
        received = args
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await provider.apply('gmic_cubism', Buffer.from('input'))

    // A bare `cubism output output.png` treats the first `output` as the optional density
    // argument. The comma is G'MIC's documented "use defaults" marker and lets output be parsed
    // as the following command.
    expect(received).toEqual(expect.arrayContaining(['cubism', ',', 'output']))
  })

  it('uses a softened, source-preserving Hope poster pipeline', async () => {
    let received: readonly string[] | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, args, cwd) => {
        received = args
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await provider.apply('gmic_poster', Buffer.from('input'))

    expect(received).toEqual([
      expect.stringMatching(/input\.img$/),
      '[0]',
      'poster_hope[1]',
      '5',
      'blur[1]',
      '0.75',
      'blend[0,1]',
      'alpha,0.55',
      'output',
      expect.stringMatching(/output\.png$/),
    ])
  })

  it('uses a source-preserving hard sketch pipeline', async () => {
    let received: readonly string[] | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, args, cwd) => {
        received = args
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await provider.apply('gmic_hardsketchbw', Buffer.from('input'))

    expect(received).toEqual([
      expect.stringMatching(/input\.img$/),
      '[0]',
      'hardsketchbw[1]',
      '200,70,0.08,12,1',
      'blend[0,1]',
      'alpha,0.4',
      'output',
      expect.stringMatching(/output\.png$/),
    ])
  })

  it('uses a source-preserving Hough line sketch pipeline', async () => {
    let received: readonly string[] | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, args, cwd) => {
        received = args
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await provider.apply('gmic_houghsketchbw', Buffer.from('input'))

    expect(received).toEqual([
      expect.stringMatching(/input\.img$/),
      '[0]',
      'houghsketchbw[1]',
      '35,4,55,0.05,50%',
      'blend[0,1]',
      'alpha,0.38',
      'output',
      expect.stringMatching(/output\.png$/),
    ])
  })

  it('uses a source-preserving sketch pipeline', async () => {
    let received: readonly string[] | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, args, cwd) => {
        received = args
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await provider.apply('gmic_sketchbw', Buffer.from('input'))

    expect(received).toEqual([
      expect.stringMatching(/input\.img$/),
      '[0]',
      'sketchbw[1]',
      ',',
      'blend[0,1]',
      'alpha,0.35',
      'output',
      expect.stringMatching(/output\.png$/),
    ])
  })

  it('builds and removes the required brush image for brushify', async () => {
    let received: readonly string[] | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, args, cwd) => {
        received = args
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })

    await provider.apply('gmic_brushify', Buffer.from('input'))

    expect(received).toEqual(expect.arrayContaining(['40,40', 'brushify[0]', '[1],1', 'remove[1]']))
  })

  it('passes an abort signal to the G’MIC command executor', async () => {
    let receivedSignal: AbortSignal | undefined
    const provider = new GmicCliImageEffectProvider({
      execute: async (_binary, _args, cwd, signal) => {
        receivedSignal = signal
        await writeFile(`${cwd}/output.png`, Buffer.from([1, 2, 3]))
      },
    })
    const controller = new AbortController()

    await provider.apply('gmic_vintage', Buffer.from('input'), controller.signal)

    expect(receivedSignal).toBe(controller.signal)
  })

  it("does not expose arbitrary G'MIC commands as effects", () => {
    const provider = new GmicCliImageEffectProvider()
    expect(provider.supports('exec rm -rf /')).toBe(false)
    expect(provider.supports('gmic_poster')).toBe(true)
  })
})
