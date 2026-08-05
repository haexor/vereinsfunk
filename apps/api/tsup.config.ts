import { defineConfig } from 'tsup'

// The packages/* workspace deps are consumed as raw TypeScript -- their exports map points at
// src/index.ts, and those sources import their own siblings with .js specifiers. Node's native
// type stripping does not rewrite .js -> .ts, so leaving them external produced a dist/server.js
// that died on startup with ERR_MODULE_NOT_FOUND on the first sibling import. Bundling them in
// keeps the production image free of a TypeScript runtime; real npm deps stay external and are
// installed from the lockfile.
// The external pattern is the other half of that: only our own code gets bundled, everything
// from npm stays a real import. Without it esbuild also swallowed the third-party deps of the
// bundled packages -- jsdom came in through @vereinsfunk/svg-safe and, being CommonJS, died at
// startup on `Dynamic require of "path" is not supported`.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  dts: true,
  noExternal: [/^@vereinsfunk\//],
  external: [/^(?!@vereinsfunk\/)[^.]/],
})
