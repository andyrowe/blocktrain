# blocktrain

**Verifiable agent memory.** A thin layer that turns an AI agent's action log into a
record that is *tamper-evident, timestamped, and portable* — provable to a third party
who does not trust the operator, and still verifiable even if blocktrain disappears.

Today's agent-memory tools (mem0, Letta, Zep, LangGraph) are storage for *recall*. None
make the record verifiable. blocktrain is the honest substrate under agent autonomy: an
agent you can **audit** is one you can safely give a longer leash.

## How it works

1. **Hash-chain (order + integrity).** Every event is canonicalized and hashed, and each
   entry links the previous one:

   ```
   entryHash_i = SHA256(canonical(event_i))
   linkHash_i  = SHA256(linkHash_{i-1} || entryHash_i)     (genesis = 32 zero bytes)
   ```

   Editing, deleting, reordering, or splicing any entry breaks the chain — detectably.

2. **On-chain anchor (timestamp).** Pending `linkHash`es are sealed into an RFC 6962
   Merkle batch and anchored on BSV via [bsv.cx](https://bsv.cx) `not2` — one transaction
   regardless of batch size. Each entry gets an independent inclusion proof.

3. **Trustless verify.** `verify` replays the chain offline, then folds each entry's
   inclusion proof to the anchored Merkle root using a client-side RFC 6962 verifier —
   proven byte-compatible with bsv.cx's tree against the Certificate Transparency
   reference vectors. Nothing here trusts the bsv.cx server; the on-chain OP_RETURN
   `bsv.cx/not2/<root>` is the ground truth.

## Honest scope

blocktrain proves **integrity, order, and timestamp** of a *self-reported* log. It makes
tampering *after the fact* detectable. It does **not** make the agent truthful to its own
log — same limit every anchor has. The use cases that need this (debug, dispute,
accountability, audit) don't need more.

## CLI

```
blocktrain append --actor mike --kind twetch.post --data '{"txid":"e5544585"}'
blocktrain seal [--dry]      # anchor pending entries (real seal spends BSV float)
blocktrain verify [--spv]    # replay chain + verify every anchor
blocktrain status
```

Paths via env: `BLOCKTRAIN_LOG` (default `data/log.jsonl`), `BLOCKTRAIN_SEALS`
(default `data/seals.json`), `BLOCKTRAIN_BSVCX` (default `https://bsv.cx`).

## Test

```
npm test    # RFC 6962 Merkle vectors + hash-chain tamper-detection
```

Requires Node >= 24 (native TypeScript). Dependency-free: Node built-in crypto + fetch.

## Design & privacy

See [`DESIGN.md`](./DESIGN.md) for the full rationale: the fidelity ladder (asserted →
mechanical → corroborated), action-time **context anchoring**, and the privacy model —
the chain only ever holds a hash, contents are held off-chain **encrypted**, with
**blind anchoring** the default (blocktrain can't read your logs) and **envelope
encryption** for multi-party access (client, lawyers, a counterparty) without breaking
blindness.

## Status

Alpha. Pure core + CLI + offline verification proven; first mainnet batch anchored and
independently verified. Reference implementation for on-chain anchoring: `anchorchain`
(prof-faustus, MIT).

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Chosen over MIT for the explicit
contributor patent grant and retaliation clause, which suit a project used for audit and
dispute in a patent-sensitive area (Merkle/SPV/anchoring).
