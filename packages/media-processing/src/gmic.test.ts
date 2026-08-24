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

  it("does not expose arbitrary G'MIC commands as effects", () => {
    const provider = new GmicCliImageEffectProvider()
    expect(provider.supports('exec rm -rf /')).toBe(false)
    expect(provider.supports('gmic_poster')).toBe(true)
  })
})
