// Bundles src/clify.ts (the re-export of clify/src/core.ts) into a single JS
// file with npm packages left external, for the deploy upload.
//   node scripts/bundle-core.mjs <out.js>
import { build } from "rolldown";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  input: path.join(root, "src/clify.ts"),
  external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
  output: { file: process.argv[2], format: "esm", banner: "// Bundled from clify/src/core.ts by scripts/bundle-core.mjs at deploy time. Do not edit." },
  logLevel: "warn",
});
