// MCP server smoke test: spawn the stdio server via a real MCP client, list tools, and exercise
// keygen / append / status / verify against a temp log.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dir = mkdtempSync(join(tmpdir(), "bt-mcp-"));
const transport = new StdioClientTransport({
  command: "node",
  args: ["bin/blocktrain-mcp.ts"],
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, BLOCKTRAIN_LOG: join(dir, "log.jsonl"), BLOCKTRAIN_SEALS: join(dir, "seals.json") },
});
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log("ok - tools:", tools.join(", "));
for (const t of ["blocktrain_append", "blocktrain_seal", "blocktrain_verify", "blocktrain_reveal", "blocktrain_status", "blocktrain_keygen"]) {
  assert.ok(tools.includes(t), `missing tool ${t}`);
}

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const kg = parse(await client.callTool({ name: "blocktrain_keygen", arguments: {} }) as never);
assert.ok(kg.pub && kg.wif, "keygen returns pub+wif");
console.log("ok - keygen");

const ap = parse(await client.callTool({ name: "blocktrain_append", arguments: { kind: "payment", data: { to: "acme", sats: 50000 } } }) as never);
assert.equal(ap.seq, 0);
assert.ok(ap.entryHash && ap.linkHash, "append returns hashes");
console.log("ok - append seq 0");

const st = parse(await client.callTool({ name: "blocktrain_status", arguments: {} }) as never);
assert.equal(st.entries, 1);
console.log("ok - status: 1 entry");

const vf = parse(await client.callTool({ name: "blocktrain_verify", arguments: {} }) as never);
assert.equal(vf.ok, true);
assert.equal(vf.count, 1);
console.log("ok - verify ok");

await client.close();
console.log("\nMCP smoke passed");
