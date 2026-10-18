// `clify add <url>`: explore → synthesize → verify/repair → install, fully
// automatic. `clify repair <site>`: re-verify, repair, and re-explore for what
// still fails.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureAccount, ensureMeCommand } from "./accounts.ts";
import { explore, type ExploreResult } from "./explore.ts";
import { hasApiKey, MODEL } from "./llm.ts";
import { isSocialNetwork, robotsFor } from "./policy.ts";
import { HOME, log, nameFromUrl, readJson, siteFile, writeJson, readSpec } from "./store.ts";
import { collectAuthHeaders } from "./session.ts";
import { emptySpec, synthesize } from "./synth.ts";
import { polish } from "./polish.ts";
import { verifyAndRepair, type VerifyReport } from "./verify.ts";
import { getSite } from "./vault.ts";
import type { CommandSpec, Exchange, SiteSpec } from "./types.ts";

export type AccountMode = "auto" | "agent" | "user" | "none";

export interface AddOptions {
  url: string;
  name?: string;
  goal?: string;
  account?: AccountMode;
  allowWrites?: boolean;
  maxSteps?: number;
  maxSeconds?: number;
  rounds?: number;
  reuseRecording?: boolean; // skip exploration, synthesize from the existing recording
}

export interface AddSummary {
  ok: boolean;
  site: string;
  url: string;
  commands: { name: string; summary: string; verified: boolean; writes?: boolean; needsLogin?: boolean }[];
  verified: number;
  writes: number;
  dropped: { name: string; reason?: string }[];
  blockers: string[];
  loggedIn: boolean;
  seconds: number;
  explored?: { steps: number; recorded: number; heldWrites: number };
  installed?: string;
  next: string[];
}

export function readRecording(name: string): Exchange[] {
  const f = siteFile(name, "recording.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as Exchange;
      } catch {
        return null;
      }
    })
    .filter((x): x is Exchange => !!x);
}

// Writes a Playwright storage-state file (0600, temp dir) from the vault's saved
// browser storage, so exploration can start logged in.
function storageFromVault(name: string): string | undefined {
  try {
    const s = getSite(name);
    if (!s?.storage) return undefined;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clify-state-"));
    const f = path.join(dir, "state.json");
    fs.writeFileSync(f, JSON.stringify(s.storage), { mode: 0o600 });
    return f;
  } catch {
    return undefined;
  }
}

export function installShim(name: string): string {
  const binDir = path.join(HOME, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const self = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "bin", "clify");
  const shim = path.join(binDir, name);
  fs.writeFileSync(shim, `#!/usr/bin/env bash\nexec "${self}" ${name} "$@"\n`, { mode: 0o755 });
  return shim;
}

function summarize(spec: SiteSpec, report: VerifyReport[], extra: Partial<AddSummary>, t0: number): AddSummary {
  const reasons = new Map(report.map((r) => [r.name, r.reason]));
  const commands = spec.commands.map((c) => ({
    name: c.name,
    summary: c.summary,
    verified: !!c.verified,
    ...(c.mutates ? { writes: true } : {}),
    ...(c.auth ? { needsLogin: true } : {}),
  }));
  const verified = commands.filter((c) => c.verified).length;
  const first = spec.commands.find((c) => c.verified);
  return {
    ok: verified > 0,
    site: spec.name,
    url: spec.startUrl,
    commands,
    verified,
    writes: commands.filter((c) => c.writes).length,
    dropped: (spec.dropped ?? []).map((d) => ({ name: d.name, reason: d.verifyNote ?? reasons.get(d.name) })),
    blockers: spec.blockers ?? [],
    loggedIn: false,
    seconds: Math.round((Date.now() - t0) / 1000),
    next: [
      `clify ${spec.name}`,
      ...(first ? [`clify ${spec.name} ${first.name} ${Object.entries(first.example ?? {}).map(([k, v]) => `--${k} ${JSON.stringify(v)}`).join(" ")}`.trim()] : []),
      ...(verified ? [] : [`clify repair ${spec.name} --goal "<what you need from the site>"`]),
    ],
    ...extra,
  };
}

