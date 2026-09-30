// Electron's main process is bundled rather than compiled with `tsc`. The app is on
// `moduleResolution: "Bundler"` so relative imports carry no `.js` extension, which plain tsc output
// would leave unresolvable at runtime. A bundler is the other half of that choice.
//
// Driven through esbuild's JS API, not its CLI: esbuild's postinstall replaces `bin/esbuild` with a
// native executable, and a pnpm shim created before that still tries to run it through node.

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src", "main.ts")],
  outfile: join(root, "dist", "main.cjs"),
  bundle: true,
  platform: "node",
  // CJS, even though the package is ESM: Electron's ESM loader has enough caveats that the bundle
  // avoiding it entirely is one less thing between a change and seeing it run.
  format: "cjs",
  target: "node22",
  // Provided by the runtime, and not resolvable as a normal module.
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
