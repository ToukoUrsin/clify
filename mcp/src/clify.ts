// clify's own runtime core and spec types, shared rather than copied. In the
// repo this re-exports ../../clify/src; scripts/deploy.sh bundles it into one
// src/clify.js for the upload, because the managed build only sees mcp/.
export { dig, present, run } from "../../clify/src/core.ts";
export type { CommandSpec, ParamSpec, SiteSpec } from "../../clify/src/types.ts";
