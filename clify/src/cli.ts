// clify command line. Every command prints JSON to stdout (agents parse it);
// logs go to stderr. Exit code 0 = ok, 1 = error or confirmation needed.
// Errors carry `next`: the exact command to run next.
//
//   clify guide | --help                agent guide (JSON): what clify is, how to use it
//   clify list [--query w] [--category c]   find a site (ranked, one line per site)
//   clify add <url> [--goal ...]        explore the site, write + verify the CLI, install it
//   clify repair <site> [--command c]   re-verify, repair, re-explore what fails
//   clify check <site>                  re-run every command's example (no model calls)
//   clify <site> [--help] [--full]      commands, one line each, most useful first; a host or URL works too
//   clify <site> context [--set k=v]    account defaults (current project/org/team...)
//   clify --version                     the version, plain text
//   clify <site> <command> [--k v ...]  run a command
//        --yes            send a write command (otherwise: dry-run preview)
//        --fields a,b     keep only these fields ('*' = all)   --limit N   first N items
//        --full           don't trim long strings
//   clify record <url> --name <site> --script steps.json   scripted headless recording
//   clify install <site> | remove <site>
//   clify mcp [site ...]                MCP server (stdio) exposing the commands
import fs from "node:fs";
import path from "node:path";
import { builtinSites, HOME, listSites, readSpec, siteFile } from "./store.ts";
import { categories, resolveSite, searchSites, shortDescription, similarSites } from "./catalog.ts";
import { PKG_DIR, VERSION } from "./version.ts";
import { run, present, loadSession, findCommand } from "./runtime.ts";
import type { CommandSpec, ParamSpec, SiteSpec } from "./types.ts";

function out(v: unknown, code = 0): never {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  process.exit(code);
}

const BOOL_FLAGS = new Set(["yes", "full", "help", "allow-writes", "no-install", "no-explore", "reuse-recording", "version"]);

function parseFlags(argv: string[]): { pos: string[]; flags: Record<string, string> } {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") {
      flags.help = "true";
      continue;
    }
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (!BOOL_FLAGS.has(a.slice(2)) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = "true";
  }
  return { pos, flags };
}

export function loadSpec(name: string): SiteSpec | null {
  return readSpec<SiteSpec>(name);
}

function exampleLine(site: string, cmd: { name: string; example?: Record<string, string> }): string {
  return `clify ${site} ${cmd.name} ${Object.entries(cmd.example ?? {}).map(([k, v]) => `--${k} ${JSON.stringify(v)}`).join(" ")}`.trim();
}

// A param the agent must pass: required, and no default or account context fills it.
function needsArg(spec: SiteSpec, p: ParamSpec): boolean {
  return p.required && p.default === undefined && !(p.context && spec.context?.[p.context]);
}

function paramHelp(spec: SiteSpec, p: ParamSpec) {
  const ctx = p.context && spec.context?.[p.context];
  return {
    name: `--${p.name}`,
    type: p.type,
    ...(needsArg(spec, p) ? { required: true } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.enum ? { oneOf: p.enum } : {}),
    ...(ctx ? { default: ctx.value, defaultFrom: `your account (clify ${spec.name} context)` } : p.default !== undefined ? { default: p.default } : {}),
  };
}

// One command in full: every param, an example from the verified call, what comes back.
export function commandHelp(spec: SiteSpec, c: CommandSpec) {
  return {
    name: c.name,
    ...(c.aliases?.length ? { aliases: c.aliases } : {}),
    summary: c.summary,
    ...(c.mutates ? { writes: true, note: "dry-run preview unless --yes" } : {}),
    ...(c.auth ? { needsLogin: true } : {}),
    params: c.params.map((p) => paramHelp(spec, p)),
    example: exampleLine(spec.name, c),
    ...(c.defaultFields ? { defaultFields: c.defaultFields } : {}),
    ...(c.resultFields?.length ? { allFields: c.resultFields } : {}),
    ...(c.sample ? { sampleOutput: c.sample } : {}),
  };
}

// One line per command: name, summary, a runnable example, the other flags.
function commandLine(spec: SiteSpec, c: CommandSpec): string {
  const ex = c.example ?? {};
  const more = c.params
    .filter((p) => ex[p.name] === undefined && !needsArg(spec, p) && !(p.context && spec.context?.[p.context]))
    .map((p) => `--${p.name}${p.default !== undefined ? `=${p.default}` : ""}`);
  const missing = c.params.filter((p) => needsArg(spec, p) && ex[p.name] === undefined).map((p) => `--${p.name} <${p.type}>`);
  const eg = [exampleLine(spec.name, c), ...missing].join(" ");
  return `${c.name}${c.mutates ? " [write]" : ""}: ${c.summary.replace(/\s+/g, " ")} | ${eg}${more.length ? ` | also: ${more.slice(0, 6).join(" ")}${more.length > 6 ? " …" : ""}` : ""}`;
}

