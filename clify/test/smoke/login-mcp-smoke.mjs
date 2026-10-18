import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [bin, url] = process.argv.slice(2);
const client = new Client({ name: "login-smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: bin, args: ["mcp"], env: { ...process.env } }));
const listed = await client.listTools();
if (!listed.tools.some((t) => t.name === "clify__login")) throw new Error("clify__login missing");
const result = await client.callTool({ name: "clify__login", arguments: { site: "fixture", url } });
const text = result.content?.[0]?.text || "";
if (result.isError || !text.includes('"loggedIn":true')) throw new Error(text);
if (text.includes(process.env.CLIFY_PASSWORD || "__missing__")) throw new Error("password leaked in MCP result");
console.log("PASS MCP login tool: listed, filled, submitted, and returned no credential");
await client.close();
