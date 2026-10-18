// Reads vault-export's JSON on stdin and writes it into this computer's own
// clify vault ($CLIFY_HOME/vault.enc, with a new key made here). Prints only
// what was imported, never values.
import { getIdentity, listSiteSecrets, setIdentity, setSite, vaultKey } from "../../clify/src/vault.ts";
let raw = "";
for await (const c of process.stdin) raw += c;
const d = JSON.parse(raw);
setIdentity(d.identity);
for (const [name, s] of Object.entries(d.sites ?? {})) setSite(name, s as any);
const i = getIdentity()!;
console.log(JSON.stringify({ ok: true, keyStore: vaultKey().store, identity: { name: i.name, email: i.email, aliasDomain: i.aliasDomain, phone: i.phone ? "set" : undefined, providers: Object.keys(i.apiKeys ?? {}) }, sites: Object.keys(listSiteSecrets()) }));
