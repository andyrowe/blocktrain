# P7 — Shared verifiable room (spec)

Status: **spec only, not built.** The candidate headline product; built entirely from what
already ships (P0 chain, P1 anchor, P4 refs, P5 encryption, P6 context) plus two new pieces:
a **room manifest** and **mutually-signed checkpoints**.

## 1. What it is / who it's for

A joint, tamper-evident record between parties who **don't fully trust each other** — an agent
acting between a client and a vendor, two firms with an agent-mediated agreement, a service and
the customer it's accountable to. The room is:

- **Readable by all participants** (encrypted to each — P5),
- **Tamper-evident** (hash-chain + on-chain anchor — P0/P1),
- **Mutually acknowledged** (each participant *signs* checkpoints — new),
- **Arbiter-verifiable** — any third party (counsel, court, auditor) can later confirm integrity,
  timestamps, and who-signed-what, **without trusting either party or blocktrain**.

The one-liner: *one shared book, both parties sign the pages, neither can rewrite it, and a
stranger can settle the dispute from the record alone.*

## 2. Model

- **Room manifest** — genesis entry `kind:"room.open"`, data `{ roomId, participants:[{label,
  pub}], termsHash?, createdAt }`. Anchored, so the participant set (and optional terms hash) is
  pinned at open and can't be changed later.
- **Entries** — ordinary blocktrain entries, encrypted to all participants (P5), optionally with
  external refs (P4) and a committed decision-time context (P6). **v1 is single-writer** (see §5).
- **Checkpoint** — `kind:"room.checkpoint"`, data `{ roomId, tip, seqRange, ts, sigs:[{pub,sig}] }`
  where `tip` is the current chain tip (linkHash) at the checkpoint. Each participant produces a
  **publicly-verifiable ECDSA signature** over `sha256(canonical({roomId,tip,seqRange,ts}))`. A
  checkpoint is *valid* iff every required participant signed. The checkpoint is anchored on-chain
  (P1) → the mutually-signed state is timestamped.
- **Close** — a final checkpoint (`kind:"room.close"`), all sign, anchored.

## 3. Signatures — publicly verifiable (NOT BRC-77 SignedMessage)

Verified against `@bsv/sdk`: `priv.sign(digest)` → `Signature`, `pub.verify(digest, sig)` — a
third party verifies with **only the signer's public key**. This is required: an arbiter holds
neither party's private key.

> Roadmap note / correction: earlier notes said "BRC-77-signing." `@bsv/sdk`'s BRC-77
> `SignedMessage` is **recipient-verified** (`verify` needs the recipient's *private* key), so it
> can't be checked by a neutral arbiter. Default P7 signatures are therefore plain ECDSA over the
> checkpoint digest. BRC-77 remains an *optional* mode for private, recipient-only acknowledgments.

## 4. Verification (third party / arbiter)

Given the room bundle (manifest + entries + checkpoints), trusting only the public chain + math:

1. **Chain** (P0) — replay the hash-chain; order + integrity.
2. **Anchor** (P1) — each checkpoint's tip/root is OP_RETURN-anchored; read block times.
3. **Participants** — every checkpoint signer's pub is in the room manifest's declared set.
4. **Signatures** — each checkpoint carries a valid signature from **every** required participant
   over the correct tip.
5. **(with a key)** decrypt content; **(without)** structure, signers, and timestamps still verify.

Verdict: *"parties X and Y provably co-signed this record through checkpoint N, anchored at block
T. Neither can repudiate it, and neither can present a divergent signed history for this room."*

## 5. Threat model & honest limits

**Prevents:** after-the-fact tampering / reordering (chain+anchor); repudiation (signatures);
one party fabricating entries the other "agreed to" (a counterparty only signs a checkpoint over a
state it has *seen*); presenting two different signed histories for one room (the anchor + the
manifest pin a single lineage).

**Does NOT prevent / out of scope:**
- **Liveness** — a party can refuse to sign or continue. That's a business/legal matter; the last
  mutually-signed checkpoint stands as evidence of where things were left.
- **Pre-checkpoint omission** — the keeper could omit an entry *before* a checkpoint the counterparty
  then signs. Mitigation is procedural: **review before you sign** (same as signing any contract);
  the counterparty holds the full log up to the checkpoint before signing it.
- **Truthfulness of content** — same self-report limit as all of blocktrain (P6 context narrows it).
- **Real-time concurrent multi-writer** — v1 is **single-writer + counterparty co-signs
  checkpoints** (one keeps the book, both sign the pages). True concurrent multi-writer needs a
  merge/coordinator and is deferred; a hosted coordinator (P8) is the natural home if demanded.
- **Metadata** — kind/timestamps/participant set are visible; payloads are encrypted.

## 6. Build plan (staged, on top of what exists)

- **S1 — `src/room.ts`**: manifest + checkpoint types; `signCheckpoint(priv, {roomId,tip,seqRange,ts})`
  and `verifyCheckpoint(sig, pub, ...)` (ECDSA via `@bsv/sdk`).
- **S2 — CLI**: `room open --participant label:pub …`, `room append …` (encrypts to all
  participants; reuses P4/P6 flags), `room checkpoint` (emit the signable payload), `room sign
  --key <wif>` (each party signs; collects sigs), `room verify` (all §4 checks).
- **S3 — shared bundle format** (manifest + entries + checkpoints + sigs) + extend the standalone
  `verify.mjs` to check participants + checkpoint signatures.
- **S4 (P8) — hosted room service** so parties don't run CLIs, and an optional coordinator for
  concurrent writes.

Reuses: chain, anchor, refs, encryption, context. New surface: manifest, checkpoints, ECDSA
signatures, participant verification.

## 7. Riskiest assumption (sincere)

Same as the venture, sharper: **that counterparties will adopt a tool to co-sign a shared ledger
instead of just trusting each other / emailing a signed PDF.** The wedge is contexts where the
trust gap is real and the stakes justify the ceremony — disputes, regulated relationships,
agent-mediated money moving between parties. **Spec is cheap; do not build S1–S3 until one real
two-party use case is named.** This is the same steer as the rest of the roadmap: the tech is ahead
of demand — find the first room's two real occupants before building the room.
