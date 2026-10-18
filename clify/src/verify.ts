// Phase 3: every read command runs live with its example args. Output must be
// non-empty and look like data (not a login page, an empty list or page text).
// Failures, plus anything that looks wrong, go back to Claude with fresh
// evidence from the live response for a fix, for a few rounds. What still fails
// moves to spec.dropped. Writes are never sent here: only their dry-run preview
// is built.
import { askJson } from "./llm.ts";
import { describeHtml, describeJson } from "./digest.ts";
import { looksLikeXml, xmlToJson } from "./xml.ts";
import { log } from "./store.ts";
import { normalizeCommands, SPEC_FORMAT } from "./synth.ts";
import { buildRequest, loadSession, present, run, type RunResult } from "./runtime.ts";
import type { CommandSpec, SiteSpec } from "./types.ts";

export interface Check {
  name: string;
  ok: boolean;
  reason?: string;
  fatal?: boolean; // blocked by the site (bot check, robots); no point repairing
  status?: number;
  ms?: number;
  sample?: string;
  evidence?: string;
  first?: string; // first item, default fields (stored on the command as its sample)
  resultFields?: string[];
}

const BOT_RE = /(cf-chl|challenge-platform|cf_chl_opt|just a moment\.\.\.|attention required! \| cloudflare|px-captcha|perimeterx|datadome|captcha-delivery|are you a robot|verify you are human|g-recaptcha|h-captcha|hcaptcha\.com|_incapsula_|akamai bot manager|request unsuccessful\. incapsula)/i;

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(nonEmpty);
  if (typeof v === "object") return Object.values(v as object).some(nonEmpty);
  return true;
}

export function judge(cmd: CommandSpec, res: RunResult): { ok: boolean; reason?: string; fatal?: boolean } {
  const raw = res.raw ?? "";
  if (!res.ok) {
    const blocked = BOT_RE.test(raw.slice(0, 20000)) && (res.status === 403 || res.status === 429 || res.status === 503 || /html/i.test(res.contentType ?? ""));
    if (blocked) return { ok: false, fatal: true, reason: `the site answered with a bot check (HTTP ${res.status}); clify does not bypass these` };
    return { ok: false, reason: `${res.error ?? "failed"}${res.status ? ` (HTTP ${res.status})` : ""}` };
  }
  const d = res.data;
  if (/html/i.test(res.contentType ?? "") && BOT_RE.test(raw.slice(0, 20000)) && !nonEmpty(d)) return { ok: false, fatal: true, reason: "the site answered with a bot-check page; clify does not bypass these" };
  if (d === undefined || d === null) return { ok: false, reason: cmd.resultPath ? `resultPath "${cmd.resultPath}" matched nothing` : cmd.extract?.jsonScript ? `no JSON in ${cmd.extract.jsonScript}` : "empty response" };
  if (typeof d === "string") {
    if (cmd.responseType === "html") return { ok: false, reason: "no extract rules matched: got unstructured page text instead of fields" };
    if (cmd.responseType === "json") return { ok: false, reason: `response was not JSON (content-type ${res.contentType || "?"}): ${d.slice(0, 120)}` };
    return d.trim() ? { ok: true } : { ok: false, reason: "empty text response" };
  }
  if (Array.isArray(d)) {
    if (!d.length) return { ok: false, reason: "empty list: the example args returned nothing or the selector/resultPath is wrong" };
    const filled = d.filter(nonEmpty).length / d.length;
    if (filled < 0.5) return { ok: false, reason: "most list items are empty" };
    if (d.length >= 3 && new Set(d.map((x) => JSON.stringify(x))).size === 1) return { ok: false, reason: "all list items are identical (selector probably matches a wrapper)" };
    if (cmd.extract?.fields && !cmd.extract.jsonScript) {
      const keys = Object.keys(cmd.extract.fields);
      const got = keys.filter((k) => d.some((x: any) => x && x[k] !== undefined));
      if (got.length < Math.ceil(keys.length / 2)) return { ok: false, reason: `only ${got.length} of ${keys.length} fields extracted (missing: ${keys.filter((k) => !got.includes(k)).join(", ")})` };
    }
    return { ok: true };
  }
  if (typeof d === "object") {
    if (!nonEmpty(d)) return { ok: false, reason: "empty object" };
    if (cmd.extract?.fields && !cmd.extract.jsonScript) {
      const keys = Object.keys(cmd.extract.fields);
      const got = keys.filter((k) => (d as any)[k] !== undefined);
      if (got.length < Math.ceil(keys.length / 2)) return { ok: false, reason: `only ${got.length} of ${keys.length} fields extracted (missing: ${keys.filter((k) => !got.includes(k)).join(", ")})` };
    }
    const errKeys = Object.keys(d as object);
    if (errKeys.length <= 3 && errKeys.some((k) => /^(error|errors|message|fault)$/i.test(k)) && !errKeys.some((k) => /data|result|items/i.test(k)))
      return { ok: false, reason: `looks like an error payload: ${JSON.stringify(d).slice(0, 200)}` };
    return { ok: true };
  }
  return { ok: true };
}