export async function addSite(o: AddOptions): Promise<AddSummary> {
  const t0 = Date.now();
  const name = o.name ?? nameFromUrl(o.url);
  const url = new URL(o.url).toString();
  const blockers: string[] = [];
  const fail = (msg: string, next: string[]): AddSummary => ({
    ok: false,
    site: name,
    url,
    commands: [],
    verified: 0,
    writes: 0,
    dropped: [],
    blockers: [...blockers, msg],
    loggedIn: false,
    seconds: Math.round((Date.now() - t0) / 1000),
    next,
  });
  if (!hasApiKey()) return fail("no model access: set ANTHROPIC_API_KEY (or ANTHROPIC_BASE_URL + key) so clify can explore and write the spec", ["export ANTHROPIC_API_KEY=...", `clify add ${url}`]);

  const robots = await robotsFor(url);
  if (!robots.allowed(url)) return fail(`robots.txt disallows ${new URL(url).pathname}; clify does not crawl it`, ["clify add <another start URL on the site>"]);

  const mode = o.account ?? "auto";
  let storageState = mode !== "none" ? storageFromVault(name) : undefined;
  let loggedIn = !!storageState;
  let res: ExploreResult | undefined;
  let steps = 0;

  if (!o.reuseRecording) {
    log(`🔭 exploring ${url}${loggedIn ? " (logged in from the vault)" : ""}`);
    res = await explore({ name, url, goal: o.goal, maxSteps: o.maxSteps ?? 30, maxSeconds: o.maxSeconds ?? 900, storageState, allowWrites: o.allowWrites, robots });
    steps += res.steps;
    blockers.push(...res.blockers.filter((b) => b !== "needs-account"));
    // The useful features need a login: get an account and explore again signed in.
    if (res.stoppedFor === "needs-account" || res.blockers.includes("needs-account")) {
      if (mode === "none") blockers.push("needs-account: the useful features need a login (run with --account auto)");
      else if (!loggedIn) {
        log("🔑 the useful features need a login: asking the accounts module");
        const acc = await ensureAccount({ name, url, mode: mode === "auto" ? "auto" : mode }).catch((e) => ({ ok: false, loggedIn: false, blockers: [String(e?.message ?? e)] }) as Awaited<ReturnType<typeof ensureAccount>>);
        if (acc.ok && acc.loggedIn) {
          storageState = acc.storageState ?? storageFromVault(name);
          loggedIn = true;
          const again = await explore({ name, url, goal: o.goal, maxSteps: o.maxSteps ?? 30, maxSeconds: o.maxSeconds ?? 900, storageState, allowWrites: o.allowWrites, robots, append: true });
          steps += again.steps;
          blockers.push(...again.blockers);
        } else blockers.push(`needs-account: ${acc.blockers.join("; ") || "no account available"}`);
      }
    }
  }
  if (storageState?.startsWith(os.tmpdir())) fs.rmSync(path.dirname(storageState), { recursive: true, force: true });

  const exchanges = readRecording(name);
  const spec: SiteSpec = { ...emptySpec(name, url), blockers: [...new Set(blockers)] };
  if (!exchanges.length) {
    return fail("nothing was recorded", [`clify add ${url} --goal "<what you need>"`]);
  }
  const syn = await synthesize({ name, url, exchanges, goal: o.goal, summary: res?.summary, loggedIn });
  spec.description = syn.description || `CLI for ${new URL(url).hostname}`;
  spec.commands = syn.commands;
  if (syn.notes.length) spec.notes = syn.notes;
  const authHeaders = Object.keys(collectAuthHeaders(exchanges.filter((e) => e.withSession), url));
  if (loggedIn || spec.commands.some((c) => c.auth)) spec.auth = { headerNames: authHeaders };
  if (isSocialNetwork(url)) (spec.notes ??= []).push("Real-identity social network: clify generates read commands only.");

  const { spec: checked, report } = await verifyAndRepair(spec, { rounds: o.rounds ?? 3 });
  const verified = await polish(checked, { exchanges, loggedIn });
  verified.generated = { by: "clify add", model: MODEL, exploredSteps: steps, recorded: exchanges.length, verifiedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) };
  writeJson(siteFile(name, "spec.json"), verified);
  if (loggedIn) ensureMeCommand(name); // keeps the accounts module's `me` command
  const shim = verified.commands.length ? installShim(name) : undefined;
  const summary = summarize(verified, report, { loggedIn, installed: shim, explored: { steps, recorded: exchanges.length, heldWrites: exchanges.filter((e) => e.held).length } }, t0);
  writeJson(siteFile(name, "add-report.json"), summary);
  return summary;
}

