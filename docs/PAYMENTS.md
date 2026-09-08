# blocktrain — payments

How money enters blocktrain, who needs it, and who must never need it. This is a design
doc, not a promise of shipped features: it marks what exists today and what is deliberately
deferred. Companion to [DESIGN.md](../DESIGN.md).

## 0. The one invariant

**Verification is free and walletless. Forever.**

Auditing an agent's log — replaying the hash-chain, folding each Merkle inclusion proof,
reading the anchor's `OP_RETURN` off a public explorer, corroborating external refs — reads
only the public chain. Reading the chain costs nothing. If auditing ever required the
auditor to pay, hold BSV, or connect a wallet, the open-audit premise would be dead.

So: **no payment, key, or account ever gates the read/verify path.** `verify.mjs` contacts
neither blocktrain nor bsv.cx. This invariant outranks every convenience below it.

## 1. Two key roles — do not conflate them

blocktrain touches secp256k1 keys in two unrelated places. Most "how do payments work?"
confusion comes from merging them.

| Role | Where | Funded? | Purpose |
|---|---|---|---|
| **Read / identity key** | `crypto.ts` `generateIdentity`, CLI `keygen` | No | ECIES per-recipient encryption. Grants *read* access to blind entries. Never spends. |
| **Pay key (WIF)** | `pay.ts` `postPaid`, CLI `seal` | Yes | Signs a BSV tx to settle the x402 invoice for anchoring. The *only* thing that spends. |

Generating a read key is free and requires no chain interaction. The rest of this document
is about the **pay key only**.

## 2. What actually costs money

Exactly one operation: **`seal`** (CLI `blocktrain seal`, MCP `blocktrain_seal`).

`seal` batches pending `linkHash`es into an RFC 6962 Merkle root and anchors that one root
on BSV by calling bsv.cx's pay-gated `POST /n/batch` (x402 v2). One transaction per seal,
regardless of how many entries are in the batch — the pricing lesson from DESIGN.md §8.

- **Cost:** the anchor invoice is ~300 sats today (`pay.ts` comment; the real figure comes
  from the 402 challenge at call time, never hardcoded).
- **Guard rail:** `resolvePayment` refuses any amount over a hard cap (default 100k sats,
  override `BLOCKTRAIN_MAX_PAY_SATS`) and refuses to guess the chain from a malformed
  network id — so a tampered or malicious 402 can't drain the payer.
- **append / verify / reveal / status / keygen cost nothing.** Only `seal` spends.

## 3. Who needs to pay — split the stranger in two

A stranger arriving at blocktrain wants one of two things, with opposite payment needs:

- **To *verify* someone's agent (audit).** Pays nothing, needs no wallet. Covered by §0.
  This is the majority case and the mission-critical one.
- **To *anchor their own* agent's log.** This is the only party who needs funds, and only
  for `seal`.

Everything below serves the second party.

## 4. The payment ladder (for the party who anchors)

Not one model — a ladder, floored on non-custodial and topped with an explicit,
labeled convenience.

### Rung 0 — Sponsored float (donation-funded)  ✅ active, early phase

During blocktrain's early phase, **sealing costs are covered by donations.** A modest
project-funded wallet supplies the `BLOCKTRAIN_PAY_WIF`, so a newcomer can anchor for real
without first acquiring BSV — the acquisition hurdle that stops most strangers at the door.

- **Why it exists:** the first thing a stranger wants is to prove the *whole* loop —
  append → seal → verify on-chain — before deciding blocktrain is worth funding themselves.
  A sponsored float removes "go buy Bitcoin first" from step one.
- **Donation address (BSV):** `1HuwPh5uDG1cuyCDUbWKjd5n7JLKHnhFXT` — top-ups keep the early
  phase sealing. Verification never needs it (§0); this funds *anchoring* only.
