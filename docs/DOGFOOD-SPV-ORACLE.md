# blocktrain — dogfooding on the spv-oracle collaboration

blocktrain's first real anchor target isn't a hypothetical stranger — it's the
collaboration that built it. **spv-oracle** was run by two independently-operated agents
(Mike on OpenClaw, Juno on Hermes) with no shared trust domain, and it produced exactly the
artifact blocktrain exists to protect: a `DECISIONS.md` log of forks, choices, and criteria.

This doc is the plan for anchoring that log. It is deliberately honest about what is
shippable today (append) and what is blocked (seal). Companion to
[DESIGN.md](../DESIGN.md), [THREAT-MODEL.md](./THREAT-MODEL.md), [PAYMENTS.md](./PAYMENTS.md).

## 1. Why this is the right dogfood

`DECISIONS.md` integrity today rests entirely on **git + GitHub**: real hash-chaining, but
centrally hosted and rewritable by anyone with repo admin — force-push, history rewrite, or
GitHub itself removing the repo. blocktrain adds an **independent, on-chain, math-verifiable
witness** on top: the BSV chain attesting "this hash existed by this block time," provable
by anyone trusting nothing but the public chain.

Crucially, spv-oracle exercises blocktrain's **actual differentiator** — the two-party,
no-shared-trust setting (THREAT-MODEL §5). A solo log a single agent both writes and seals
proves only that a cooperative operator didn't *edit*. Two independent agents cross-attesting
is the one thing this dogfood can prove that a solo log cannot. See §3.

**Verified anchor targets** (checked, not asserted — repo is private, confirmed via authed
`gh`): `spv-oracle` exists; commits `0c28302` (D7 first manual snapshot, SSHSIG signed) and
`eff95c3` (D7 COMPLETE) are real; `DECISIONS.md` is live at blob `3d89b45`.

## 2. What's anchor-worthy

Anchor at **milestones, not every edit**:

- **`DECISIONS.md` at milestone state** — the "who decided what, why" record, checkpointed
  so each seal is a tamper-evident snapshot independent of GitHub.
- **D7 completion** — cross-machine SSHSIG proof (`0c28302`, `eff95c3`).
- **Governance flags** — e.g. D9 (open). A governance issue resolved later benefits from
  proof of *when it was raised*, independent of disputable chat/repo timestamps.

## 3. Mechanism

### 3.1 Append per milestone (free, works today)

Each milestone gets a `blocktrain_append`:

```
kind: "spv-oracle-decision"
data: { decision_id, decisions_md_sha256, summary, commit_sha }
refs: [
  "url:https://…/DECISIONS.md::<decisions_md_sha256>",   # PRIMARY — content witness
  "git-commit:<sha>:andyrowe/spv-oracle"                  # secondary, best-effort
]
```

**Anchor the content hash, not just the commit SHA — and know why.** Two corrections to the
naïve "ref the git commit" version, both grounded in the code:

1. **A git-commit ref against a private repo fails for outside auditors.** `verifyRef`
   resolves `git-commit` by fetching `api.github.com/repos/<repo>/commits/<sha>`
   **unauthenticated** (`src/refs.ts`). For a private repo that returns 404 → the ref is
   unresolvable to anyone without access. Worse, `appendEvent` auto-labels any entry with
   refs as `evidence: "corroborated"` (`src/core.ts`) — so a private-repo ref would *claim*
   corroboration an auditor can't check. That is precisely the "asserted dressed as proof"
   the project forbids (THREAT-MODEL §3).
2. **A git SHA mostly re-proves what git already proves.** The teeth come from anchoring the
   **sha256 of `DECISIONS.md` content** — the thing a GitHub admin *can* force-push away.
   Carry it as a `url` ref with `::<sha256>`; `verifyRef` fetches the bytes and confirms the
   hash matches (`content sha256 matches`). Keep the commit SHA as a secondary ref, and note
   in the entry that it is **private-repo-gated** until/unless spv-oracle goes public.

### 3.2 Seal in batches, gated on per-seal consent (see §4)

blocktrain's Merkle batch means sealing 10 entries costs one on-chain tx, same as 1. Seal at
**phase boundaries** (Phase 1 done, Phase 2 done), never per commit. Appending stays free and
un-sealed until a batch is worth a checkpoint. **Because `seal` spends real sats, no seal
fires without Andy's explicit go for that specific seal** — batch several milestones, then ask,
rather than sealing reflexively or on a standing yes.

### 3.3 Cross-attestation — the differentiator, not solo authorship

**Rejected:** "whoever authors the triggering commit is the sole appender." It's clean for
provenance but rebuilds the single-trust-domain the anchor exists to escape — one actor, one
record, self-attested — which is the exact hostile/omitting-operator gap (THREAT-MODEL §5).

**Adopted:** the milestone author appends its entry, **and the other agent independently
appends its own entry** confirming it verified the commit + `decisions_md_sha256`. Two
entries, two actors, one milestone. Provenance stays clean (each entry has one author); the
*record* gains a second witness. This is a concrete first step toward the P7 co-signing spec
([SHARED-ROOM.md](./SHARED-ROOM.md)) without building it — the cross-party structure emerges
from two ordinary appends.

### 3.4 Verify against the chain, not the tool

Whoever seals re-verifies the anchor against WhatsOnChain directly afterward
(`verify --spv --refs`, cross-checked explorers per `anchorCarriesRoot`). Proving blocktrain's
own claims *is* the dogfood value, not merely using it.

## 4. Seal capability and the per-seal consent gate

Stated plainly so nothing here reads as unconstrained:

- **Append works now** — free, log-only, no chain write, no wallet.
- **Seal is now reportedly wired on Juno's box.** Per Juno (2026-09-09), `BLOCKTRAIN_PAY_WIF`
  (the sponsored donation float, [PAYMENTS.md §Rung 0](./PAYMENTS.md)) has been provisioned into
  her Hermes config, the gateway restarted, and the running MCP process confirmed to carry it —
  she proved the append→verify pipeline and deliberately did **not** call `blocktrain_seal`. I
  have not independently re-verified this from my side (my commission key to her box is currently
  rejected), so treat the capability as attested by Juno, not cross-checked by me.
- **The gate is now consent, not infrastructure.** `blocktrain_seal` spends real sats, so every
  seal needs Andy's explicit per-seal go — a standing "yes" does not authorize future seals. This
  is by design (the consent gate in §3.2), not a missing dependency.

So: **append-ready and reportedly seal-capable, held per-seal by consent.** This dogfood is the
concrete first job for that WIF whenever Andy greenlights the first real seal.

## 5. What this does not do

- **Not a migration.** A second independent witness on top of git/GitHub, not a replacement.
- **Not a judgment of the decision.** Anchoring proves the stated record existed, unaltered,
  at a time — not that the decision was good. Anchoring a bad decision just makes it provably
  ours.
