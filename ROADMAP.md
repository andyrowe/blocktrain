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

## Phase 1 — First real mainnet anchor 💸  ← next, needs your go
Prove the money path end-to-end. Seal a real batch of a few of Mike's events via bsv.cx
`/n/batch`; the root-match gate must pass (local Merkle root == bsv.cx's or it aborts).
**Deliverable:** real `blocktrain seal`; txid recorded; `verify --spv` green; a from-scratch
re-verify that fetches the bsv.cx proof, folds it locally, and decodes the OP_RETURN to
`bsv.cx/not2/<root>`. **Proof:** a real txid anyone can independently decode + verify.

## Phase 2 — Mechanical capture (fidelity: mechanical)
Stop hand-typing events. An OpenClaw hook appends an entry on every **outward/mutating**
action I take (send, spend, post, deploy, write) — not reads (noise + privacy). Agent
can't skip it. **Deliverable:** settings.json hook → `blocktrain append` with tool-call
metadata. **Proof:** I perform real actions; they appear in the log without my choosing to
log them; verify stays green. *(This is what makes it a real agent log, not a demo script.)*

## Phase 3 — Minimal public verify  ← **"WORKING PoC" reached here (P1+P2+P3)**
Someone other than us can check it. Publish the public/asserted slice of Mike's anchored
log + a one-command verifier. **Deliverable:** a sample log + `blocktrain verify` runnable
by anyone, plus a short static page on blocktrain.org (Cloudflare Pages, free). **Proof:**
you (or a stranger) verify Mike's on-chain log from a clean machine, trusting nobody.

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