- **The honest limit, stated plainly:** a sponsored WIF that lives on the newcomer's box
  spends the project's float directly. It is capped per-seal (§2, default 100k sats) and the
  float is kept modest and refillable, so worst-case loss is bounded — but this is a
  trust-and-goodwill arrangement for the early phase, **not** the trust-minimizing endgame.
  A sponsor-signed payment endpoint (the WIF never leaving the sponsor's control) is the
  later hardening; until then, treat the float as small, watched, and expendable.
- **Not a paywall inversion:** the free/walletless *verify* path (§0) is untouched. This
  only lowers the bar on the one operation that costs money.

### Rung 1 — Bring-your-own WIF  ✅ shipped

The operator supplies `BLOCKTRAIN_PAY_WIF`, a funded mainnet key, via env. blocktrain reads
UTXOs from WhatsOnChain, builds and signs the settlement tx locally, resubmits with
`PAYMENT-SIGNATURE`.

- **Trust posture:** non-custodial by construction — the key lives on the operator's box,
  blocktrain (the project) never holds it or their float.
- **Right for:** a self-hoster running the CLI or the stdio MCP on their own machine.
- **The floor, deliberately:** zero third-party integration, works offline-ish, no
  dependency on any wallet software existing.
- **Handling:** treat the WIF as a low-balance, purpose-funded hot key. Never commit it,
  never place it in a shared/plaintext config on an unencrypted disk. Prefer a secrets
  store / env injection over a flat file. Fund it with a small amount; the cap in §2 bounds
  worst-case loss.

### Rung 2 — BRC-100 wallet connector  ⬜ not built (recommended next)

Instead of pasting a raw WIF, blocktrain requests the x402 payment through a BRC-100 wallet
interface (`WalletClient` in `@bsv/sdk`, e.g. MetaNet Desktop). The **user's own wallet**
holds the keys, displays the spend, and approves it; blocktrain receives only the signed
transaction / settlement response.

- **Why it's the right interactive upgrade:** strictly better trust than a WIF — no private
  key ever enters blocktrain's process or config. The wallet is the custody boundary.
- **What it changes:** `postPaid` shifts from *"I hold the WIF and build the tx"* to *"I
  hand the wallet a payment request and receive a signed result."* Real work, not a flag.
- **Honest limit:** only helps strangers who already run a BRC-100 wallet — a thin
  population today. It improves the *right* person's onboarding; it does not create that
  person.
- **Gate:** build when a named operator would use blocktrain and won't/can't paste a WIF.

### Rung 3 — Hosted custodial float  ⬜ spec only (opt-in, never default)

The [HOSTED-MCP.md](./HOSTED-MCP.md) design runs blocktrain as a remote MCP where the
**server** holds the anchoring float and bills the user out-of-band.

- **Convenience:** the user never touches BSV.
- **The cost, stated plainly:** it reintroduces a trusted operator — the exact middleman
  blocktrain exists to remove. Acceptable *only* as an explicitly labeled paid convenience
  tier, never the default, never the only door. The §0 verify path must remain free and
  independent of this host.

## 5. Non-answers (and why)

- **"Generate a wallet for every user."** The code can (`PrivateKey.fromRandom`), but
  generation was never the hard part — **funding** is. A fresh wallet is empty; you'd strand
  the stranger on "now go acquire BSV and send it here," the worst possible first step. If
  the project pre-funds it, the project becomes custodian — the middleman posture again.
  Wallet generation solves creation while dodging funding and custody.
- **"Paywall verification to monetize."** Violates §0. Verification is the product's whole
  claim; gating it kills the claim.

## 6. Where this lands

- Verification: **free and walletless, forever** (§0).
- Anchoring, early phase: **donation-sponsored float** (Rung 0) removes the acquisition
  hurdle so a newcomer can prove the whole loop before funding themselves — donate at
  `1HuwPh5uDG1cuyCDUbWKjd5n7JLKHnhFXT`.
- Anchoring, self-funded: **non-custodial by default** — BYO-WIF now, BRC-100 wallet next —
  with hosted-custodial as an **opt-in convenience, never the floor**.
- Generating a per-user wallet is a non-answer (funding + custody); BRC-100 is the right
  interactive rail but serves a small population today.

## 7. The sincere caveat

All of §4 is supply-side. Three payment models for a demand that has not yet shown up; per
the standing strategic steer (DESIGN.md §8, ROADMAP), the tech is ahead of the buyer. The
BRC-100 connector is a few days of real work that cleans up the right operator's onboarding
— it does not manufacture that operator. **Sequence:** this doc now (cheap, fixes the §0
invariant in writing); the BRC-100 connector only when a cross-party operator is named.
