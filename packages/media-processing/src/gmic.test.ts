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

  it("does not expose arbitrary G'MIC commands as effects", () => {
    const provider = new GmicCliImageEffectProvider()
    expect(provider.supports('exec rm -rf /')).toBe(false)
    expect(provider.supports('gmic_poster')).toBe(true)
  })
})
