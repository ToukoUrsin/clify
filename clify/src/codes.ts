// Verification codes and links from the agent's own inbox and phone. After a
// signup or login step, wait for a new message to the identity, then pull the
// one-time code or the confirm/magic link out of it.
import { parse as parseHtml } from "node-html-parser";
import { hasPhone, listMail, listSms, mailBody, type Mail, type Sms } from "./identity.ts";
import { siteRoot } from "./runtime.ts";
import { log } from "./store.ts";

export interface WaitOptions {
  after: Date; // only messages received at/after this time
  to?: string; // the address the account was registered with
  site?: string; // site host/name: prefer mail from this domain or mentioning it
  timeoutMs?: number;
  exclude?: string[]; // message ids already used
}

export interface Found {
  mail: Mail;
  code?: string;
  link?: string;
  links: { url: string; text: string; score: number }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function siteTokens(site?: string): string[] {
  if (!site) return [];
  let host = site;
  try {
    host = new URL(site.includes("://") ? site : `https://${site}`).hostname;
  } catch {
    /* plain name */
  }
  const root = host.includes(".") ? siteRoot(host) : host;
  return [root.toLowerCase(), root.split(".")[0].toLowerCase()].filter((x) => x.length >= 3);
}

function relevance(m: Mail, site?: string): number {
  const toks = siteTokens(site);
  if (!toks.length) return 1;
  const from = `${m.from} ${m.fromName ?? ""}`.toLowerCase();
  const hay = `${m.subject} ${m.snippet ?? ""}`.toLowerCase();
  if (toks.some((t) => from.includes(t))) return 3;
  if (toks.some((t) => hay.includes(t))) return 2;
  return 0;
}

// Waits for the newest matching message. Mail to a per-site address is always
// that site's; mail to the shared inbox must come from or mention the site.
export async function waitForMail(o: WaitOptions): Promise<Mail | null> {
  const deadline = Date.now() + (o.timeoutMs ?? 120_000);
  const perSite = !!o.to && !/inkboxmail\.com$/i.test(o.to);
  while (Date.now() < deadline) {
    const left = Math.max(1, Math.floor((deadline - Date.now()) / 1000));
    const mails = await listMail(o.after, { to: o.to, wait: Math.min(20, left) }).catch((e) => {
      log(`  inbox error: ${(e as Error).message}`);
      return [] as Mail[];
    });
    const fresh = mails.filter((m) => !o.exclude?.includes(m.id) && !/^no-reply@inkboxmail\.com$/i.test(m.from));
    const ranked = fresh.map((m) => ({ m, r: perSite ? 1 + relevance(m, o.site) : relevance(m, o.site) })).filter((x) => x.r > 0);
    ranked.sort((a, b) => b.r - a.r || b.m.receivedAt.localeCompare(a.m.receivedAt));
    if (ranked.length) return mailBody(ranked[0].m);
    await sleep(3000);
  }
  return null;
}

// ── Extraction ────────────────────────────────────────────────────────────
const CODE_WORDS = /(code|otp|one[- ]time|verification|verify|confirm|pin|passcode|token|security|login|sign[- ]?in|2fa|two[- ]factor)/i;

function htmlToText(html: string): string {
  return parseHtml(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).textContent.replace(/[ \t\r]+/g, " ").replace(/\n\s*\n+/g, "\n");
}

// Picks the most code-like token: 4-8 digits (or 6-8 mixed upper alnum), close
// to words like "code"/"verify", standing alone, not a year/price/phone/zip.
export function extractCode(text: string, html = ""): string | undefined {
  const body = [text, html ? htmlToText(html) : ""].join("\n");
  const cands: { code: string; score: number }[] = [];
  const re = /(?<![\w./:#@$€£-])([0-9]{4,8}|[0-9]{3}[ -][0-9]{3}|(?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w/@%-]|\.\d)/g;
  for (const m of body.matchAll(re)) {
    const raw = m[1];
    const code = raw.replace(/[ -]/g, "");
    const at = m.index ?? 0;
    const before = body.slice(Math.max(0, at - 120), at);
    const after = body.slice(at + raw.length, at + raw.length + 60);
    let score = 0;
    if (CODE_WORDS.test(before)) score += 5;
    if (/(code|otp|pin)\s*(is|:)?\s*$/i.test(before)) score += 4;
    if (/^\s*(is your|is the)/i.test(after)) score += 4;
    if (/\n\s*$/.test(before) && /^\s*\n/.test(after)) score += 2; // on its own line
    if (/^\d+$/.test(code)) {
      score += code.length === 6 ? 3 : code.length === 4 || code.length === 8 ? 1 : 0;
      if (/^(19|20)\d\d$/.test(code)) score -= 6; // a year
      if (/(\+|tel|phone|call|fax|suite|street|st\.|ave|po box|zip)\W*$/i.test(before)) score -= 6;
      if (/^\s*(px|%|usd|eur|kb|mb|ms|\$)/i.test(after)) score -= 6;
    } else {
      if (!CODE_WORDS.test(before)) score -= 4; // random caps words need context
      if (/^[A-Z]+$/.test(code)) score -= 10;
    }
    if (/unsubscribe|copyright|©|all rights/i.test(before.slice(-40))) score -= 5;
    cands.push({ code, score });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] && cands[0].score >= 3 ? cands[0].code : undefined;
}

const LINK_GOOD = /(verif|confirm|activat|validate|magic|sign[-_]?in|log[-_]?in|auth|token|complete|finish|welcome|get[-_ ]?started|email[-_]?link|onboard)/i;
const LINK_BAD = /(unsubscribe|preferences|privacy|terms|policy|support|help|twitter|facebook|linkedin|instagram|youtube|github\.com\/[^/]+$|mailto:|\.(png|jpe?g|gif|svg)(\?|$)|list-manage|optout|opt-out|report|abuse)/i;

export function extractLinks(text: string, html = ""): { url: string; text: string; score: number }[] {
  const seen = new Map<string, { url: string; text: string; score: number }>();
  const add = (url: string, label: string) => {
    url = url.trim().replace(/&amp;/g, "&").replace(/[)>.,]+$/, "");
    if (!/^https?:\/\//i.test(url)) return;
    let score = 0;
    if (LINK_GOOD.test(label)) score += 6;
    if (LINK_GOOD.test(url)) score += 4;
    if (/[?&](token|code|key|hash|t|k|confirmation_token|verification)=/i.test(url) || /\/[A-Za-z0-9_-]{24,}/.test(url)) score += 3;
    if (LINK_BAD.test(url) || LINK_BAD.test(label)) score -= 10;
    const prev = seen.get(url);
    if (!prev || prev.score < score) seen.set(url, { url, text: label.slice(0, 80), score });
  };
  if (html) {
    const root = parseHtml(html);
    for (const a of root.querySelectorAll("a[href]")) add(a.getAttribute("href") ?? "", a.textContent.replace(/\s+/g, " ").trim());
  }
  for (const m of (text || "").matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const at = m.index ?? 0;
    add(m[0], text.slice(Math.max(0, at - 80), at));
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

export function inspect(mail: Mail): Found {
  const links = extractLinks(mail.text ?? "", mail.html ?? "");
  const code = extractCode(`${mail.subject}\n${mail.text ?? ""}`, mail.text ? "" : mail.html ?? "");
  const link = links[0] && links[0].score >= 4 ? links[0].url : undefined;
  return { mail, code, link, links: links.slice(0, 8) };
}

// Waits for the verification message and extracts what it carries.
export async function waitForVerification(o: WaitOptions): Promise<Found | null> {
  const mail = await waitForMail(o);
  if (!mail) return null;
  const f = inspect(mail);
  log(`  📨 ${mail.provider}: "${mail.subject}" from ${mail.from}${f.code ? " · code found" : ""}${f.link ? " · link found" : ""}`);
  return f;
}

export async function waitForSmsCode(o: { after: Date; timeoutMs?: number; exclude?: string[] }): Promise<{ sms: Sms; code?: string } | null> {
  if (!hasPhone()) throw new Error("no phone number: the agent identity has no SMS number");
  const deadline = Date.now() + (o.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const rows = (await listSms(o.after)).filter((s) => !o.exclude?.includes(s.id));
    if (rows.length) return { sms: rows[0], code: extractCode(rows[0].text) };
    await sleep(4000);
  }
  return null;
}
