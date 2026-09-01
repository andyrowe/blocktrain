# blocktrain — design

Living design record. Captures *why* blocktrain is shaped the way it is, the honest
limits, and the decisions taken (and deferred). Companion to `README.md` (what it is) and
the thesis in `memory/blocktrain-memory-thesis.md`.

Status: v0.1 pure core built and proven (hash-chain + client-side RFC 6962 verifier + CLI,
12/12 tests). Everything below marked **(built)** exists; **(planned)** / **(deferred)** do not.

---

## 1. The one idea

Turn an AI agent's action log into a record that is **tamper-evident, ordered,
timestamped, and portable** — provable to a third party who does not trust the operator,
and still verifiable if blocktrain disappears. bsv.cx already solves anchoring; blocktrain
is the thin, honest layer of *capture + structure + verification* on top.

## 2. The accuracy ceiling is the capture layer, not the anchor

Anchoring is solved and cheap (one on-chain tx per Merkle batch, regardless of size).
The hard, valuable problem is **how faithfully the log reflects what the agent actually
did.** Garbage in → tamper-evident garbage out. So the design centre of gravity is
upstream of the chain.

### Fidelity ladder (weakest → strongest)

1. **Asserted** — agent calls `append("I did X")`. It chooses what to log; can omit or
   embellish. *(v0.1 is here.)*
2. **Structured** — typed event with real inputs/outputs, still self-narrated.
3. **Mechanical** — the *runtime/harness* writes the entry on every tool call via a hook
   the agent cannot skip. Removes the agent's discretion, so it can't silently not-log.
4. **Corroborated** — the entry commits to an artifact that exists *outside* the agent's
   control and is independently checkable: a txid, a post URL, a git sha, a signed HTTP
   response. A lie becomes falsifiable against a third party.

**Design rule:** every entry carries its own `evidence` level, and blocktrain **never**
dresses an assertion up as proof. The product's integrity is that labeling, not the
Merkle math.

### The permanent, honest limit

Anchoring stops *after-the-fact* tampering. It never stops *at-write-time* lying or
omission. Only corroboration raises fidelity past "trust the writer." State this at the
same visual weight as the pitch, everywhere. blocktrain proves **integrity + order +
timestamp** of a *self-reported* log; it does not make the agent truthful to its log.

## 3. Anchoring context per action

Core to the "memory states on-chain" thesis. You never put context on-chain — you anchor
`sha256(nonce ‖ context_snapshot)` and hold the (encrypted) snapshot off-chain.

- **What it proves:** the justification was **committed at action-time.** Nobody can
  backfill a flattering reason after seeing the outcome, because the hash was fixed
  before. This kills hindsight-rationalization — exactly what an auditor cares about.
- **What it does NOT prove:** that the context *caused* the action. LLMs aren't
  bit-replayable (sampling/temperature), so "input H ⇒ output O" isn't reproducible. We
  prove *what the agent claims it knew when it acted*, bound to the action and timestamp.
- **Context = the actual model input** (system + messages + tool defs + retrieved memory)
  is the most honest, complete snapshot to hash. It's already a concrete artifact.

## 4. Privacy

### 4.1 The chain is already private

BSV only ever holds a **Merkle root** — a hash. No plaintext, ever. Confidentiality is
therefore an *off-chain storage* problem, not an on-chain one.

### 4.2 Hash-guessing defense (the nonce)

Hashes of low-entropy content are guessable — hash `"yes"`/`"no"`, compare to the
committed digest. So every committed preimage includes a per-entry random **nonce**:
`sha256(nonce ‖ payload)`. Cheap; makes the anchored hash reveal nothing about contents.

### 4.3 Encryption vs signing — don't conflate

- **Confidentiality** (who can *read*) = encryption: BSV stack BRC-2 encrypt + BRC-42/43
  key derivation (ECDH-to-recipient).
- **Authorship / non-repudiation** (who *wrote* it) = **BRC-77** SignedMessage; can target
  a recipient so only they verify.

Use both: encrypt-to-client for privacy, BRC-77-sign so the client can prove who authored
an entry and blocktrain can't disown it.

### 4.4 Blind anchoring is the default posture

Can *blocktrain* decrypt client data?

- **Client-only keys → blind anchor.** blocktrain holds ciphertext + hashes and literally
  cannot read the logs. Strongest story, fits "verify without trusting us." Cost: no
  server-side search / dashboards / analytics.
- **Shared key → featureful but a honeypot** and a subpoena target.

**Decision: default blind; shared-key is strictly opt-in, per client.** "We prove; we
don't read."

## 5. Multi-party access (blind, but N readers)

