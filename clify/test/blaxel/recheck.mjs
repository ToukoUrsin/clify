// Re-runs the in-sandbox `clify check` for sites of an earlier run (fresh
// sandbox, no browser, no model calls) and updates their records.
//   node test/blaxel/recheck.mjs OUT_DIR tag [tag...]      (tag = record file name without .json)
import fs from "node:fs";
import path from "node:path";
import { SandboxInstance } from "@blaxel/core";
import { checkInSandbox, remove, REGION, IMAGE } from "./sandbox.mjs";

const [out, ...tags] = process.argv.slice(2);
const BUNDLE = process.env.CLIFY_BUNDLE || "/tmp/clify-bundle.tgz";
for (const tag of tags) {
  const file = path.join(out, `${tag}.json`);
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  const spec = JSON.parse(fs.readFileSync(path.join(out, "home", "sites", rec.add.site, "spec.json"), "utf8"));
  const name = `${rec.sandbox}-rc`.slice(0, 45);
  await remove(name);
  const sb = await SandboxInstance.create({ name, image: IMAGE, memory: 2048, region: REGION, ttl: "30m", labels: { app: "clify" } });
  try {
    const c = await checkInSandbox(sb, BUNDLE, spec);
    const reads = new Set(spec.commands.filter((x) => !x.mutates).map((x) => x.name));
    const results = c.out?.results ?? [];
    rec.check = {
      on: "blaxel",
      sandbox: name,
      node: c.node,
      seconds: Math.round(c.ms / 1000),
      reads: reads.size,
      verified: results.filter((r) => r.ok && reads.has(r.name)).length,
      failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, reason: (r.reason ?? "").slice(0, 160) })),
      results,
      ...(c.err ? { error: c.err } : {}),
      ...(c.out && !c.out.results ? { raw: JSON.stringify(c.out).slice(0, 400) } : {}),
    };
    rec.rechecked = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
    console.log(tag, `${rec.check.verified}/${rec.check.reads}`, rec.check.error ?? rec.check.raw ?? "");
  } finally {
    await remove(name);
  }
}
