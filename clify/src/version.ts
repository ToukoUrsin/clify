// The clify package dir and version (from package.json), shared by the CLI and the MCP server.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