Scenario: a client wants private logs readable by themselves, their lawyers, and a
counterparty they're contracting with. This is a **key-distribution** problem, solved by
**envelope encryption** — *not* smart contracts:

- Each entry (payload + context) is encrypted with a fresh random content-encryption key
  (CEK, AES-256-GCM).
- The CEK is **wrapped** (encrypted) separately to each authorized recipient's pubkey. You
  store one small wrapped-key blob per party: client, lawyer, counterparty.
- Each party unwraps their own copy and reads. blocktrain never holds an unwrapped key →
  **stays blind.** Only making blocktrain a recipient would break that.

**Granularity is free:** wrap per-entry or per-**scope** keys, so the counterparty sees
*only* the entries under their contract while the lawyers see the whole log — the same
per-leaf selective disclosure the Merkle design already gives us (reveal one action +
its inclusion proof to a skeptic without exposing the rest).

**Honest limit:** granting a new party access to *future* entries is trivial; you cannot
un-share the past (a former reader may have cached the CEK). Forward re-key only.

## 6. On smart contracts (sincere verdict)

For the privacy/access problem: **no.** A script can't keep a secret — everything in an
on-chain contract is public, so contracts cannot enforce *read access* to private data at
all. Access control is inherently off-chain key distribution. Reaching for sCrypt here is
the wrong tool.

Where on-chain contracts *could* earn a place **later** (name the concrete feature first;
do **not** speculatively bake contract primitives into bsv.cx):

- Notarizing **access grants / revocations** as signed, anchored events — an auditable
  *history of who was granted what, when*. Very on-brand, and it's just more anchoring.
- **x402 payment-gated key release** — pay to receive a wrapped key. Business logic; x402
  already exists, likely simpler off-chain.

Neither is needed for privacy. Discipline unchanged from bsv.cx: build the primitive when
a real user reaches for it.

## 7. The shared verifiable room (promising direction)

The valuable idea hiding in the multi-party question: a **joint log between two
contracting parties** — one scope, encrypted to both, with both parties BRC-77-signing the
anchored Merkle root at agreed milestones. A shared record neither side can tamper and
both can independently prove. Zero sCrypt. Possible headline product: a *verifiable room
between counterparties*, built entirely from encrypt + sign + anchor.

## 8. Scope discipline

In-scope: verifiable agent memory + encrypted multi-party disclosure (still just
encrypt + anchor). Out-of-scope creep to resist: a general secure-data-room platform, a
smart-contract engine, custody/escrow. Stay attached to the outcome — clients can *prove*
and privately *share* what their agent did — not to any particular vehicle.

---

## 9. Entry schema (target, supersedes v0.1)

v0.1 entry is `{ seq, ts, actor, kind, data, entryHash, linkHash }`. Target adds:

```jsonc
{
  "seq": 42,
  "ts": "2026-08-31T21:40:00.000Z",
  "actor": "mike",
  "kind": "twetch.post",
  "evidence": "corroborated",        // asserted | structured | mechanical | corroborated
  "capturedBy": "harness-hook",      // provenance of the RECORD: self | harness-hook | observer
  "nonce": "<hex>",                  // per-entry random salt (privacy: unguessable hash)
  "payloadHash": "<sha256(nonce ‖ canonical(payload))>",
  "contextHash": "<sha256(nonce ‖ context_snapshot)>",   // optional; action-time justification
  "refs": [                          // external corroboration, independently checkable
    { "type": "txid", "value": "..." },
    { "type": "url",  "value": "https://twetch.com/..." }
  ],
  "sig": "<BRC-77 signature over the entry>",             // optional; authorship
  "entryHash": "<sha256(canonical(entry-minus-hashes))>",
  "linkHash":  "<sha256(prevLink ‖ entryHash)>"
}
```

Plaintext payload/context are stored off-chain, encrypted (envelope, §5). The log commits
to *hashes* so it can be public while contents stay private. What gets anchored as a
Merkle leaf is the `linkHash`.

## 10. Open decisions (for Andy)

1. **v1 fidelity target:** mechanical (harness hook, complete, agent-can't-skip) vs push
   for corroborated. Leaning: ship mechanical for Mike now, corroborate where a natural
   external artifact exists (spends, posts, deploys, commits).
2. **First mainnet anchor:** go / hold. First real `seal` spends float and is the live
   compat proof (local root must equal bsv.cx's or it aborts).
3. **Crypto stack:** adopt `@bsv/sdk` BRC-2/42/43 + BRC-77 directly (matches bsv.cx), vs a
   thin WebCrypto envelope layer we own. Leaning `@bsv/sdk` for interop.
4. **Repo + domain:** GitHub `andyrowe/blocktrain` + point blocktrain.org somewhere.
