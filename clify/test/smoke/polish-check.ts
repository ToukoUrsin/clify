// Offline checks for polish.ts: duplicate commands collapse into aliases,
// account-scoped ids become context defaults, per-object ids do not, and
// delete-like writes get no silent defaults or real ids in their examples.
import { polish } from "../../src/polish.ts";
import { buildRequest, findCommand } from "../../src/core.ts";
import type { CommandSpec, SiteSpec } from "../../src/types.ts";

const P = (name: string, extra: object = {}) => ({ name, in: "path" as const, required: true, type: "string" as const, ...extra });
const cmd = (name: string, url: string, params: any[], example: Record<string, string>, extra: Partial<CommandSpec> = {}): CommandSpec =>
  ({ name, summary: name, method: "GET", urlTemplate: url, params, responseType: "json", mutates: false, verified: true, example, ...extra }) as CommandSpec;
const spec: SiteSpec = {
  name: "t", startUrl: "https://t.example/", origin: "https://t.example", createdAt: "", description: "",
  commands: [
    cmd("get-account", "/v1/account", [], {}),
    cmd("list-tables", "/p/{projectId}/tables", [P("projectId")], { projectId: "prj_1" }),
    cmd("get-table", "/p/{projectId}/tables/{tableId}", [P("projectId"), P("tableId")], { projectId: "prj_1", tableId: "tbl_9" }),
    cmd("get-other-table", "/p/{projectId}/tables/{tableId}", [P("projectId"), P("tableId")], { projectId: "prj_1", tableId: "tbl_8" }),
    cmd("create-table", "/p/{projectId}/tables", [P("projectId"), { name: "name", in: "body", required: true, type: "string" }], { projectId: "prj_1", name: "x" }, { method: "POST", mutates: true, verified: false }),
    cmd("delete-table", "/p/{projectId}/tables/{tableId}", [P("projectId"), P("tableId")], { projectId: "prj_1", tableId: "tbl_gone" }, { method: "DELETE", mutates: true, verified: false }),
    cmd("me", "/v1/account", [], {}),
  ],
};
const out = await polish(structuredClone(spec), { loggedIn: true, live: false, exchanges: [{ method: "GET", url: "https://t.example/p/prj_1/tables", status: 200, requestHeaders: {}, withSession: true }] });
const fail: string[] = [];
const ok = (c: boolean, m: string) => (c ? console.log(`PASS ${m}`) : (console.log(`FAIL ${m}`), fail.push(m)));
ok(out.commands.length === 5 && findCommand(out, "me")?.name === "get-account", "duplicate request collapses into an alias (me -> get-account, get-other-table -> get-table)");
ok(out.context?.projectId?.value === "prj_1", "projectId used on every request becomes account context");
ok(!out.context?.tableId, "per-object id (two values recorded) stays a required flag");
ok(new URL(buildRequest(out, findCommand(out, "create-table")!, { name: "x" }).url).pathname === "/p/prj_1/tables", "context fills the omitted flag");
const del = findCommand(out, "delete-table")!;
ok(!del.params.some((p) => p.context) && del.example?.tableId === "<tableId>", "delete-like write: no context default, placeholder id in the example");
ok(findCommand(out, "list-tables")!.example!.projectId === undefined, "examples leave out context params");
const unseen = await polish(structuredClone(spec), { loggedIn: true, live: false, exchanges: [{ method: "GET", url: "https://t.example/other", status: 200, requestHeaders: {}, withSession: true }] });
ok(!unseen.context?.projectId, "a value missing from the recording is never a context default");
process.exit(fail.length ? 1 : 0);
