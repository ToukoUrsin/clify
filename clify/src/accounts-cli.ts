// Accounts and agent identity commands. cli.ts hands these words to run():
//
//   clify identity [init]                  the agent identity (no secrets); init imports provider keys
//   clify inbox [--sms] [--wait N] [--to ADDR] [--since 2h] [--full]
//                                          latest mail to the agent (debugging)
//   clify signup <site> --url URL [--email main|site] [--terms-url U] [--max-steps N]
//   clify login <site> [--user] [--url URL] [--totp]
//        --user: your own account. Username/password from CLIFY_USERNAME/CLIFY_PASSWORD,
//        --username-cmd/--password-cmd CMD (a command that prints it, e.g. "op read op://vault/site/password"), or a hidden prompt. 2FA secret: CLIFY_TOTP
//        or --totp (hidden prompt). Stored encrypted in the vault.
//   clify verify <site>                    open a late confirmation link from the inbox
//   clify logout <site>                    drop the saved session (keeps credentials)
//   clify whoami <site> [--url URL]        ensure a working session, print the account's own data
//   clify session <site> [check|refresh]
//   clify vault list | show <site> | rm <site>
//   clify ask | forward | approve ...      ask a human (src/ask-cli.ts)
//   signup/login --ask-human [--to ...] [--wait 30m]: on a CAPTCHA or other
//        blocker, email the human and continue from their reply (skip, use
//        their own login, or retry once)
import { execFileSync } from "node:child_process";
import { ensureAccount, ensureMeCommand, signupWithIdentity, verifyByEmail } from "./accounts.ts";
import { describeIdentity, describeSite, getIdentity, getSite, listSiteSecrets, removeSite, setSite, vaultKey, VAULT_FILE } from "./vault.ts";

export const ACCOUNT_COMMANDS = new Set(["identity", "inbox", "signup", "verify", "login", "logout", "whoami", "session", "vault", "ask", "forward", "approve"]);

// --ask-human: a blocker a person can clear (not a terms ban) goes to the human.
async function askHuman(site: string, url: string, doing: string, r: { blockers: string[]; blockedShot?: string; flow?: { blockedShot?: string } }, argv: string[]) {
  if (!r.blockers.length || r.blockers.some((b) => /^(terms|social-network)/.test(b))) return undefined;
  const { askOnBlocker } = await import("./ask.ts");
  const { askFlags, parseArgs } = await import("./ask-cli.ts");
  const { flags, lists } = parseArgs(argv);
  const shot = r.blockedShot ?? r.flow?.blockedShot;
  return askOnBlocker({ site, url, doing, blockers: r.blockers, ...(shot ? { shot } : {}), ...askFlags(flags, lists) });
}

function out(v: unknown, code = 0): never {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  process.exit(code);
}

function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = "true";
  }
  return { pos, flags };
}

// Reads a line from the terminal without echoing it.
async function hiddenPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`${label}: no terminal for a hidden prompt; use env vars or --*-cmd`);
  process.stderr.write(label);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(buf);
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          return reject(new Error("cancelled"));
        }
        if (c === "\u007f") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on("data", onData);
  });
}

