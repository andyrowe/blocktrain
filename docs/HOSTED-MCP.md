# P8 — Hosted service (remote MCP on Cloudflare Workers) · spec

Status: **spec only, not built.** Turns blocktrain from "run the CLI / local MCP" into a hosted
service any agent connects to over the network — so a client doesn't run their own box, keep a
funded wallet, or manage anchoring. Cloudflare Workers is the natural host: the site already runs
there, the MCP server is already written against the same `McpServer` API Cloudflare's Agents SDK
uses, and CF deploy creds are wired.

## Why Cloudflare Workers

Cloudflare hosts **remote MCP servers** on Workers via the Agents SDK: `createMcpHandler` exposes
an `McpServer` over **Streamable HTTP** (typically at `/mcp`), with the **Workers OAuth Provider**
for auth and **Durable Objects / KV / R2 / D1** for state. So blocktrain's MCP could live at
`https://mcp.blocktrain.org/mcp` and any MCP client connects by URL instead of spawning the CLI.
(Refs: developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server.)

## What changes vs the local MCP

The tool definitions are unchanged — the work is transport + storage + trust:

1. **Transport:** swap `StdioServerTransport` for `createMcpHandler(server)` in a Worker `fetch`.
   The six tools (`blocktrain_append/seal/verify/reveal/status/keygen`) stay identical.
2. **Storage (the real work):** the local server uses the filesystem (`data/log.jsonl`, seals,
   context sidecars). A Worker has no fs and is **multi-tenant**, so `src/store.ts` must be
   abstracted behind a `Store` interface with two impls: the current fs one (CLI) and a
   Worker one (per-client namespace in **R2** for logs/snapshots + **Durable Object/D1** for the
   append lock + seal index). `src/core.ts` already centralizes the ops, so it takes a `Store`.
3. **Auth + tenancy:** Workers OAuth Provider; each client gets an isolated namespace keyed by
   their identity. No cross-tenant reads.
4. **Anchoring key:** the service holds the BSV float and pays `/n/batch` (bills the client, or a
   flat/again x402). This is the one server-held secret; scope it tightly (a dedicated float, caps
   already enforced by `resolvePayment`).

## Blind by default (the promise, realized as a service)

Clients **encrypt before sending** (P5 envelope). The hosted service stores **ciphertext + hashes**
and anchors the hash — it never sees plaintext. So blocktrain-the-service is a **blind anchor**:
it holds your proofs and can't read them. Clients still verify independently (verify.mjs / any
`@bsv/sdk` client) against the public chain — the service is never trusted for integrity.

## Threat model / honest limits

- **Integrity/timestamp:** still chain-verified; the service cannot tamper (anchored) and cannot
  read (blind). Same trustlessness as local.
- **Availability/censorship:** a hosted service *is* trusted for liveness — it could withhold,
  rate-limit, or disappear. Mitigation is exactly blocktrain's ethos: everything is exportable and
  verifiable off the service; a client can always fall back to the CLI + bsv.cx directly. "Even if
  blocktrain disappears" must stay literally true — the service holds nothing a client can't re-obtain.
- **Server-held float:** the anchoring key is a real server secret; isolate it, cap spend, and
  never let it touch plaintext.

## Staged build

- **S1 — POC:** wrap the existing `McpServer` with `createMcpHandler` on a Worker (authless,
  ephemeral in-memory store). Prove a remote MCP client can append+verify over HTTP.
- **S2 — storage:** `Store` interface; R2 + Durable Object impl; refactor `store.ts`/`core.ts` onto it.
- **S3 — auth + anchoring:** Workers OAuth, per-tenant namespaces, server float + billing.
- **S4 — domain:** `mcp.blocktrain.org`; publish alongside the CLI/local MCP as an alternative.

Reuses: `core.ts` operations, `crypto.ts` (client-side encryption stays client-side), the CLI
verifier. New: `Store` abstraction, Worker transport, OAuth, tenancy.

## Gate

Same steer as the rest of the roadmap: **build when hosted use is real demand** — a client who
says "I don't want to run the CLI or hold a wallet." Until then, the local CLI + stdio MCP cover
every capability; the hosted service is convenience + reach, not new trust.