// Re-verify; repair what fails; if a command still fails (or --goal asks for
// something new), explore again with that focus, synthesize the missing
// commands and verify them.
export async function repairSite(name: string, o: { command?: string; goal?: string; rounds?: number; maxSteps?: number; explore?: boolean } = {}): Promise<AddSummary> {
  const t0 = Date.now();
  const file = siteFile(name, "spec.json");
  const spec = readSpec<SiteSpec>(name);
  if (!spec) throw new Error(`unknown site "${name}"`);
  // Bring dropped commands back as candidates.
  const target = o.command ? [o.command] : undefined;
  const revived = (spec.dropped ?? []).filter((d) => !target || target.includes(d.name));
  let work: SiteSpec = { ...spec, commands: [...spec.commands, ...revived.map((d) => ({ ...d, verified: undefined, verifyNote: undefined }))], dropped: (spec.dropped ?? []).filter((d) => !revived.includes(d)) };
  if (target && !work.commands.some((c) => c.name === o.command) && !o.goal) throw new Error(`no command "${o.command}" in ${name}`);
  let { spec: out, report } = await verifyAndRepair(work, { rounds: o.rounds ?? 2, only: target, review: false });

  const failing = (out.dropped ?? []).filter((d) => !target || target.includes(d.name));
  if ((failing.length || o.goal) && o.explore !== false && hasApiKey()) {
    const focus = [...(o.goal ? [o.goal] : []), ...failing.map((d) => `${d.name}: ${d.summary}`)];
    log(`🔭 re-exploring for: ${focus.join("; ")}`);
    const storageState = storageFromVault(name);
    const res = await explore({ name, url: spec.startUrl, goal: focus.join("; "), maxSteps: o.maxSteps ?? 20, storageState, append: true });
    if (storageState) fs.rmSync(path.dirname(storageState), { recursive: true, force: true });
    const syn = await synthesize({ name, url: spec.startUrl, exchanges: readRecording(name), goal: focus.join("; "), summary: res.summary, loggedIn: res.loggedIn, focus, existing: out.commands });
    const fresh: CommandSpec[] = syn.commands.filter((c) => !out.commands.some((k) => k.name === c.name));
    work = { ...out, commands: [...out.commands, ...fresh], dropped: (out.dropped ?? []).filter((d) => !fresh.some((f) => f.name === d.name)) };
    const again = await verifyAndRepair(work, { rounds: o.rounds ?? 2, only: fresh.map((c) => c.name) });
    out = again.spec;
    report = [...report.filter((r) => !fresh.some((f) => f.name === r.name)), ...again.report];
    // Failing originals superseded by new commands stay in dropped for reference.
  }
  out = await polish(out, { exchanges: readRecording(name), loggedIn: !!spec.auth });
  out.generated = { ...(out.generated ?? { by: "clify add" }), verifiedAt: new Date().toISOString() };
  writeJson(file, out);
  if (out.commands.length) installShim(name);
  return summarize(out, report, {}, t0);
}

// Re-run verification only (no model calls): which commands work right now.
export async function checkSite(name: string): Promise<{ site: string; results: { name: string; ok: boolean; reason?: string; ms?: number }[] }> {
  const spec = readSpec<SiteSpec>(name);
  if (!spec) throw new Error(`unknown site "${name}"`);
  const { checkCommand } = await import("./verify.ts");
  const results = [];
  for (const c of spec.commands) {
    const r = await checkCommand(spec, c);
    results.push({ name: c.name, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}), ms: r.ms });
  }
  return { site: name, results };
}
