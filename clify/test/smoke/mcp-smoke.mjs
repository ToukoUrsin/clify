// MCP smoke: spawn `clify mcp <site>` over stdio, list tools, call a read tool
// and a write tool without confirm (must come back as a preview, nothing sent).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [bin, site, readTool, readArgs, writeTool, writeArgs] = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: bin, args: ["mcp", site], env: { ...process.env } }));
console.log("serverVersion:", client.getServerVersion()?.version);
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => `${t.name}${t.annotations?.destructiveHint ? " (writes)" : ""}`).join(", "));
const r = await client.callTool({ name: readTool, arguments: JSON.parse(readArgs) });
console.log(`${readTool} isError=${!!r.isError}:`, r.content[0].text.slice(0, 300));
if (writeTool) {
  const w = await client.callTool({ name: writeTool, arguments: JSON.parse(writeArgs) });
  console.log(`${writeTool} isError=${!!w.isError}:`, w.content[0].text.slice(0, 400));
}
await client.close();
