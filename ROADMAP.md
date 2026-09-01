# blocktrain — path to a working PoC

Incremental phases. Each ships something **independently provable**, reuses what's already
built, and names its spend gate. "PoC" per the venture framing = *exercising the bsv.cx
API*: a real agent (Mike) producing a verifiable action log anchored on mainnet that a
third party can independently verify, trusting no one.

Spend key: 💸 = spends BSV float (tiny, one tx per seal); everything else is free.

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

## Phase 4 — Corroboration + refs (fidelity: corroborated)
Entries commit external artifacts so a claim is falsifiable. Add `evidence`, `refs`,
`capturedBy`, `nonce` to the schema (per DESIGN §9); capture layer fills `refs` from action
results (txid, post URL, git sha). **Proof:** an entry whose ref an outsider checks against
the real world (e.g. a live Twetch URL or a bsv.cx txid).

## Phase 5 — Privacy: encryption + blind anchoring
Payload + context stored encrypted; chain stays hash-only; blocktrain blind by default.
**Deliverable:** `@bsv/sdk` BRC-2/42/43 encrypt-to-key; per-entry nonce; envelope
encryption with per-recipient key-wrapping (client + a "lawyer" + a "counterparty" key).
**Proof:** ciphertext at rest that blocktrain can't read; an authorized key decrypts →
recomputes hash → confirms inclusion; a second key sees only its scope.

## Phase 6 — Context anchoring
Each action also commits `contextHash` = `sha256(nonce ‖ model-input snapshot)` at
action-time (encrypted snapshot off-chain). **Proof:** demonstrate the committed context
can't be backfilled after the outcome (hash was fixed before) — the anti-hindsight property.

## Phase 7 — Shared verifiable room (product direction)
A joint log between two contracting parties: one scope, encrypted to both, both
BRC-77-signing the anchored root at milestones. Zero sCrypt. **Proof:** two keys jointly
prove a shared record neither can tamper. This is the candidate headline product.

## Phase 8 — Hosted service + full landing
When P4–P7 are proven, blocktrain.org moves to its own box: a blind-anchor API + branded
verification pages. Own trust domain, own float, own keys. **Proof:** a client integrates
against the hosted API and verifies independently.

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
