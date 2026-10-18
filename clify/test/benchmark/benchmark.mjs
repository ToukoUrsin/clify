#!/usr/bin/env node
// Read-only real-site comparison: the same task through Clify's CLI and a
// direct headless browser. This measures repeatable task completion, not a
// claim that either path is universally perfect.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const root = new URL("../..", import.meta.url).pathname;
const clify = `${root}/bin/clify`;
const home = process.env.CLIFY_HOME || path.join(os.tmpdir(), `clify-bench-${process.pid}`);
process.env.CLIFY_HOME = home;
fs.mkdirSync(path.join(home, "sites", "books"), { recursive: true });
fs.copyFileSync(`${root}/test/real/books.spec.json`, path.join(home, "sites", "books", "spec.json"));
const trials = Number(process.env.CLIFY_BENCH_TRIALS || 5);
const expected = 3;

function percentile(xs, p) {
  const ys = [...xs].sort((a, b) => a - b);
  return ys[Math.min(ys.length - 1, Math.floor((ys.length - 1) * p))];
}

function clifyTask() {
  const started = performance.now();
  const raw = execFileSync(clify, ["books", "list-category", "--category", "mystery_3", "--limit", String(expected), "--fields", "title,price"], {
    cwd: root,
    env: { ...process.env, CLIFY_QUIET: "1" },
    encoding: "utf8",
  });
  const result = JSON.parse(raw);
  const ok = result.ok === true && Array.isArray(result.data) && result.data.length === expected && result.data.every((x) => x.title && x.price);
  return { ok, elapsedMs: performance.now() - started, actions: 1 };
}

async function directBrowserTask(browser) {
  const started = performance.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  try {
    await page.goto("https://books.toscrape.com/catalogue/category/books/mystery_3/index.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    const rows = await page.locator("article.product_pod").evaluateAll((els) => els.slice(0, 3).map((el) => ({
      title: el.querySelector("h3 a")?.getAttribute("title") || "",
      price: el.querySelector(".price_color")?.textContent?.trim() || "",
    })));
    return { ok: rows.length === expected && rows.every((x) => x.title && x.price), elapsedMs: performance.now() - started, actions: 2 };
  } finally {
    await page.close();
  }
}

const clifyRuns = [];
const directRuns = [];
const browser = await chromium.launch({ headless: true });
try {
  for (let i = 0; i < trials; i++) {
    clifyRuns.push(clifyTask());
    directRuns.push(await directBrowserTask(browser));
  }
} finally {
  await browser.close();
}

function summarize(runs) {
  const times = runs.map((x) => x.elapsedMs);
  return {
    trials: runs.length,
    passed: runs.filter((x) => x.ok).length,
    successRate: runs.filter((x) => x.ok).length / runs.length,
    p50Ms: Math.round(percentile(times, 0.5)),
    p95Ms: Math.round(percentile(times, 0.95)),
    avgActions: runs.reduce((a, x) => a + x.actions, 0) / runs.length,
  };
}

const report = {
  task: "first 3 Mystery books with title and price",
  site: "https://books.toscrape.com",
  trials,
  clify: summarize(clifyRuns),
  directBrowser: summarize(directRuns),
  interpretation: "This is a bounded read-only comparison on one public site; report exact n and timings, not universal perfection.",
};
const reportFile = process.env.CLIFY_BENCH_RESULTS || `${root}/test/benchmark/last-run.json`;
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
