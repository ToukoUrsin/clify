import fs from "node:fs";
import { explore, type ExploreResult, type ScriptStep } from "./explore.ts";
import { readJson, siteFile, readSpec } from "./store.ts";
import type { Credentials, SiteSpec } from "./types.ts";

export function credentialsFromEnv(
  usernameEnv = "CLIFY_USERNAME",
  passwordEnv = "CLIFY_PASSWORD",
): Credentials | null {
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];
  return username && password ? { username, password } : null;
}

export function loginUrlFor(name: string, explicitUrl?: string): string | null {
  if (explicitUrl) return explicitUrl;
  const spec = readSpec<SiteSpec>(name);
  return spec?.auth?.loginUrl || spec?.startUrl || spec?.origin || null;
}

export function defaultLoginScript(): ScriptStep[] {
  return [
    { tool: "fill_login", input: { submit: true } },
    { tool: "logged_in", input: { verify: "auto" } },
  ];
}

export function readLoginScript(file?: string): ScriptStep[] {
  if (!file) return defaultLoginScript();
  if (!fs.existsSync(file)) throw new Error(`login script not found: ${file}`);
  const script = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(script)) throw new Error("login script must be a JSON array");
  return script as ScriptStep[];
}

export async function runLogin(options: {
  name: string;
  url?: string;
  script?: ScriptStep[];
  usernameEnv?: string;
  passwordEnv?: string;
}): Promise<ExploreResult & { url: string; sessionFile: string }> {
  const url = loginUrlFor(options.name, options.url);
  if (!url) throw new Error(`no login URL for site "${options.name}"; pass --url`);
  const credentials = credentialsFromEnv(options.usernameEnv, options.passwordEnv);
  if (!credentials) {
    const u = options.usernameEnv ?? "CLIFY_USERNAME";
    const p = options.passwordEnv ?? "CLIFY_PASSWORD";
    throw new Error(`missing authorized credentials; set ${u} and ${p} in the process environment`);
  }
  const result = await explore({
    name: options.name,
    url,
    script: options.script ?? defaultLoginScript(),
    credentials,
    maxSteps: 12,
  });
  return { ...result, url, sessionFile: siteFile(options.name, "session.json") };
}
