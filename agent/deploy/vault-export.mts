// Prints (to stdout, for a pipe into vault-import on the agent's computer) only
// what one agent needs from a bigger clify vault. Never run it to a terminal.
//
//   CLIFY_HOME=<source> node --import tsx vault-export.mts main updown,healthchecks
//   CLIFY_HOME=<source> node --import tsx vault-export.mts peer
const [, , role, sites = ""] = process.argv;
const { getIdentity, getSite } = await import(`${process.env.CLIFY_SRC ?? "../../clify/src"}/vault.ts`);
if (process.stdout.isTTY) throw new Error("refusing to print secrets to a terminal; pipe it into vault-import");
const i = getIdentity();
if (!i) throw new Error("no identity in the source vault");
const out: any = {};
if (role === "peer") {
  // The peer only gets its own mailbox.
  out.identity = { name: "clify research agent", email: i.email, emailProvider: "inkbox", handle: i.handle, inboxId: i.inboxId, apiKeys: { inkbox: i.apiKeys?.inkbox } };
} else {
  out.identity = i;
  out.sites = Object.fromEntries(sites.split(",").filter(Boolean).map((s) => [s, getSite(s)]).filter(([, v]) => v));
}
process.stdout.write(JSON.stringify(out));
