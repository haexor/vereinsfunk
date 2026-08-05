import { defineConfig } from 'tsup'

// Same reason as apps/api/tsup.config.ts: the packages/* deps ship raw TypeScript with .js
// specifiers, which Node's type stripping cannot resolve, so they have to be bundled in
// rather than left external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  dts: true,
  noExternal: [/^@vereinsfunk\//],
  // Keep npm packages external -- see apps/api/tsup.config.ts for what bundling them broke.
  external: [/^(?!@vereinsfunk\/)[^.]/],
})