function evidence(res: RunResult): string {
  const raw = res.raw ?? "";
  const head = `live response: HTTP ${res.status} ${res.contentType ?? ""} from ${res.finalUrl ?? res.url} (${raw.length} chars)`;
  if (!raw) return head;
  if (/json/i.test(res.contentType ?? "") || /^\s*[[{]/.test(raw)) return `${head}\n${describeJson(raw, 3500)}`;
  if (looksLikeXml(res.contentType ?? "", raw)) return `${head}\n(XML, converted to JSON for resultPath)\n${describeJson(JSON.stringify(xmlToJson(raw)), 3500)}`;
  if (/html/i.test(res.contentType ?? "")) return `${head}\n${describeHtml(raw, 5000, true)}`;
  return `${head}\n${raw.slice(0, 1500)}`;
}

export async function checkCommand(spec: SiteSpec, cmd: CommandSpec): Promise<Check> {
  const t0 = Date.now();
  if (cmd.mutates) {
    try {
      buildRequest(spec, cmd, cmd.example ?? {});
      return { name: cmd.name, ok: true, reason: "write: dry-run preview only, not sent" };
    } catch (e) {
      return { name: cmd.name, ok: false, reason: `write preview failed: ${(e as Error).message}` };
    }
  }
  let res = await run(spec, cmd, cmd.example ?? {}, { keepRaw: true });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 8000));
    res = await run(spec, cmd, cmd.example ?? {}, { keepRaw: true });
  }
  const j = judge(cmd, res);
  const shown = res.ok ? (JSON.stringify(present(cmd, res, { limit: 3 }).data) ?? "") : "";
  const one = res.ok ? (present(cmd, res, { limit: 1 }).data as unknown) : undefined;
  const head = Array.isArray(one) ? one[0] : one;
  const whole = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    name: cmd.name,
    ok: j.ok,
    reason: j.reason,
    fatal: j.fatal,
    status: res.status,
    ms: Date.now() - t0,
    sample: shown.slice(0, 1200),
    evidence: j.ok ? undefined : evidence(res),
    ...(j.ok && head !== undefined ? { first: JSON.stringify(head).slice(0, 360) } : {}),
    ...(j.ok && whole && typeof whole === "object" && !Array.isArray(whole) ? { resultFields: Object.keys(whole).slice(0, 40) } : {}),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const REPAIR_SYSTEM = `You fix clify commands. clify turns a website into a JSON CLI for AI agents; each command replays one HTTP request. A command was run live with its example args. You get the command, what went wrong (or its output, for review), and evidence from the live response. Return a corrected command, or drop it.

${SPEC_FORMAT}

Fixing tips: wrong resultPath → read the live JSON schema. Empty or wrong HTML fields → rewrite extract selectors from the live outline/repeated-items hints (tags, ids, classes, attributes only; no :nth-child/:contains/:has); prefer extract.jsonScript when embedded JSON holds the data. Empty list → maybe the example args are bad: pick args that return results. 404 → wrong URL template or example id. 401/403 without a bot check → missing required header or the endpoint needs login (then drop unless a session exists). Never add cookies or auth tokens. A command whose output is navigation/menu/footer text rather than the site's data is wrong: fix the selector or drop it.

Answer with one JSON object only: {"results":[{"name":"<original name>","action":"keep"|"fix"|"drop","command":{...full fixed CommandSpec, only for fix},"reason":"<short>"}]}`;

export interface VerifyReport {
  name: string;
  verified: boolean;
  write?: boolean;
  reason?: string;
  rounds: number;
  sample?: string;
  resultFields?: string[];
}

