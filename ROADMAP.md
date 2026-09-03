# blocktrain — path to a working PoC

Incremental phases. Each ships something **independently provable**, reuses what's already
built, and names its spend gate. "PoC" per the venture framing = *exercising the bsv.cx
API*: a real agent (Mike) producing a verifiable action log anchored on mainnet that a
third party can independently verify, trusting no one.

Spend key: 💸 = spends BSV float (tiny, one tx per seal); everything else is free.

## Live status (2026-09-02)
**Working PoC shipped and public.** Site live at **blocktrain.org** (Cloudflare Pages),
public repo **github.com/andyrowe/blocktrain** (Apache-2.0). Done: P0–P4 + brand. The site
shows three real corroborated actions anyone can verify trusting no one.
**Open items:** (a) ✅ CF auto-deploy LIVE — GitHub Actions → `wrangler deploy` to the
Worker `sparkling-shadow-3990` on every `site/**` push (proven end-to-end 2026-09-02);
(b) next build = live miner-train viz (P4.6); (c) strategic = name a real cross-party payer
+ add a "who it's for / contact" path before pouring weeks into P5; (d) runnable-quickstart
fix from the cold read (the `blocktrain` CLI needs `npm link`/`node bin/...`, and `seal` needs
a funded WIF — the site's get-started doesn't say so yet).

---

## Phase 0 — Pure core ✅ DONE
Hash-chain, client-side RFC 6962 verifier, append-only store, bsv.cx client, CLI, DESIGN.md.
**Proof:** 12/12 tests (CT vectors + tamper/reorder/splice/delete detection); full offline
dry-run (append → seal --dry → verify) and a flipped byte trips `CHAIN BROKEN`.