// `clify <site>`: compact by default (one line per command, most useful first);
// `clify <site> <command> --help` has the details; `--full` lists everything.
export function helpFor(spec: SiteSpec, opts: { full?: boolean } = {}) {
  const context = spec.context && Object.keys(spec.context).length ? Object.fromEntries(Object.entries(spec.context).map(([k, v]) => [k, v.value])) : undefined;
  const head = {
    site: spec.name,
    description: spec.description,
    loggedIn: !!loadSession(spec.name),
    usage: `clify ${spec.name} <command> [--flag value ...]; JSON out; --fields a,b ('*' = all) --limit N; [write] commands preview until --yes; clify ${spec.name} <command> --help for every flag and a sample output`,
    ...(context ? { context, contextNote: "your account's values, filled in automatically; pass the flag to use another" } : {}),
  };
  if (!opts.full)
    return {
      ...head,
      commands: spec.commands.map((c) => commandLine(spec, c)),
      ...(spec.notes?.length ? { notes: spec.notes } : {}),
      ...(spec.blockers?.length ? { blockers: spec.blockers } : {}),
    };
  return {
    ...head,
    origin: spec.origin,
    commands: spec.commands.map((c) => commandHelp(spec, c)),
    ...(spec.notes?.length ? { notes: spec.notes } : {}),
    ...(spec.blockers?.length ? { blockers: spec.blockers } : {}),
  };
}

export const ADD_DURATION = "2–6 min typical, up to ~15 on big sites";

// The agent guide: compact (< 3 KB). Site lists live behind `clify list`.
export function guide() {
  const shipped = builtinSites().length;
  const docs = Object.fromEntries(["AGENTS.md", "llms.txt", "SKILL.md"].map((f) => [f, path.join(PKG_DIR, f)]).filter(([, p]) => fs.existsSync(p)));
  return {
    clify: `Websites as JSON CLIs and MCP tools for agents: ${shipped} verified public sites ship ready to use, and \`clify add <url>\` builds a new one by exploring the site once in headless Chrome and recording the HTTP requests behind it. Calls then go straight to the site's own API: no browser, far fewer tokens.`,
    version: VERSION,
    contract: [
      "stdout is one JSON object; exit 0 = ok, 1 = error. Logs go to stderr.",
      "Results: {ok, count, total?, nextPage?, data}. nextPage holds the args for the next page.",
      "Errors: {ok:false, error, next}; next is the exact command to run next.",
      "Writes (writes:true) return a dry-run preview until you add --yes (MCP: confirm:true).",
      "--fields a,b (dot paths, '*' = all) | --limit N | --full (no trimming).",
      "A CAPTCHA or bot check is a blocker: never get around it; use clify ask.",
    ],
    findASite: [
      "clify list --query <words>     # ranked matches: site, description, command count",
      "clify list --category <name>   # categories: clify list",
      "clify <site>                   # commands, params, examples; a host or URL works too (clify crates.io)",
    ],
    commands: {
      "clify list [--query W] [--category C]": "Find a site.",
      "clify <site>": "That site's commands, params and examples.",
      "clify <site> <command> --param value": "Run a command (add --help for its params).",
      "clify add <url> [--goal G]": `Build a CLI for a new site: explore, generate, verify, install (${ADD_DURATION}).`,
      "clify repair <site> [--command C]": "A command broke or is missing: re-verify and fix it.",
      "clify mcp [site ...]": "MCP server over stdio; tools are <site>__<command>.",
      "clify ask|approve|forward": "Ask your human by email (CAPTCHAs, writes); ACCOUNTS.md.",
    },
    more: "clify check <site> | clify install <site> | clify login|whoami <site> (accounts: ACCOUNTS.md)",
    mcp: { command: "clify", args: ["mcp"] },
    docs,
    ...(listSites().length ? {} : { next: "clify add <url of the site you need>" }),
  };
}

// One JSON object whose data array has one item per line: easy to scan, still valid JSON.
function outList(head: Record<string, unknown>, data: unknown[]): never {
  const top = JSON.stringify(head).slice(0, -1);
  const rows = data.map((d) => "  " + JSON.stringify(d)).join(",\n");
  process.stdout.write(`${top}${top.length > 1 ? "," : ""}"data":[${data.length ? "\n" + rows + "\n" : ""}]}\n`);
  process.exit(0);
}

