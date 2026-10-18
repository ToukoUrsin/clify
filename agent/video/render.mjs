// Renders the proof video on the agent's own computer (the InstaBox): builds a
// timeline from real job files and the services' journal, steps a 1920x1080
// page frame by frame in headless Chromium and pipes the frames to ffmpeg.
//
//   node render.mjs plan.json out.mp4
//
// plan.json: { scenes: [ {kind:"card", dur, html} |
//   {kind:"thread", subject, meta, jobs:[main.json, peer.json?], journal: "journal.json",
//    from, until, captions:{ "<mail index>": "text" }, tail } ] }
// journal.json: `journalctl -u clify-agent@main -u clify-agent@peer -o json` lines.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [planFile, outFile] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
const dir = path.dirname(path.resolve(planFile));
const FPS = 30;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MASK = plan.mask ?? {}; // addresses shown differently in the video
const short = (a) => MASK[a] ?? a.replace(/@fine-vale\.primitive\.email$/, "@fine-vale…");

function journal(file, from, until) {
  return fs.readFileSync(path.resolve(dir, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .map((j) => ({ at: Number(j.__REALTIME_TIMESTAMP) / 1000, unit: j._SYSTEMD_UNIT ?? "", msg: String(j.MESSAGE ?? "") }))
    .filter((j) => j.at >= from && j.at <= until && /^\d\d:\d\d:\d\d /.test(j.msg));
}

function lineEvent(j) {
  const peer = j.unit.includes("peer");
  let m = Object.entries(MASK).reduce((x, [a, b]) => x.split(a).join(b), j.msg).replace(/^(\d\d:\d\d:\d\d) /, "").replace(/(--(authenticity_token|csrfmiddlewaretoken) )[\w-]{20,}/g, "$1<csrf>");
  const ts = j.msg.slice(0, 8);
  if (m.length > 170) m = m.slice(0, 167) + "…";
  const cls = /✉/.test(m) ? "mail" : /model claude|model gpt/.test(m) ? "model" : /✗|error/.test(m) ? "err" : /clify ✓|fetch_page ✓|write_file ✓/.test(m) ? "ok" : /new job|waiting|resumed|agent .* on InstaBox|ignored|cc'd/.test(m) ? "sys" : "";
  const html = `<span class="ts">${ts}</span> <span class="${peer ? "peerjob" : "job"}">${peer ? "peer" : "main"}</span> ${esc(m).replace(/\[(job-[0-9a-f]+)\]/, `<span class="${peer ? "peerjob" : "job"}">[$1]</span>`)}`;
  return { at: j.at, type: "line", cls, html };
}

function mailEvents(job, roleOf) {
  return job.mail.map((m, n) => {
    const r = roleOf(m);
    const body = m.text.replace(/\n*— clify .*$/s, "").replace(/\n*---------- Forwarded thread[\s\S]*$/, "\n\n[forwarded thread attached below in the email]").trim();
    return {
      at: Date.parse(m.at), type: "mail", n, role: r.role, badge: r.badge, fromName: r.name, from: short(m.from), to: m.to.map(short).join(", "), cc: m.cc?.length ? m.cc.map(short).join(", ") : "",
      subject: m.subject, time: m.at.slice(11, 19) + " UTC", body: body.length > 1100 ? body.slice(0, 1080) + " …" : body, attachments: m.attachments,
    };
  });
}

function threadScene(s) {
  const jobs = s.jobs.map((f) => JSON.parse(fs.readFileSync(path.resolve(dir, f), "utf8")));
  const main = jobs[0];
  const names = s.names ?? {};
  const roleOf = (m) => {
    const a = m.from.toLowerCase();
    if (a.startsWith("clify@")) return { role: "agent", badge: "agent", name: "clify agent" };
    if (a.includes("inkboxmail")) return { role: "peer", badge: "peer agent", name: "clify research agent" };
    if (a === s.human) return { role: "human", badge: "human", name: "Touko" };
    return { role: "req", badge: "requester", name: names[a] ?? a.split("@")[0] };
  };
  let ev = mailEvents(main, roleOf);
  // The peer's own view adds nothing new to the thread; its log lines tell its side.
  const from = (s.from ? Date.parse(s.from) : Date.parse(main.createdAt)) - 1500;
  const until = s.until ? Date.parse(s.until) : Date.parse(main.updatedAt) + 4000;
  ev = ev.concat(journal(s.journal, from, until).map(lineEvent)).sort((a, b) => a.at - b.at || (a.type === "mail" ? 1 : -1));
  // Compress real time: quick log lines, a reading pause after each email.
  let t = 0.8, prev = ev[0]?.at ?? 0, hold = 0;
  const out = [];
  for (const e of ev) {
    const gap = (e.at - prev) / 1000;
    t += Math.max(e.type === "mail" ? 0.6 : 0.07, Math.min(e.type === "mail" ? 1.0 : 0.45, gap * 0.06)) + hold;
    hold = 0;
    prev = e.at;
    out.push({ ...e, t });
    if (e.type === "mail") {
      hold = Math.min(s.maxHold ?? 4.8, 2.0 + e.body.length / 300);
      const cap = s.captions?.[e.n];
      if (cap) out.push({ type: "cap", t, text: cap });
    }
  }
  // A caption stays until the next email appears.
  out.forEach((e, k) => {
    if (e.type === "cap") e.until = out.slice(k + 1).find((x) => x.type === "mail")?.t;
  });
  return { kind: "thread", subject: s.subject ?? main.subject, meta: s.meta ?? "", ttl: s.ttl, events: out, dur: t + hold + (s.tail ?? 1.5) };
}

const scenes = plan.scenes.map((s) => (s.kind === "card" ? s : threadScene(s)));
const total = scenes.reduce((a, s) => a + s.dur, 0);
console.log(`scenes: ${scenes.map((s) => s.dur.toFixed(1)).join(" + ")} = ${total.toFixed(1)} s`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.CLIFY_CHROME || "/usr/bin/chromium" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("file://" + path.resolve(path.dirname(new URL(import.meta.url).pathname), "scene.html"));
await page.evaluate((d) => { window.DATA = d; }, { scenes: scenes.map((s) => ({ ...s, events: s.events?.map(({ at, ...e }) => e) })) });
await page.evaluate(() => document.fonts.ready);
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outFile], { stdio: ["pipe", "inherit", "inherit"] });
const frames = Math.ceil(total * FPS);
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => window.setTime(t), f / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 300 === 0) console.log(`frame ${f}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`wrote ${outFile} (${frames} frames, ${total.toFixed(1)} s)`);
