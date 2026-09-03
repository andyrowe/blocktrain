#!/usr/bin/env node
// blocktrain MCP server — one door for any agent framework (OpenClaw, Claude Code, Hermes via a
// bridge, …) to anchor and verify agent memory. Exposes the same operations as the CLI (they share
// src/core.ts). Runs over stdio.
//
// Wire into an MCP client, e.g. Claude Code / OpenClaw config:
//   { "command": "node", "args": ["/abs/path/blocktrain/bin/blocktrain-mcp.ts"],
//     "env": { "BLOCKTRAIN_LOG": "…", "BLOCKTRAIN_PAY_WIF": "…(only if you want to seal)" } }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendEvent, sealPending, verifyLog, revealEntry, type Paths } from "../src/core.ts";
import { generateIdentity } from "../src/crypto.ts";
import { readLog, sealedThrough, readSeals } from "../src/store.ts";

const paths: Paths = {
  log: process.env.BLOCKTRAIN_LOG ?? "data/log.jsonl",
  seals: process.env.BLOCKTRAIN_SEALS ?? "data/seals.json",
};

const ok = (o: unknown) => ({ content: [{ type: "text" as const, text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
const err = (m: string) => ({ content: [{ type: "text" as const, text: `error: ${m}` }], isError: true });

const server = new McpServer({ name: "blocktrain", version: "0.6.0" });

server.registerTool("blocktrain_append", {
  description: "Append an agent action to the verifiable log. Optionally corroborate it with external refs, encrypt it to recipient pubkeys, and commit a decision-time context.",
  inputSchema: {
    kind: z.string().describe("event type, e.g. 'payment', 'deploy', 'post'"),
    data: z.any().optional().describe("JSON payload of the action"),
    actor: z.string().optional(),
    refs: z.array(z.string()).optional().describe("external refs, e.g. 'bsv-txid:<hex>', 'git-commit:<sha>:owner/repo', 'url:<u>'"),
    encryptTo: z.array(z.string()).optional().describe("recipient pubkeys (compressed hex) — blind, per-recipient access"),
    evidence: z.string().optional(),
    context: z.string().optional().describe("decision-time context snapshot to commit (anti-backfill)"),
  },
}, async (a) => {
  try { return ok(appendEvent(paths, a)); } catch (e) { return err((e as Error).message); }
});

server.registerTool("blocktrain_seal", {
  description: "Seal all pending entries into one on-chain batch via bsv.cx (spends a small BSV fee). Requires BLOCKTRAIN_PAY_WIF in the server env.",
  inputSchema: {},
}, async () => {
  const wif = process.env.BLOCKTRAIN_PAY_WIF;
  if (!wif) return err("sealing needs BLOCKTRAIN_PAY_WIF in the MCP server env");
  try { return ok(await sealPending(paths, wif)); } catch (e) { return err((e as Error).message); }
});

server.registerTool("blocktrain_verify", {
  description: "Verify the log: hash-chain + Merkle inclusion + (optional) on-chain anchor + (optional) external refs. Trusts only the public chain and math.",
  inputSchema: {
    refs: z.boolean().optional().describe("also corroborate external refs (network)"),
    onchain: z.boolean().optional().describe("also read the anchor tx OP_RETURN from WhatsOnChain"),
  },
}, async (a) => {
  try { return ok(await verifyLog(paths, a)); } catch (e) { return err((e as Error).message); }
});

server.registerTool("blocktrain_reveal", {
  description: "Decrypt an encrypted entry with a key and confirm its content matches the committed on-chain hash.",
  inputSchema: { seq: z.number().int(), key: z.string().optional().describe("recipient WIF (required if the entry is encrypted)") },
}, async (a) => {
  try { return ok(revealEntry(paths, a.seq, a.key)); } catch (e) { return err((e as Error).message); }
});

server.registerTool("blocktrain_status", {
  description: "Log summary: entry count, tip, sealed-through, pending.",
  inputSchema: {},
}, async () => {
  try {
    const log = readLog(paths.log);
    const sealed = sealedThrough(readSeals(paths.seals).seals);
    return ok({ entries: log.length, tip: log.length ? log[log.length - 1].linkHash : null, sealedThrough: sealed, pending: log.length - 1 - sealed });
  } catch (e) { return err((e as Error).message); }
});

server.registerTool("blocktrain_keygen", {
  description: "Generate a wallet-compatible read key (share the pub to grant access; keep the wif secret).",
  inputSchema: {},
}, async () => ok(generateIdentity()));

await server.connect(new StdioServerTransport());
