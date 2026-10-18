// Site policy for exploration: robots.txt (the exploring browser is a crawler,
// so it obeys the site's rules for "clify" or "*") and the real-identity social
// networks where clify never sends a write while exploring.
import { USER_AGENT } from "./runtime.ts";

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface Robots {
  allowed(url: string): boolean;
  rules: number;
  sitemaps: string[];
}

const SOCIAL_RE = /(^|\.)(linkedin\.com|x\.com|twitter\.com|facebook\.com|fb\.com|instagram\.com|threads\.net|tiktok\.com|snapchat\.com|bsky\.app|mastodon\.social)$/i;

export function isSocialNetwork(url: string): boolean {
  try {
    return SOCIAL_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Google-style matching: * wildcard, $ end anchor, longest match wins, Allow wins ties.
function matches(pattern: string, path: string): boolean {
  const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return re.test(path);
}

export function parseRobots(text: string, agent = "clify"): { rules: Rule[]; sitemaps: string[] } {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  const sitemaps: string[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") {
      sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.rules.push({ allow: false, pattern: val });
    if (key === "allow" && val) cur.rules.push({ allow: true, pattern: val });
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const pick = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  return { rules: pick.flatMap((g) => g.rules), sitemaps };
}

export function robotsFrom(text: string): Robots {
  const { rules, sitemaps } = parseRobots(text);
  return {
    rules: rules.length,
    sitemaps,
    allowed(url: string) {
      let path: string;
      try {
        const u = new URL(url);
        path = u.pathname + u.search;
      } catch {
        return true;
      }
      if (path === "/robots.txt") return true;
      let best: Rule | null = null;
      for (const r of rules) {
        if (!matches(r.pattern, path)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
      return !best || best.allow;
    },
  };
}

const cache = new Map<string, Promise<Robots>>();

// Missing or unreadable robots.txt = everything allowed (the standard reading);
// a 401/403 on robots.txt itself = treat the whole site as disallowed.
export function robotsFor(url: string): Promise<Robots> {
  const origin = new URL(url).origin;
  let p = cache.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(origin + "/robots.txt", { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
        if (res.status === 401 || res.status === 403) return robotsFrom("User-agent: *\nDisallow: /");
        if (!res.ok) return robotsFrom("");
        const text = await res.text();
        // An HTML page served for /robots.txt is not a robots file.
        return robotsFrom(/<html/i.test(text.slice(0, 500)) ? "" : text);
      } catch {
        return robotsFrom("");
      }
    })();
    cache.set(origin, p);
  }
  return p;
}