// --username-cmd / --password-cmd / --totp-cmd: a command that prints the secret
// (a password manager CLI); its output is used once and never printed.
function fromCmd(cmd: string): string {
  return execFileSync("/bin/sh", ["-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function parseSince(s?: string): Date {
  if (!s) return new Date(Date.now() - 24 * 3600_000);
  const m = s.match(/^(\d+)([smhd])$/);
  if (m) return new Date(Date.now() - Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s"]! * 1000);
  return new Date(s);
}

export async function run(argv: string[]): Promise<void> {
  const { pos, flags } = parse(argv);
  const [cmd, site, sub] = pos;
  if (cmd === "ask" || cmd === "forward" || cmd === "approve") return (await import("./ask-cli.ts")).run(argv);
  try {
    switch (cmd) {
      case "identity": {
        if (site === "init") {
          const { initIdentity } = await import("./identity.ts");
          const r = await initIdentity({ removeKeyFiles: flags["keep-key-files"] !== "true" });
          out({ ok: true, identity: describeIdentity(r.identity), imported: r.imported, notes: r.notes, vault: VAULT_FILE, keyStore: vaultKey().store });
        }
        const i = getIdentity();
        if (!i) out({ ok: false, error: "no agent identity yet; run: clify identity init" }, 1);
        out({ ok: true, identity: describeIdentity(i), accounts: Object.keys(listSiteSecrets()).length });
      }
      case "inbox": {
        if (flags.sms === "true") {
          const { listSms } = await import("./identity.ts");
          const { extractCode } = await import("./codes.ts");
          const after = parseSince(flags.since);
          let rows = await listSms(after);
          const deadline = Date.now() + Number(flags.wait ?? 0) * 1000;
          while (!rows.length && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 4000));
            rows = await listSms(after);
          }
          out({ ok: true, phone: getIdentity()?.phone, count: rows.length, texts: rows.slice(0, Number(flags.limit ?? 10)).map((t) => ({ ...t, code: extractCode(t.text) })) });
        }
        const { listMail, mailBody } = await import("./identity.ts");
        const { inspect } = await import("./codes.ts");
        const after = parseSince(flags.since);
        let mails = await listMail(after, { to: flags.to });
        if (!mails.length && flags.wait) {
          const deadline = Date.now() + Number(flags.wait) * 1000;
          while (!mails.length && Date.now() < deadline) mails = await listMail(after, { to: flags.to, wait: Math.min(25, Math.ceil((deadline - Date.now()) / 1000)) });
        }
        const limit = Number(flags.limit ?? 10);
        const rows = [];
        for (const m of mails.slice(0, limit)) {
          const full = await mailBody(m);
          const f = inspect(full);
          rows.push({
            provider: m.provider,
            receivedAt: m.receivedAt,
            from: m.from,
            to: m.to,
            subject: m.subject,
            ...(f.code ? { code: f.code } : {}),
            ...(f.link ? { verifyLink: f.link } : {}),
            ...(flags.full === "true" ? { text: (full.text || "").slice(0, 4000) } : { snippet: (m.snippet || full.text || "").replace(/\s+/g, " ").slice(0, 200) }),
          });
        }
        out({ ok: true, count: mails.length, messages: rows });
      }
      case "signup": {
        if (!site || !flags.url) out({ ok: false, error: "usage: clify signup <site> --url https://site/ [--email main|site] [--terms-url URL]" }, 1);
        const go = () => signupWithIdentity({ name: site, url: flags.url, email: flags.email as any, termsUrl: flags["terms-url"], goal: flags.goal, maxSteps: flags["max-steps"] ? Number(flags["max-steps"]) : undefined });
        let r = await go();
        let human = !r.ok && flags["ask-human"] === "true" ? await askHuman(site, flags.url, "signing up with its own agent identity", r, argv) : undefined;
        if (human?.action === "retry") {
          r = await go();
          if (!r.ok) human = { ...human, next: `retried once on ${human.answeredBy}'s word; still blocked: ${r.blockers.join("; ")}` };
        }
        out(
          {
            ok: r.ok,
            site,
            email: r.email,
            terms: { allowed: r.terms.allowed, reason: r.terms.reason, ...(r.terms.quote ? { quote: r.terms.quote } : {}), checked: r.terms.checked },
            signedUp: r.signedUp,
            loggedIn: r.loggedIn,
            verified: r.verified,
            verificationChannel: r.verificationChannel,
            steps: r.steps,
            blockers: r.blockers,
            sessionWorksOverHttp: r.session?.valid ?? false,
            ...(r.ok ? { next: `clify whoami ${site}  |  clify ${site} me` } : {}),
            ...(human ? { human } : {}),
          },
          r.ok ? 0 : 1,
        );
      }
      case "login": {
        if (!site) out({ ok: false, error: "usage: clify login <site> [--user] [--url URL]" }, 1);
        const envUser = process.env[flags["username-env"] ?? "CLIFY_USERNAME"];
        const envPass = process.env[flags["password-env"] ?? "CLIFY_PASSWORD"];
        const user = flags.user === "true" || !!(envUser && envPass);
        if (user) {
          const username = flags["username-cmd"] ? fromCmd(flags["username-cmd"]) : envUser ?? (await hiddenPrompt("username or email: "));
          const password = flags["password-cmd"] ? fromCmd(flags["password-cmd"]) : envPass ?? (await hiddenPrompt("password: "));
          const totp = process.env.CLIFY_TOTP ?? (flags.totp === "true" ? await hiddenPrompt("2FA secret (base32 or otpauth://): ") : flags["totp-cmd"] ? fromCmd(flags["totp-cmd"]) : undefined);
          const prev = getSite(site);
          setSite(site, {
            username,
            email: username.includes("@") ? username : prev?.email,
            password,
            ...(totp ? { totp } : {}),
            createdBy: "user",
            ...(flags.url ? { loginUrl: flags.url, origin: new URL(flags.url).origin } : {}),
            session: undefined,
          });
        }
        const sec = getSite(site);
        const url = flags.url ?? sec?.loginUrl ?? sec?.origin;
        if (!url) out({ ok: false, error: `no URL for ${site}; pass --url` }, 1);
        if (flags.url) setSite(site, { loginUrl: flags.url, origin: sec?.origin ?? new URL(flags.url).origin });
        if (flags.fresh === "true" || user) setSite(site, { session: undefined });
        const go = () => ensureAccount({ name: site, url, mode: user ? "user" : sec?.createdBy === "agent" ? "agent" : "user", goal: flags.goal, maxSteps: flags["max-steps"] ? Number(flags["max-steps"]) : undefined });
        let r = await go();
        let human = !r.ok && flags["ask-human"] === "true" ? await askHuman(site, url, "logging in", r, argv) : undefined;
        if (human?.action === "retry") {
          r = await go();
          if (!r.ok) human = { ...human, next: `retried once on ${human.answeredBy}'s word; still blocked: ${r.blockers.join("; ")}` };
        }
        out({ ok: r.ok, site, loggedIn: r.loggedIn, via: r.via, account: r.account, blockers: r.blockers, sessionWorksOverHttp: r.session?.valid ?? false, ...(human ? { human } : {}) }, r.ok ? 0 : 1);
      }
      case "verify": {
        if (!site) out({ ok: false, error: "usage: clify verify <site>  (opens the latest confirmation link from the agent's inbox)" }, 1);
        const r = await verifyByEmail(site);
        out({ ok: r.ok, site, subject: r.subject, blockers: r.blockers }, r.ok ? 0 : 1);
      }
      case "logout": {
        if (!site || !getSite(site)) out({ ok: false, error: `no vault entry for "${site}"` }, 1);
        setSite(site, { session: undefined, storage: undefined, tokens: undefined });
        out({ ok: true, site, loggedIn: false, note: "session dropped; credentials kept (clify vault rm to delete them)" });
      }
      case "whoami": {
        if (!site) out({ ok: false, error: "usage: clify whoami <site>" }, 1);
        const sec = getSite(site);
        // A public site (no login commands, no saved account): nothing to sign in to.
        if (!sec && !flags.url) {
          const { resolveSite } = await import("./catalog.ts");
          const { readSpec } = await import("./store.ts");
          const name = resolveSite(site);
          const spec = name ? readSpec<{ name: string; auth?: unknown; commands: Array<{ auth?: boolean }> }>(name) : null;
          if (spec && !spec.auth && !spec.commands.some((c) => c.auth))
            out({ ok: true, site: spec.name, account: "none needed", note: `${spec.name} is public: every command works without an account or login.`, next: `clify ${spec.name}` });
        }
        const url = flags.url ?? sec?.origin;
        if (!url) out({ ok: false, error: `no account for ${site}; run: clify signup ${site} --url URL` }, 1);
        const r = await ensureAccount({ name: site, url, mode: (flags.mode as any) ?? "auto" });
        if (!r.ok) out({ ok: false, site, blockers: r.blockers }, 1);
        ensureMeCommand(site);
        out({ ok: true, site, via: r.via, account: r.account, probe: getSite(site)?.probe?.url, status: r.session?.status, data: r.session?.data });
      }
      case "session": {
        if (!site) out({ ok: false, error: "usage: clify session <site> [check|refresh]" }, 1);
        const { checkSession, refreshSession, accessTokenExpiry, rescanTokens } = await import("./session.ts");
        if (sub === "rescan") out({ ok: true, site, tokens: rescanTokens(site).map((t) => `${t.kind}:${t.key}${t.path ? "." + t.path : ""}`) });
        if (sub === "refresh") {
          const before = accessTokenExpiry(getSite(site));
          const r = await refreshSession(site);
          const after = accessTokenExpiry(getSite(site));
          const c = r.ok ? await checkSession(site) : undefined;
          out({ ok: r.ok, site, refreshed: r.ok, reason: r.reason, accessExpBefore: before, accessExpAfter: after, sessionValid: c?.valid }, r.ok ? 0 : 1);
        }
        const c = await checkSession(site);
        out({ ok: c.valid, site, valid: c.valid, status: c.status, reason: c.reason, accessTokenExpires: accessTokenExpiry(getSite(site)) ?? null }, c.valid ? 0 : 1);
      }
      case "vault": {
        if (!site || site === "list") out({ ok: true, vault: VAULT_FILE, keyStore: vaultKey().store, identity: describeIdentity(getIdentity()), sites: Object.entries(listSiteSecrets()).map(([n, s]) => describeSite(n, s)) });
        if (site === "show") {
          const s = sub ? getSite(sub) : null;
          if (!s) out({ ok: false, error: `no vault entry for "${sub}"` }, 1);
          out({ ok: true, ...describeSite(sub, s), terms: s.terms, history: s.history });
        }
        if (site === "rm") {
          if (!sub) out({ ok: false, error: "usage: clify vault rm <site>" }, 1);
          out({ ok: removeSite(sub), removed: sub });
        }
        out({ ok: false, error: "usage: clify vault list | show <site> | rm <site>" }, 1);
      }
      default:
        out({ ok: false, error: `unknown accounts command "${cmd}"` }, 1);
    }
  } catch (e) {
    out({ ok: false, error: (e as Error).message.split("\n")[0] }, 1);
  }
}

// Standalone: node --import tsx src/accounts-cli.ts <command> ...
if (import.meta.url === `file://${process.argv[1]}`) void run(process.argv.slice(2));
