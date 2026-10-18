// Prints "ALLOW url" / "DENY url" per candidate start URL (robots.txt for clify / *).
import fs from "node:fs";
import { robotsFor } from "../../src/policy.ts";
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
await Promise.all(
  lines.map(async (l) => {
    const url = l.trim().split(/\s+/)[0];
    const r = await robotsFor(url);
    console.log(`${r.allowed(url) ? "ALLOW" : "DENY "} ${url} (${r.rules} rules)`);
  }),
);
