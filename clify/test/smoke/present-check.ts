// Offline checks for present(): count is the number of rows shown, and a --limit
// that drops rows from this page says so instead of offering a nextPage that skips them.
import { present } from "../../src/core.ts";
import type { RunResult } from "../../src/core.ts";
import type { CommandSpec } from "../../src/types.ts";

const cmd = { name: "search", summary: "", method: "GET", urlTemplate: "/s", params: [], responseType: "json", mutates: false, verified: true } as unknown as CommandSpec;
const res = { ok: true, status: 200, url: "https://t.example/s", data: Array.from({ length: 10 }, (_, i) => ({ id: i })), nextArgs: { page: "2" } } as RunResult;
const fail: string[] = [];
const ok = (c: boolean, m: string) => (c ? console.log(`PASS ${m}`) : (console.log(`FAIL ${m}`), fail.push(m)));
const cut = present(cmd, res, { limit: 3, cli: true }) as any;
ok(cut.count === 3 && cut.data.length === 3, "--limit 3 of 10: count is the shaped length");
ok(!("nextPage" in cut) && cut.more === "7 more rows on this page: raise --limit", "--limit dropped rows: 'more' instead of a nextPage that skips them");
const all = present(cmd, res, { limit: 20, cli: true }) as any;
ok(all.count === 10 && all.nextPage === '--page "2"' && !("more" in all), "limit above the page size: count 10 and nextPage");
const mcp = present(cmd, res, {}) as any;
ok(mcp.count === 10 && mcp.nextPage?.page === "2", "no limit: nextPage args (MCP form)");
const mcpCut = present(cmd, res, { limit: 3 }) as any;
ok(mcpCut.more === "7 more rows on this page: raise limit" && !("nextPage" in mcpCut), "MCP form names the limit argument");
process.exit(fail.length ? 1 : 0);