// Unknown site: close matches and the best next step. `clify add` only when nothing ships.
function unknownSite(input: string): never {
  const matches = similarSites(input, 10);
  const looksUrl = /[./]/.test(input);
  out({
    ok: false,
    error: `unknown site "${input}"`,
    ...(matches.length ? { didYouMean: matches, next: `clify ${matches[0]}` } : { next: looksUrl ? `clify add ${input}` : `clify list --query ${JSON.stringify(input)}  |  clify add <url of ${input}>` }),
  }, 1);
}

const RESERVED = new Set(["yes", "fields", "limit", "full", "help"]);

// `clify <site> context [--set name=value] [--unset name]`: the account values
// that commands fill in by themselves.
function contextCommand(spec: SiteSpec, flags: Record<string, string>) {
  const ctx = { ...(spec.context ?? {}) };
  if (flags.set || flags.unset) {
    if (flags.set) {
      const [k, ...v] = flags.set.split("=");
      if (!k || !v.length) out({ ok: false, error: "usage: clify <site> context --set name=value", context: ctx }, 1);
      ctx[k] = { value: v.join("="), from: "set by hand" };
      for (const c of spec.commands) for (const p of c.params) if (p.name === k && !p.context) p.context = k;
    }
    if (flags.unset) delete ctx[flags.unset];
    spec.context = ctx;
    const file = siteFile(spec.name, "spec.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(spec, null, 2) + "\n");
  }
  const uses = (k: string) => spec.commands.filter((c) => c.params.some((p) => p.context === k)).map((c) => c.name);
  return {
    ok: true,
    site: spec.name,
    context: Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, { value: v.value, from: v.from, usedBy: uses(k) }])),
    note: Object.keys(ctx).length ? "commands fill these in when you omit the flag; change one with --set name=value" : "no account context for this site",
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const { pos, flags } = parseFlags(argv);
  const [first, second] = pos;

  // Accounts, identity, signup, login, session and vault commands: accounts-cli.ts (accounts module).
  const acc = first && !loadSpec(first) ? await import("./accounts-cli.ts") : null;
  if (acc?.ACCOUNT_COMMANDS.has(first)) return acc.run(argv);

  if (flags.version === "true" || first === "version") {
    process.stdout.write(VERSION + "\n");
    process.exit(0);
  }
  if (!first || first === "help" || first === "guide" || (flags.help === "true" && !first)) out(guide());
  if (first === "list") {
    const query = [second, flags.query].filter((q) => q && q !== "true").join(" ");
    const category = flags.category && flags.category !== "true" ? flags.category : undefined;
    const hits = searchSites(query, category);
    if (!query && !category)
      outList({ ok: true, count: hits.length, categories: categories(), next: "clify list --query <words>  |  clify <site>" }, hits.map((e) => ({ site: e.site, commands: e.commands.length, category: e.category, description: shortDescription(e.description, 90), ...(e.local ? { local: true } : {}) })));
    if (!hits.length) {
      const what = [query && `"${query}"`, category && `in category "${category}"`].filter(Boolean).join(" ");
      out({ ok: false, error: `no site matches ${what}`, categories: categories(), next: query && category ? `clify list --query ${JSON.stringify(query)}` : query ? `clify add <url of the site for ${query}>` : "clify list" }, 1);
    }
    const shown = hits.slice(0, flags.limit ? Number(flags.limit) : 15);
    outList({ ok: true, count: hits.length, ...(shown.length < hits.length ? { shown: shown.length, more: "--limit N" } : {}), next: `clify ${shown[0].site}` }, shown.map((e) => ({ site: e.site, commands: e.commands.length, category: e.category, description: shortDescription(e.description), ...(e.local ? { local: true } : {}) })));
  }

  if (first === "mcp") {
    const { serve } = await import("./mcp.ts");
    await serve(pos.slice(1));
    return;
  }

  if (first === "add") {
    if (!second) out({ ok: false, error: "usage: clify add <url> [--goal \"what you need\"] [--name site] [--account auto|agent|user|none] [--allow-writes]", next: "clify add https://example.com" }, 1);
    let url = second;
    if (!/^https?:\/\//.test(url)) url = "https://" + url;
    try {
      new URL(url);
    } catch {
      out({ ok: false, error: `not a URL: ${second}`, next: "clify add https://example.com" }, 1);
    }
    if (flags.cdp) process.env.CLIFY_CDP_URL = flags.cdp; // remote exploration browser (DevTools endpoint)
    const account = (flags.account ?? "auto") as any;
    if (!["auto", "agent", "user", "none"].includes(account)) out({ ok: false, error: "--account must be one of: auto, agent, user, none" }, 1);
    const { addSite } = await import("./add.ts");
    const res = await addSite({
      url,
      name: flags.name,
      goal: flags.goal,
      account,
      allowWrites: flags["allow-writes"] === "true",
      maxSteps: flags.steps ? Number(flags.steps) : undefined,
      rounds: flags.rounds ? Number(flags.rounds) : undefined,
      reuseRecording: flags["reuse-recording"] === "true",
    });
    out(res, res.ok ? 0 : 1);
  }

  const target = resolveSite(second) ?? second;
  if (first === "repair") {
    if (!second) out({ ok: false, error: "usage: clify repair <site> [--command name] [--goal \"...\"]", next: "clify list" }, 1);
    if (!loadSpec(target)) unknownSite(second);
    const { repairSite } = await import("./add.ts");
    try {
      const res = await repairSite(target, { command: flags.command, goal: flags.goal, rounds: flags.rounds ? Number(flags.rounds) : undefined, explore: flags["no-explore"] !== "true" });
      out(res, res.ok ? 0 : 1);
    } catch (e) {
      out({ ok: false, error: (e as Error).message, next: `clify ${target}` }, 1);
    }
  }

  if (first === "check") {
    if (!second) out({ ok: false, error: "usage: clify check <site>", next: "clify list" }, 1);
    if (!loadSpec(target)) unknownSite(second);
    const { checkSite } = await import("./add.ts");
    const res = await checkSite(target);
    const bad = res.results.filter((r) => !r.ok);
    out({ ok: !bad.length, ...res, ...(bad.length ? { next: `clify repair ${target}` } : {}) }, bad.length ? 1 : 0);
  }

  if (first === "record") {
    if (!second || !flags.name || !flags.script) out({ ok: false, error: "usage: clify record <url> --name <site> --script steps.json" }, 1);
    const { explore } = await import("./explore.ts");
    const user = process.env.CLIFY_USERNAME;
    const pass = process.env.CLIFY_PASSWORD;
    const res = await explore({
      name: flags.name,
      url: second,
      script: JSON.parse(fs.readFileSync(flags.script, "utf8")),
      credentials: user && pass ? { username: user, password: pass } : undefined,
    });
    out({
      ok: res.blockers.length === 0,
      recorded: res.exchanges.length,
      heldWrites: res.held.length,
      loggedIn: res.loggedIn,
      blockers: res.blockers,
      recording: siteFile(flags.name, "recording.jsonl"),
    }, res.blockers.length ? 1 : 0);
  }

  if (first === "install") {
    if (!second) out({ ok: false, error: "usage: clify install <site>", next: "clify list" }, 1);
    if (!loadSpec(target)) unknownSite(second);
    const { installShim } = await import("./add.ts");
    const shim = installShim(target);
    out({ ok: true, installed: shim, hint: `export PATH="${path.dirname(shim)}:$PATH"` });
  }

  if (first === "remove") {
    if (!second || !loadSpec(second)) out({ ok: false, error: `unknown site "${second}"`, next: "clify list" }, 1);
    fs.rmSync(path.join(HOME, "sites", second), { recursive: true, force: true });
    fs.rmSync(path.join(HOME, "bin", second), { force: true });
    out({ ok: true, removed: second });
  }

  // A site name, or a host/URL of a shipped site (crates.io, https://www.pypi.org/...).
  const spec = loadSpec(resolveSite(first) ?? first);
  if (!spec) unknownSite(first);
  if (!second) out(helpFor(spec, { full: flags.full === "true" }));
  const cmd = findCommand(spec, second);
  if (!cmd && second === "context") out(contextCommand(spec, flags));
  if (!cmd) {
    const dropped = spec.dropped?.find((c) => c.name === second);
    out({
      ok: false,
      error: dropped ? `"${second}" failed verification (${dropped.verifyNote ?? "not verified"}) and is disabled` : `unknown command "${second}"`,
      commands: spec.commands.map((c) => c.name),
      next: dropped ? `clify repair ${spec.name} --command ${second}` : `clify ${spec.name}`,
    }, 1);
  }
  if (flags.help === "true") out(commandHelp(spec, cmd));

  const args = Object.fromEntries(Object.entries(flags).filter(([k]) => !RESERVED.has(k)));
  const res = await run(spec, cmd, args, { confirm: flags.yes === "true" });
  if (!res.ok) {
    const { raw: _r, ...rest } = res;
    out(rest, 1);
  }
  out(
    present(cmd, res, {
      fields: flags.fields?.split(",").map((s) => s.trim()).filter(Boolean),
      limit: flags.limit ? Number(flags.limit) : undefined,
      full: flags.full === "true",
      cli: true,
    }),
  );
}

main().catch((e) => out({ ok: false, error: (e as Error).message }, 1));