## Phase 1 — First real mainnet anchor 💸 ✅ DONE (2026-08-31)
Proved the money path end-to-end. blocktrain became a real **x402 client** (`src/pay.ts`):
`seal` pays the pay-gated `/n/batch` invoice (300 sats) with a signed BSV tx and resubmits
with `PAYMENT-SIGNATURE`. Root-match gate passed (local Merkle root == bsv.cx's).
- **Anchor tx:** `48959852d314fe8a47f4ba9816801563260cdbf0b5edde0ebf4f5534113cac58`
- **Merkle root:** `35eada666d0bc883f286816dbd5e772dca208e0cb0e3dd6501ede5d589f589b1`
- **x402 settlement tx:** `a5b72e649dd25f2ab209dfa59ddd6d77c29e9f07f3651c59a54da016d91cfdfa`
- **Proof:** `scripts/independent-verify.ts` — folds bsv.cx's proof with our own verifier
  AND decodes the on-chain OP_RETURN (`["bsv.cx","not2","35eada66…"]`) from WhatsOnChain:
  **✅ independently verified**, trusting only the chain. `verify --spv` also green.

## Phase 2 — Mechanical capture (fidelity: mechanical) ✅ BUILT (2026-08-31)
Stop hand-typing events. A Claude Code **PostToolUse hook** (`~/.claude/settings.json`)
runs `blocktrain hook` on every tool call; `src/hook.ts` classifies and appends an entry
for **outward/mutating** actions only (message send, file write/edit, git push/commit,
scp/rsync/rclone, systemctl, http writes, npm publish, gh create, cron, agent send/spawn,
media gen) — reads (Read/Grep/Glob/web/memory/search) are ignored.
- **Privacy by construction:** never stores raw content — only coarse descriptors (tool,
  action, coarse target, byte length) + `payloadHash = sha256(nonce ‖ tool_input)`.
  Verified: message text and shell commands do NOT appear in the log.
- **Safe:** best-effort, never throws/blocks the agent; file lock keeps the hash-chain
  intact under parallel tool calls (proven: 20 concurrent appends, chain ok, no residue).
- **Proof:** synthetic events classify correctly (captures outward, skips reads); live
  capture begins once the session reloads settings.

## Phase 3 — Minimal public verify ✅ BUILT (2026-08-31) — **"WORKING PoC" reached (P1+P2+P3)**
Anyone other than us can check it, trusting no one.
- **Public bundle** `site/blocktrain-poc.json` (`scripts/publish.ts`) — the first sealed
  batch only (seq 0..2, blocktrain's own creation); private operational log NOT published.
- **Standalone verifier** `site/verify.mjs` — pure Node, ZERO deps. Recomputes the
  hash-chain, folds each RFC 6962 proof, reads the anchor OP_RETURN off WhatsOnChain.
  Contacts neither blocktrain nor bsv.cx. **Proven:** clean bundle → ✅ VERIFIED;
  tampered bundle → ❌ FAILED (exit 1).
- **Landing page** `site/index.html` — self-contained static, honest-scope prominent,
  one-command verify recipe, live mainnet facts. Screenshot-verified.
- **Remaining (Andy's action):** deploy `site/` to Cloudflare Pages + point blocktrain.org
  DNS (I hold no CF/registrar creds). See `DEPLOY.md`.

---
*Everything below turns the PoC into the client-facing product.*

## Phase 4 — Corroboration + refs (fidelity: corroborated) ✅ DONE (2026-09-01)
Entries carry external refs so a claim is falsifiable against the real world.
`src/refs.ts` `verifyRef`: `bsv-txid`→WhatsOnChain, `git-commit`→GitHub, `url`→liveness or
optional `::sha256` content hash. CLI `append --ref type:value` sets `evidence:"corroborated"`;
`verify --refs` + the standalone `site/verify.mjs` (now **4 layers**) check them.
- **Proven:** real refs corroborate (anchor txid on-chain, commit on GitHub, URL content hash);
  fabricated refs fail (404/422, exit 1). 20/20 tests.
- **Public demo upgraded:** blocktrain.org bundle is now **three real corroborated actions**
  (batch #2 anchor `8863f5f5…`), not the self-referential one.

## Phase 4.5 — Brand ✅ DONE (2026-09-02)
Logo adopted (concept 05): BLOCK banana-yellow / TRAIN dark hash-cells + green "verify"
chevron. `site/assets/logo/` (lockup + favicon SVG), wired into header + favicon + OG card.
Yellow = a nod to GorillaPool (mined our first anchor); real miner-coloring belongs in the
live miner-train (below), kept distinct from the static brand mark.

## Phase 4.6 — Live miner-train viz (NEXT, free)
Render a proof as a train whose cars are the **blocks** each batch anchored into, **colored by
the miner** that mined them (reuse chainhealth's coinbase attribution: GorillaPool-yellow,
TAAL, Mempool, SVPool, neutral for unknown/solo; a signature color if Andy's own S19 mines one).
Data-bound + verifiable (colors derive from public coinbase data). Goes on the verify page.
**Proof:** our two anchors render correctly — batch #1 = GorillaPool-yellow (block 964785).

## Phase 5 — Privacy: encryption + blind anchoring ✅ DONE (2026-09-02)
`src/crypto.ts`: envelope encryption on native BSV keys — random AES-256-GCM CEK per entry,
CEK ECIES-wrapped (`@bsv/sdk` `SymmetricKey` + `ECIES.electrumEncrypt`) to each recipient
pubkey. CLI: `keygen`, `append --encrypt-to <pub>` (repeatable), `reveal --seq --key`.
`verifyChain` verifies encrypted entries structurally (linkage from stored hashes) and defers
content-integrity to a key-holder (`reveal` recomputes the committed hash after decrypt).
- **Proven (12 tests + live CLI):** raw log leaks no plaintext (blind); authorized keys decrypt,
  a non-recipient is refused; per-entry scoping (counterparty reads shared, refused the payment);
  GCM tamper detection; hash round-trips after decrypt.
- **Scope:** payload encrypted; structural metadata (kind/actor/ts) stays visible. Hosted
  blind-anchor service is still P8.

## Phase 6 — Context anchoring ✅ DONE (2026-09-02)
Each entry can commit `contextHash = sha256(nonce ‖ context)` (`computeContextHash`), placed in
the entry data so it's anchored at action-time and can't be backfilled. Snapshot stored in a
sidecar `context/<hash>.{bin,enc}` (encrypted if `--encrypt-to`). CLI: `append --context <file>` /
`--context-data <str>`; `context --seq [--key]` decrypts + verifies the snapshot against the
committed hash. **Proven:** live commit verifies ✓; a tampered/backfilled snapshot → ✗ MISMATCH;
3 unit tests. Honest limit: proves what the agent *claims* it knew, not that context caused the action.

## Phase 7 — Shared verifiable room (SPEC'd 2026-09-02 · `docs/SHARED-ROOM.md`)
A joint log between counterparties: room manifest (participants pinned at open) + entries
encrypted to all (P5) + **mutually-signed checkpoints** anchored on-chain. Key design call
(corrects the old "BRC-77" note): checkpoint sigs are **publicly-verifiable ECDSA** (`@bsv/sdk`
`priv.sign`/`pub.verify`, confirmed) so a neutral arbiter can verify with only pubkeys — BRC-77
SignedMessage is recipient-verified and can't be. v1 = single-writer + counterparty co-signs
checkpoints. Reuses chain/anchor/refs/encryption/context; new = manifest + checkpoints + sigs.
**NOT built — gated on naming one real two-party use case first** (spec §7).

## Phase 7.5 — MCP server ✅ DONE (2026-09-02)
blocktrain exposed as an MCP server (`bin/blocktrain-mcp.ts`, stdio) so any framework (OpenClaw,
Claude Code; Hermes via a bridge) uses one door: tools `blocktrain_append/seal/verify/reveal/
status/keygen`. CLI + MCP share `src/core.ts` (single implementation, no drift). Proven via a
real MCP client smoke test. This is the framework-agnostic integration layer under P8.

## Phase 8 — Hosted service: remote MCP on Cloudflare Workers (SPEC'd 2026-09-02 · `docs/HOSTED-MCP.md`)
Host blocktrain's MCP as a **remote MCP** at `mcp.blocktrain.org/mcp` (CF Agents SDK
`createMcpHandler`, Streamable HTTP, Workers OAuth). Clients connect by URL — no CLI, no wallet.
Key work: abstract `store.ts` behind a `Store` interface (fs for CLI, R2+Durable-Object for the
Worker); server holds the anchoring float; **blind by default** (clients encrypt first → service
stores ciphertext+hashes, can't read). Integrity/timestamp stay chain-verified (service never
trusted for those); it's only trusted for liveness, and everything stays exportable/verifiable off
it. Also: `blocktrain.org/llms.txt` shipped (agent-discoverable). **NOT built — gated on real
hosted demand** (a client who won't run the CLI/hold a wallet).

---

## Critical path & gates
- **Do now (free):** nothing blocks — P2 hook design can start before P1.
- **Needs your go (💸):** P1 first anchor. Tiny spend, and it's the live compat proof.
- **PoC milestone:** P1 + P2 + P3 = a real, mechanically-captured, publicly-verifiable
  agent log on mainnet. That's the demonstrable thing to show a client or the BSV community.
- **Then** privacy/corroboration/context/shared-room harden PoC → product.

## Recommended v1 fidelity call
Ship **mechanical now** (P2), **corroborate where a natural external artifact exists** (P4)
— don't force corroboration on actions that have no third-party trace.