// Verify all read commands, repair failures (and review passing output once),
// up to `rounds` repair rounds. Returns the spec with commands/dropped updated.
export async function verifyAndRepair(spec: SiteSpec, opts: { rounds?: number; only?: string[]; review?: boolean } = {}): Promise<{ spec: SiteSpec; report: VerifyReport[] }> {
  const rounds = opts.rounds ?? 3;
  const hasSession = !!loadSession(spec.name);
  let cmds = [...spec.commands];
  const dropped: CommandSpec[] = [...(spec.dropped ?? [])];
  const report = new Map<string, VerifyReport>();
  const target = (c: CommandSpec) => !opts.only || opts.only.includes(c.name);

  // Login-only commands can't be checked without a session.
  if (!hasSession) {
    for (const c of cmds.filter((c) => c.auth && !c.mutates && target(c))) {
      dropped.push({ ...c, verified: false, verifyNote: "needs login: run `clify login` then `clify repair` to verify" });
      report.set(c.name, { name: c.name, verified: false, reason: "needs login", rounds: 0 });
    }
    cmds = cmds.filter((c) => !(c.auth && !c.mutates && target(c)));
  }

  let pending = cmds.filter(target);
  const passedBefore = new Map<string, CommandSpec>(); // reviewed-and-changed commands that already passed
  for (let round = 0; round <= rounds && pending.length; round++) {
    log(`🔎 verify round ${round}: ${pending.map((c) => c.name).join(", ")}`);
    const checks = await pool(pending, 4, (c) => checkCommand(spec, c).catch((e): Check => ({ name: c.name, ok: false, reason: (e as Error).message })));
    for (const ch of checks) {
      log(`  ${ch.ok ? "✓" : "✗"} ${ch.name}${ch.reason ? `: ${ch.reason}` : ""}${ch.ms ? ` (${ch.ms} ms)` : ""}`);
      const prev = passedBefore.get(ch.name);
      if (!ch.ok && prev) {
        // The review's "improvement" broke a working command: keep the original.
        log(`  ↩ ${ch.name}: review change failed, keeping the version that passed`);
        cmds[cmds.findIndex((x) => x.name === ch.name)] = prev;
        ch.ok = true;
        ch.reason = undefined;
        ch.fatal = true; // not repaired further
      }
      const c = cmds.find((x) => x.name === ch.name)!;
      report.set(ch.name, { name: ch.name, verified: ch.ok && !c.mutates, write: c.mutates || undefined, reason: ch.reason, rounds: round, sample: ch.first, resultFields: ch.resultFields });
    }
    const failing = checks.filter((c) => !c.ok && !c.fatal);
    // Round 0 also sends passing reads for review: green but nonsensical output gets fixed too.
    const review = round === 0 && opts.review !== false ? checks.filter((c) => c.ok && c.sample && !cmds.find((x) => x.name === c.name)?.mutates) : [];
    if (round === rounds || (!failing.length && !review.length)) break;
    const items = [...failing, ...review];
    const prompt = `Site: ${spec.startUrl} (${spec.description})\n\n${items
      .map((ch) => {
        const c = cmds.find((x) => x.name === ch.name)!;
        return `### ${ch.ok ? "PASSED, review the output" : `FAILED: ${ch.reason}`}\ncommand: ${JSON.stringify(c)}\n${ch.ok ? `output (first items, after defaultFields): ${ch.sample}` : ch.evidence ?? ""}`;
      })
      .join("\n\n")
      .slice(0, 150_000)}`;
    let answer: { results?: { name: string; action: string; command?: any; reason?: string }[] };
    try {
      answer = await askJson(prompt, "high", 48000, REPAIR_SYSTEM);
    } catch (e) {
      log(`  ✗ repair call failed: ${(e as Error).message}`);
      break;
    }
    const next: CommandSpec[] = [];
    for (const r of answer.results ?? []) {
      const i = cmds.findIndex((x) => x.name === r.name);
      if (i < 0) continue;
      const before = cmds[i];
      if (r.action === "drop") {
        log(`  🗑 ${r.name}: ${r.reason ?? "dropped by repair"}`);
        dropped.push({ ...before, verified: false, verifyNote: r.reason ?? "dropped during repair" });
        cmds.splice(i, 1);
        report.set(r.name, { name: r.name, verified: false, reason: r.reason ?? "dropped", rounds: round + 1 });
        continue;
      }
      if (r.action === "fix" && r.command) {
        const [fixed] = normalizeCommands([{ ...r.command, name: r.command.name ?? before.name }], { url: spec.startUrl });
        if (!fixed) continue;
        if (!fixed.source) fixed.source = before.source;
        fixed.name = before.name; // keep names stable across repairs
        cmds[i] = fixed;
        if (report.get(before.name)?.verified) passedBefore.set(before.name, before);
        log(`  🔧 ${before.name}: ${r.reason ?? "fixed"}`);
        next.push(fixed);
      }
    }
    // Failing commands the model neither fixed nor dropped get one more plain re-check only if changed.
    pending = next;
  }

  // Final sort: verified reads, writes (preview-only), failures to dropped.
  const keep: CommandSpec[] = [];
  for (const c of cmds) {
    const r = report.get(c.name);
    if (!target(c)) {
      keep.push(c);
      continue;
    }
    if (c.mutates) {
      keep.push({ ...c, verified: false, verifyNote: r?.reason ?? "write: dry-run preview only, not sent" });
    } else if (r?.verified) keep.push({ ...c, verified: true, verifyNote: undefined, ...(r.sample ? { sample: r.sample } : {}), ...(r.resultFields ? { resultFields: r.resultFields } : {}) });
    else dropped.push({ ...c, verified: false, verifyNote: r?.reason ?? "not verified" });
  }
  const dedupDropped = dropped.filter((d, i) => dropped.findIndex((x) => x.name === d.name) === i && !keep.some((k) => k.name === d.name));
  return {
    spec: { ...spec, commands: keep, dropped: dedupDropped },
    report: [...report.values()],
  };
}
