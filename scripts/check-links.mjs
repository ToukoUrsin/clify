#!/usr/bin/env node
// Relative links in every Markdown file must point at a file or directory that exists.
//   node scripts/check-links.mjs [ROOT]    ROOT default: this repo; exit 1 on any broken link
// Checks [text](target), ![alt](target), [label]: target and <img|a|video src/href="target">.
// Skips URLs with a scheme (https:, mailto:, ...), pure #anchors and links inside code.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const SKIP_DIRS = new Set([".git", "node_modules", ".mcp-use"]);

function* mdFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* mdFiles(path.join(dir, e.name)); }
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) yield path.join(dir, e.name);
  }
}

// blank out fenced code blocks and inline code so example links in them are not checked
const stripCode = (text) =>
  text.replace(/^(\s*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(`+)[^`\n]*?\1/g, (m) => " ".repeat(m.length));

const LINK = [
  /!?\[(?:[^\]\[]|\[[^\]]*\])*\]\(\s*<([^>]+)>[^)]*\)/g,            // [text](<target>)
  /!?\[(?:[^\]\[]|\[[^\]]*\])*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, // [text](target "title")
  /^\s{0,3}\[[^\]]+\]:\s*<?([^>\s]+)>?/gm,                            // [label]: target
  /<(?:img|a|video|source)\b[^>]*\b(?:src|href)="([^"]+)"/gi,        // inline HTML
];

const broken = [];
let checked = 0;
for (const file of mdFiles(ROOT)) {
  const text = stripCode(fs.readFileSync(file, "utf8"));
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  for (const re of LINK) {
    for (const m of text.matchAll(re)) {
      const raw = m[1].trim();
      if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
      let target = raw.replace(/[#?].*$/, "");
      try { target = decodeURIComponent(target); } catch {}
      const abs = target.startsWith("/") ? path.join(ROOT, target) : path.resolve(path.dirname(file), target);
      checked++;
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs)) broken.push(`${path.relative(ROOT, file)}:${lineOf(m.index)}: ${raw}`);
    }
  }
}

if (broken.length) {
  console.error(`links FAILED: ${broken.length} broken of ${checked} relative links`);
  for (const b of [...new Set(broken)]) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`links OK: ${checked} relative links in Markdown, none broken`);
