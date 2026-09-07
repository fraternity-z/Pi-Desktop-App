import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "../src-tauri/resources/pi-bridge/pi-bridge.mjs",
  // Undici uses CommonJS requires for Node built-ins inside the ESM bundle.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
