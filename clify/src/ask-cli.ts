// Ask-a-human commands. accounts-cli.ts hands these words to run():
//
//   clify ask "<question>" [--to EMAIL|+PHONE] [--via email|sms] [--cc A,B] [--attach shot.png]
//             [--options skip,approve,...] [--site S] [--url U] [--doing "..."] [--wait 30m]
//             [--delegate AGENT@ADDR --delegate-after 10m] [--test]
//        send from the agent's own address/number, wait for the human's verified
//        reply in the same thread, print {answer, decision, thread_id, ...}
//   clify ask resume <id> [--wait 30m]     keep waiting on an earlier ask
//   clify ask show <id> | list
//   clify ask --set-human EMAIL [--phone +1...]    who `clify ask` asks by default
//   clify forward <id|thread_id> --to AGENT@ADDR [--note "..."] [--cc A] [--wait 30m]
//        hand the thread to another agent; its verified reply answers the ask
//   clify approve <site> <command> [--param v ...] [--to ...] [--wait 30m]
//        a write that needs approval: email the exact request, send it only on "approve"
//
// The blocker flows take the same flags behind --ask-human:
//   clify signup <site> --url URL --ask-human [--to ...] [--wait 30m]
//   clify login <site> --ask-human ...
import { approveWrite, ask, forwardAsk, getHuman, listAsks, loadAsk, noticeHuman, setHuman, waitForAnswer, type AskOption, type AskRequest } from "./ask.ts";
import { readJson, siteFile, readSpec } from "./store.ts";
import type { SiteSpec } from "./types.ts";

export const ASK_COMMANDS = new Set(["ask", "forward", "approve"]);

function out(v: unknown, code = 0): never {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  process.exit(code);
}

const MULTI = new Set(["attach", "cc"]);

export function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    let k: string, v: string;
    if (eq > 0) [k, v] = [a.slice(2, eq), a.slice(eq + 1)];
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) [k, v] = [a.slice(2), argv[++i]];
    else [k, v] = [a.slice(2), "true"];
    flags[k] = v;
    if (MULTI.has(k)) (lists[k] ??= []).push(...v.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return { pos, flags, lists };
}

// "30m", "90s", "2h", "1d" or plain seconds → ms
export function duration(s: string | undefined, fallbackMs: number): number {
  if (!s) return fallbackMs;
  const m = String(s).match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/);
  if (!m) throw new Error(`bad duration "${s}" (use e.g. 90s, 30m, 2h)`);
  return Math.round(Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as ""]! * 1000);
}

const oneLine = (s = "") => s.replace(/\s+/g, " ").trim();

const OPTION_LABELS: Record<string, string> = {
  skip: "Skip it; clify moves on",
  approve: "Go ahead",
  deny: "Don't do it",
  retry: "Try again",
  "use-my-account": "Use your own login instead",
};

// The ask flags shared by `ask`, `approve` and the --ask-human hooks.
export function askFlags(flags: Record<string, string>, lists: Record<string, string[]> = {}): Omit<AskRequest, "question"> {
  const cc = lists.cc ?? (flags.cc ? flags.cc.split(",") : []);
  const attach = lists.attach ?? (flags.attach ? flags.attach.split(",") : []);
  return {
    ...(flags.to ? { to: flags.to } : {}),
    ...(flags.via ? { via: flags.via as "email" | "sms" } : {}),
    ...(cc.length ? { cc } : {}),
    ...(attach.length ? { attach } : {}),
    waitMs: duration(flags.wait, 30 * 60_000),
    test: flags.test === "true",
    ...(flags.note ? { note: flags.note } : {}),
    ...(flags["accept-cc"] === "true" ? { acceptFrom: cc } : {}),
    ...(flags.delegate ? { delegate: { to: flags.delegate, afterMs: duration(flags["delegate-after"], 10 * 60_000), note: flags["delegate-note"] } } : {}),
  };
}

const USAGE: Record<string, string[]> = {
  ask: [
    'clify ask "<question>" [--to you@example.com] [--attach shot.png] [--wait 30m] [--via email|sms] [--options skip,retry]',
    "clify ask list | clify ask show <id> | clify ask resume <id> [--wait 30m]",
    "clify ask --set-human you@example.com [--phone +1...]",
  ],
  approve: ["clify approve <site> <command> [--param value ...] [--to you@example.com] [--wait 30m]"],
  forward: ['clify forward <ask-id|thread_id> --to agent@example.com [--note "..."] [--wait 30m]'],
};

