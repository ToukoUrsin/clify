// Smoke test: start a browser sandbox, connect over CDP, load a page, delete it.
import { chromium } from "playwright";
import { startBrowser, remove } from "./sandbox.mjs";
const name = process.argv[2] || "clify-smoke";
try {
  const b = await startBrowser(name, { ttl: "30m" });
  console.log("sandbox", b.name, b.region, b.chrome, `${b.startMs} ms`);
  const t0 = Date.now();
  const browser = await chromium.connectOverCDP(b.cdpUrl, { headers: b.cdpHeaders, timeout: 90_000 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(process.argv[3] || "https://example.com/");
  console.log("title", await page.title(), "ua", await page.evaluate(() => navigator.userAgent), `${Date.now() - t0} ms`);
  await browser.close();
} finally {
  console.log("deleted", await remove(name));
}
