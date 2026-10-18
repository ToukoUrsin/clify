// GUI client demo: the mcp-use Inspector (the browser MCP client Manufact
// ships, with a built-in LLM chat) connected to the deployed clify server and
// driven in headless Chromium. Without a sign-in or API key the Inspector chat
// runs on Manufact's hosted model (its model picker shows which); that backend
// calls the clify tools. No key or account of ours is sent. Records a video,
// screenshots, and the chat's own Export (raw/inspector-export.json).
//   npx @mcp-use/inspector --url $CLIFY_MCP_URL --port 8090 --no-open &
//   node inspector-gui.mjs "<task>" > raw/inspector.jsonl
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const task = process.argv[2];
const INSPECTOR = process.env.INSPECTOR_URL ?? "http://localhost:8090/inspector";
const shots = path.join(here, "raw", "inspector");
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: shots, size: { width: 1600, height: 900 } } });
const page = await ctx.newPage();
// The chat stream the page receives holds every tool call with its arguments and result.
const streams = [];
page.on("response", (r) => {
  if (/\/chat\/stream/.test(r.url())) streams.push(r.text().catch(() => ""));
});
const t0 = Date.now();
await page.goto(INSPECTOR, { waitUntil: "load" });
await page.getByText("clify_sites").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.getByText("Chat", { exact: true }).locator("visible=true").first().click();
await page.waitForTimeout(1500);
const box = page.locator("textarea").locator("visible=true").first();
const model = (await page.getByText(/^[a-z-]+\/[\w.-]+$/).locator("visible=true").first().innerText().catch(() => "")).trim();
emit({ type: "meta", client: "mcp-use Inspector (browser GUI, headless Chromium)", server: process.env.CLIFY_MCP_URL, llm: model || "Inspector default" });
await box.click();
// insertText in small chunks: per-key typing drops characters in this textarea.
const words = task.replace(/\s*\n\s*/g, " ").match(/.{1,6}/gs) ?? [];
for (const w of words) {
  await page.keyboard.insertText(w);
  await page.waitForTimeout(25);
}
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shots, "1-typed.png") });
await box.press("Enter");
// Done when the answer holds both values and nothing changes for ~6 s.
let last = "";
let still = 0;
for (let i = 0; i < 120 && still < 4; i++) {
  await page.waitForTimeout(1500);
  const now = await page.locator("main").innerText().catch(() => "");
  still = now === last && /\d:\d\d:\d\d [AP]M[\s\S]*\d:\d\d:\d\d [AP]M/.test(now) ? still + 1 : 0;
  last = now;
}
await page.screenshot({ path: path.join(shots, "2-answer.png") });
// Open each tool call so the video shows what was sent and returned.
const chips = page.locator("text=/^(clify_\\w+|\\w+__[\\w-]+)\\(\\s*\\d+ args?\\s*\\)$/").locator("visible=true");
const n = await chips.count();
if (n) {
  await chips.nth(n - 1).click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shots, "3-last-call.png") });
}
await page.waitForTimeout(500);
const stream = (await Promise.all(streams)).join("\n");
fs.writeFileSync(path.join(here, "raw", "inspector-stream.txt"), stream);
emit({ type: "final", text: last });
emit({ type: "meta", seconds: (Date.now() - t0) / 1000, toolCallChips: n, streamBytes: stream.length });
const video = page.video();
await ctx.close();
await browser.close();
if (video) fs.renameSync(await video.path(), path.join(shots, "session.webm"));
