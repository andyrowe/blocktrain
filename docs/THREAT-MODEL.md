# blocktrain — threat model & auditor's guide

For the stranger who wants to **audit an agent** from its blocktrain log, trusting no one —
not the operator, not blocktrain, not bsv.cx. It states plainly what an audit does and does
not buy you, and how to escalate as your skepticism grows. Companion to
[DESIGN.md](../DESIGN.md) and [PAYMENTS.md](./PAYMENTS.md).

## 0. The distinction that governs everything

There are two different things "audit an agent" can mean:

- **Audit the *record*** — "was this log edited, reordered, or backdated after the fact?"
  **blocktrain answers this today, cleanly.**
- **Audit the *agent*** — "did the agent do *only* what the log claims, and nothing
  off-book?" **No anchor can answer this, and blocktrain does not pretend to.** A malicious
  operator simply never appends the actions they want hidden.

Everything below is about narrowing the gap between those two — as far as the math honestly
allows, and no further.

## 1. Trust model

An auditor should have to trust exactly three things, all public:

1. **The BSV chain** (that a confirmed OP_RETURN existed at its block time).
2. **SHA-256 and secp256k1** (that hashes don't collide and signatures don't forge).
3. **The auditor's own copy of the verifier** — `verify.mjs`, a single zero-dependency
   Node script that recomputes the chain, folds every Merkle inclusion proof, and reads the
   anchor's OP_RETURN. It contacts **neither blocktrain nor bsv.cx**.

Explicitly **not** trusted: the operator, blocktrain (the project/host), bsv.cx (the
anchoring service), and any single block explorer (on-chain reads cross-check WhatsOnChain
+ Bitails and refuse unless they agree on the tx bytes — `anchorCarriesRoot`).

## 2. What an audit proves — the four verification stages

`verify` runs staged; each stage can fail independently (see `verifyLog` in `src/core.ts`):

1. **Chain** — recompute `linkHash_i = SHA256(linkHash_{i-1} ‖ entryHash_i)` down the log.
   Any edit, reorder, splice, or middle-deletion breaks the chain at a named seq. → proves
   **integrity + order**.
2. **Seal / inclusion** — each sealed leaf equals its log entry's `linkHash`, and each folds
   to the anchored Merkle root via a client-side RFC 6962 proof. → binds the entries to a
   specific root.
3. **On-chain** (CLI `--spv`; MCP tool `onchain:true`) — the anchor tx's OP_RETURN actually carries `bsv.cx/not2/<root>`,
   confirmed across multiple explorers. → proves **timestamp** (the root existed by that
   block).
4. **Refs** (`--refs`) — each entry's external references (txid / URL / git sha) independently
   resolve. → the honest bridge from "audit the record" toward "audit the agent" (§4).

Pass all four and you know: these exact entries, in this order, existed no later than the
anchor's block time, unaltered since — and any corroborated claims check out against the
outside world.

## 3. What an audit does NOT prove — the permanent limits

State these at the same weight as the guarantees. None are bugs; they are the boundary of
what anchoring can do.

- **Omission / truncation.** The chain proves present entries weren't tampered; it does
  **not** prove the operator logged *everything*. They can silently never-write an action,
  or truncate the tail before sealing. *This is the single biggest gap for auditing a
  hostile operator.* (Mitigations: §4, §5.)
- **At-write-time lying.** `append("I did X")` when the agent did Y produces a perfectly
  valid chain. Integrity ≠ honesty. Only corroboration (§4) makes a lie falsifiable.
- **Causation.** A committed decision-time context hash (P6) proves the justification was
  fixed *before* the outcome was known — it kills hindsight-rationalization. It does **not**
  prove the context *caused* the action; LLMs aren't bit-replayable.
- **Authorship / identity.** A bare log doesn't prove *who* wrote it. Only signed entries /
  signed checkpoints (§5) bind content to a keyholder.

The governing rule (DESIGN §2): every entry carries its own `evidence` level
(asserted → structured → mechanical → corroborated) and blocktrain **never dresses an
assertion up as proof.** An auditor's first move is to read that label, not the Merkle math.

## 4. The escalation ladder — how far to push

Walk *up* only as far as your distrust of the operator demands; stop when satisfied.

- **Rung 0 — verify the record (shipped).** Run `verify.mjs` on the public bundle. Confirms
  §2 stages 1–3, trusting no one. Enough when you trust the operator not to *omit*, only
  worry they might *edit*.
- **Rung 1 — check completeness (partial).** Confirm seq numbers are contiguous and the
  chain is unbroken (blocks middle-deletion). The residual hole — never-logged or
  tail-truncated actions — is **not** closed by the chain alone. If the agent anchors on a
  known cadence, a missing window is at least visible; treat that as a mitigation, not a
  proof.
- **Rung 2 — corroborate against the world (`--refs`, shipped).** The teeth for auditing
  behavior. An entry claiming "I posted X / paid Y / deployed Z" that carries a resolvable
  txid / URL / git sha is far harder to fake than a bare claim. The more of an agent's
  actions leave independent public footprints that get referenced, the closer you get to
  auditing the *agent*, not its diary. Weigh entries by `evidence` level.
- **Rung 3 — context anchoring (`context`, shipped).** For a disputed action, verify the
  decision-time context snapshot against its committed hash: `✓ matches` (fixed at
  action-time) or `✗ backfilled`.
- **Rung 4 — mutual checkpoints (spec, not built).** The real answer to a *hostile*
  operator: don't let them be the only signer. See §5.

## 5. Auditing a hostile operator — where the design must go

Rungs 0–3 audit a **cooperative** operator's record well. Against an operator who will omit
or truncate to hide misconduct, the honest answer is **co-signing** — the P7
[SHARED-ROOM](./SHARED-ROOM.md) spec:

- A counterparty with adverse interest **signs checkpoints** (`kind:"room.checkpoint"`,
  publicly-verifiable ECDSA over the chain tip at a seq range).
- Once a counterparty has signed tip *T*, the operator **cannot** later present a forked or
  truncated history before *T* without producing a conflicting signed checkpoint — omission
  and rewriting become **detectable by someone with a motive to check**.
- A third party (counsel, court, auditor) then settles the dispute from the record and the
  signatures alone, trusting neither party nor blocktrain.

This is the rung that converts "audit the record" into "audit the agent." It is
**spec-only** and deliberately gated: per the standing strategic steer, it waits on a named
cross-party user rather than being built on spec.

## 6. Auditor's quickstart

```
# 1. Get the operator's public bundle + the verifier (host them yourself if paranoid)
node verify.mjs blocktrain-poc.json            # stages 1–3, offline; expect VERIFIED

# For a live log you have access to (read key if entries are encrypted):
blocktrain verify --spv --refs                 # all four stages (--spv does the on-chain check)
blocktrain context --seq <n> [--key <wif>]     # was the disputed context backfilled?
blocktrain reveal  --seq <n> [--key <wif>]     # decrypt an entry you're granted
```

Then read each entry's `evidence` label and discount accordingly. `asserted` is a claim;
`corroborated` is checkable. Absence of an expected action is the thing the log can't rule
out — that is what co-signing (§5) exists to fix.