export async function run(argv: string[]): Promise<void> {
  const { pos, flags, lists } = parseArgs(argv);
  const [cmd, a1, a2] = pos;
  if (flags.help === "true" && USAGE[cmd]) out({ ok: true, usage: USAGE[cmd], docs: "ACCOUNTS.md" });
  try {
    switch (cmd) {
      case "ask": {
        if (flags["set-human"]) out({ ok: true, human: setHuman({ email: flags["set-human"] === "true" ? undefined : flags["set-human"], phone: flags.phone }) });
        if (a1 === "list") out({ ok: true, human: getHuman(), asks: listAsks().map((r) => ({ id: r.id, at: r.createdAt, via: r.via, to: r.to, site: r.site, status: r.status, decision: r.answer?.decision, subject: r.subject })) });
        if (a1 === "show") {
          if (!a2) out({ ok: false, error: "usage: clify ask show <id>" }, 1);
          out({ ok: true, ask: loadAsk(a2) });
        }
        if (a1 === "resume") {
          if (!a2) out({ ok: false, error: "usage: clify ask resume <id> [--wait 30m]" }, 1);
          const r = await waitForAnswer(loadAsk(a2).id, { waitMs: duration(flags.wait, 30 * 60_000), ...(askFlags(flags, lists).delegate ? { delegate: askFlags(flags, lists).delegate } : {}) });
          out(r, r.ok ? 0 : 1);
        }
        const question = pos.slice(1).join(" ").trim();
        if (!question) out({ ok: false, error: 'usage: clify ask "<question>" [--to you@example.com] [--attach shot.png] [--wait 30m] [--via email|sms]' }, 1);
        const options: AskOption[] | undefined = flags.options?.split(",").map((k) => k.trim()).filter(Boolean).map((k) => ({ key: k, label: OPTION_LABELS[k] ?? k }));
        const r = await ask({ question, ...askFlags(flags, lists), ...(flags.subject ? { subject: flags.subject } : {}), site: flags.site, url: flags.url, doing: flags.doing, blocker: flags.blocker, ...(options ? { options } : {}) });
        if (r.status === "answered" && r.delegated && flags.notify !== "false") await noticeHuman(r.id, `Resolved while you were away: I delegated this to ${r.delegated.to}, who answered: ${oneLine(r.answer)}`);
        out(r, r.ok ? 0 : 1);
      }
      case "forward": {
        if (!a1 || !flags.to) out({ ok: false, error: 'usage: clify forward <ask-id|thread_id> --to agent@example.com [--note "..."] [--wait 30m]' }, 1);
        const rec = loadAsk(a1);
        const f = await forwardAsk(rec.id, flags.to, { note: flags.note, cc: lists.cc });
        if (!flags.wait || flags.wait === "0") out(f);
        const r = await waitForAnswer(rec.id, { waitMs: duration(flags.wait, 30 * 60_000) });
        out(r, r.ok ? 0 : 1);
      }
      case "approve": {
        if (!a1 || !a2) out({ ok: false, error: "usage: clify approve <site> <command> [--param value ...] [--to you@example.com] [--wait 30m]" }, 1);
        const spec = readSpec<SiteSpec>(a1);
        if (!spec) out({ ok: false, error: `unknown site "${a1}"` }, 1);
        const command = spec.commands.find((c) => c.name === a2);
        if (!command) out({ ok: false, error: `unknown command "${a2}"`, commands: spec.commands.map((c) => c.name) }, 1);
        const { run: runCmd, shape } = await import("./runtime.ts");
        const reserved = new Set(["to", "via", "cc", "attach", "wait", "test", "accept-cc", "delegate", "delegate-after", "delegate-note", "fields", "limit", "full", "yes", "note", "notify"]);
        const args = Object.fromEntries(Object.entries(flags).filter(([k]) => !reserved.has(k)));
        const dry = await runCmd(spec, command, args, { confirm: false });
        if (!dry.needsConfirmation) out(dry.ok ? { ok: true, note: `"${a2}" doesn't change data; no approval needed`, status: dry.status, data: dry.data } : dry, dry.ok ? 0 : 1);
        const r = await approveWrite({ site: a1, command: a2, url: dry.preview?.url ?? spec.origin, preview: dry.preview, send: () => runCmd(spec, command, args, { confirm: true }), ...askFlags(flags, lists) });
        const sent = r.result as Awaited<ReturnType<typeof runCmd>> | undefined;
        if (r.ask.delegated && r.ask.status === "answered" && flags.notify !== "false")
          await noticeHuman(r.ask.id, `Resolved while you were away: I delegated this to ${r.ask.delegated.to}, who answered: ${oneLine(r.ask.answer)}\n${sent ? `I sent the request (HTTP ${sent.status}).` : "Nothing was sent."}`);
        out(
          {
            ok: r.ask.status === "answered" && (!sent || sent.ok),
            approved: r.approved,
            sent: r.sent,
            decision: r.ask.decision,
            answer: r.ask.answer,
            answeredBy: r.ask.answeredBy,
            ask: r.ask.id,
            thread_id: r.ask.thread_id,
            ignored: r.ask.ignored,
            preview: dry.preview,
            ...(sent ? { status: sent.status, data: shape(sent.data, { fields: flags.fields?.split(","), limit: flags.limit ? Number(flags.limit) : undefined }) } : {}),
            ...(r.ask.status !== "answered" ? { next: r.ask.next } : {}),
          },
          r.ask.status === "answered" ? 0 : 1,
        );
      }
      default:
        out({ ok: false, error: `unknown ask command "${cmd}"` }, 1);
    }
  } catch (e) {
    out({ ok: false, error: (e as Error).message.split("\n")[0] }, 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void run(process.argv.slice(2));
