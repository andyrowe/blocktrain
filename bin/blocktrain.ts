#!/usr/bin/env node
// blocktrain CLI — verifiable agent memory over bsv.cx.
//
//   blocktrain append --actor mike --kind twetch.post --data '{"txid":"..."}'
//   blocktrain seal [--dry]        seal pending entries into an on-chain batch
//   blocktrain verify [--spv]      replay chain + check every anchor (offline; --spv also asks bsv.cx headers)
//   blocktrain status              counts + tip + sealed-through
//
// Paths (override with env): BLOCKTRAIN_LOG (default ./data/log.jsonl),
// BLOCKTRAIN_SEALS (default ./data/seals.json), BLOCKTRAIN_BSVCX (default https://bsv.cx).

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { appendEntry, verifyChain } from "../src/chain.ts";
import { readLog, appendLog, readSeals, writeSeals, sealedThrough, type Seal } from "../src/store.ts";
import { merkleRoot, proofForIndex, verifyInclusion } from "../src/merkle.ts";
import { anchorBatch, anchorCarriesRoot } from "../src/client.ts";

const LOG = process.env.BLOCKTRAIN_LOG ?? "data/log.jsonl";
const SEALS = process.env.BLOCKTRAIN_SEALS ?? "data/seals.json";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function argsAll(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === flag) out.push(process.argv[i + 1]);
  return out;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "append": {
      const kind = arg("--kind");
      if (!kind) throw new Error("append: --kind is required");
      let data: unknown;
      try { data = JSON.parse(arg("--data") ?? "{}"); } catch { data = arg("--data"); }
      const ctxFile = arg("--context");
      const ctxInline = arg("--context-data");
      const context = ctxFile ? readFileSync(ctxFile) : ctxInline != null ? ctxInline : undefined;
      const { appendEvent } = await import("../src/core.ts");
      const r = appendEvent({ log: LOG, seals: SEALS }, {
        actor: arg("--actor"), kind, data,
        refs: argsAll("--ref"), evidence: arg("--evidence"),
        encryptTo: argsAll("--encrypt-to"), context,
      });
      const nRefs = argsAll("--ref").length;
      console.log(`appended seq=${r.seq} kind=${kind} evidence=${r.evidence}${nRefs ? ` refs=${nRefs}` : ""}${r.contextHash ? " +context" : ""}${r.encryptedTo ? ` encrypted→${r.encryptedTo} recipient(s)` : ""}`);
      console.log(`  entryHash ${r.entryHash}`);
      console.log(`  linkHash  ${r.linkHash}`);
      break;
    }

    case "seal": {
      const dry = has("--dry");
      const log = readLog(LOG);
      const sf = readSeals(SEALS);
      const from = sealedThrough(sf.seals) + 1;
      if (from >= log.length) {
        console.log("nothing to seal — all entries already anchored");
        break;
      }
      const pending = log.slice(from);
      const leaves = pending.map((e) => e.linkHash);
      const leafBufs = leaves.map((h) => Buffer.from(h, "hex"));
      const localRoot = merkleRoot(leafBufs).toString("hex");

      if (dry) {
        const seal: Seal = {
          root: localRoot, txid: "DRY", network: "dry", anchored: false,
          createdAt: new Date().toISOString(), fromSeq: from, toSeq: log.length - 1, leaves,
        };
        console.log(`[dry] would anchor ${leaves.length} entries (seq ${from}..${log.length - 1})`);
        console.log(`[dry] local merkle root ${localRoot}`);
        sf.seals.push(seal);
        writeSeals(SEALS, sf);
        break;
      }
      const wif = process.env.BLOCKTRAIN_PAY_WIF;
      if (!wif) throw new Error("seal: set BLOCKTRAIN_PAY_WIF to a funded mainnet WIF (bsv.cx /n/batch is x402 pay-gated)");
      console.log(`anchoring ${leaves.length} entries (seq ${from}..${log.length - 1}) via bsv.cx (x402) ...`);
      const { sealPending } = await import("../src/core.ts");
      const r = await sealPending({ log: LOG, seals: SEALS }, wif);
      if (!r.sealed) { console.log(r.reason); break; }
      if (r.settlementTxid) console.log(`paid x402 invoice, settlement tx ${r.settlementTxid}`);
      console.log(`anchored ${r.count} entries txid ${r.txid} root ${r.root} (roots match ✓)`);
      break;
    }

    case "verify": {
      const { verifyLog } = await import("../src/core.ts");
      const r = await verifyLog({ log: LOG, seals: SEALS }, { refs: has("--refs"), onchain: has("--spv") });
      if ("stage" in r) {
        const fs = (r as { failedSeq?: number }).failedSeq;
        console.error(`${(r.stage as string).toUpperCase()} verification failed${fs != null ? ` at seq ${fs}` : ""}: ${r.reason}`);
        process.exit(1);
      }
      console.log(`chain ok: ${r.count} entries, tip ${r.tip ?? "(empty)"}${r.encrypted ? ` (${r.encrypted} encrypted — content needs a key; run reveal)` : ""}`);
      for (const s of r.seals) {
        const note = s.onchain ? `on-chain:${s.onchain}` : s.txid === "DRY" ? "(dry)" : "anchored";
        console.log(`seal seq ${s.fromSeq}..${s.toSeq} root ${s.root.slice(0, 16)}… txid ${s.txid.slice(0, 12)}… ${note}`);
      }
      for (const rf of r.refs) console.log(`ref seq ${rf.seq} ${rf.type} ${rf.ok ? "✓" : "✗"} ${rf.detail}`);
      if (r.refs.length) console.log(`refs: ${r.refs.filter((x) => x.ok).length}/${r.refs.length} corroborated`);
      const unsealed = r.count - 1 - r.sealed;
      console.log(`verified ${r.seals.length} seals; ${unsealed > 0 ? unsealed + " entries pending seal" : "all entries sealed"}`);
      if (!r.ok) process.exit(1);
      break;
    }

    case "hook": {
      // Read a harness PostToolUse event from stdin and append a redacted entry if it's
      // an outward/mutating action. Best-effort, never fails the caller.
      const { runHook } = await import("../src/hook.ts");
      let stdinStr = "";
      try {
        stdinStr = readFileSync(0, "utf8");
      } catch {
        process.exit(0); // no stdin -> nothing to do
      }
      const entry = runHook(stdinStr, LOG);
      if (entry && process.env.BLOCKTRAIN_HOOK_DEBUG) {
        console.error(`[blocktrain hook] captured seq=${entry.seq} ${entry.kind}`);
      }
      process.exit(0); // always succeed
    }

    case "keygen": {
      const { generateIdentity } = await import("../src/crypto.ts");
      const id = generateIdentity();
      console.log(`pub (share this to grant read access):\n  ${id.pub}`);
      console.log(`wif (KEEP SECRET — this is the read key):\n  ${id.wif}`);
      break;
    }

    case "reveal": {
      const seq = Number(arg("--seq"));
      const wif = arg("--key");
      if (Number.isNaN(seq)) throw new Error("reveal: --seq <n> required (--key <wif> if encrypted)");
      const { revealEntry } = await import("../src/core.ts");
      const rv = revealEntry({ log: LOG, seals: SEALS }, seq, wif);
      console.log(`seq ${rv.seq} kind=${rv.kind}`);
      console.log(`  data: ${JSON.stringify(rv.data)}`);
      if (rv.encrypted) {
        console.log(`  content integrity: ${rv.integrityOk ? "✓ matches the committed on-chain hash" : "✗ MISMATCH"}`);
        if (!rv.integrityOk) process.exit(1);
      }
      break;
    }

    case "context": {
      const seq = Number(arg("--seq"));
      const wif = arg("--key");
      if (Number.isNaN(seq)) throw new Error("context: --seq <n> required (--key <wif> if encrypted)");
      const log = readLog(LOG);
      const e = log[seq] as { data?: { nonce?: string; contextHash?: string }; enc?: unknown };
      if (!e) throw new Error(`no entry at seq ${seq}`);
      // get the entry data (decrypt the entry first if it's encrypted) to read nonce+contextHash
      let edata = e.data;
      if (e.enc) {
        if (!wif) { console.error("encrypted entry — pass --key <wif>"); process.exit(1); }
        const { decryptWith } = await import("../src/crypto.ts");
        edata = JSON.parse(decryptWith(e.enc as never, wif).toString("utf8"));
      }
      const nonce = edata?.nonce, contextHash = edata?.contextHash;
      if (!contextHash || !nonce) { console.log(`seq ${seq} has no committed context`); break; }
      const { readContext } = await import("../src/store.ts");
      const rec = readContext(LOG, contextHash);
      if (!rec) { console.error(`context snapshot for seq ${seq} not found in sidecar`); process.exit(1); }
      let blob = rec.data;
      if (rec.encrypted) {
        if (!wif) { console.error("context is encrypted — pass --key <wif>"); process.exit(1); }
        const { decryptWith } = await import("../src/crypto.ts");
        blob = decryptWith(JSON.parse(rec.data.toString("utf8")) as never, wif);
      }
      const { computeContextHash } = await import("../src/chain.ts");
      const good = computeContextHash(nonce, blob) === contextHash;
      console.log(`seq ${seq} context (${blob.length} bytes):`);
      console.log(blob.toString("utf8").slice(0, 2000));
      console.log(`  commitment: ${good ? "✓ matches the contextHash committed at action-time (not backfilled)" : "✗ MISMATCH — snapshot altered or wrong"}`);
      if (!good) process.exit(1);
      break;
    }

    case "reconcile": {
      // Fold any contention-spilled events (data/log.jsonl.pending.jsonl) into the chain.
      const { reconcile } = await import("../src/hook.ts");
      const n = reconcile(LOG);
      console.log(`reconciled ${n} pending ${n === 1 ? "entry" : "entries"}`);
      break;
    }

    case "status": {
      const log = readLog(LOG);
      const sf = readSeals(SEALS);
      const sealed = sealedThrough(sf.seals);
      console.log(`entries: ${log.length}`);
      console.log(`tip:     ${log.length ? log[log.length - 1].linkHash : "(empty)"}`);
      console.log(`sealed:  through seq ${sealed} (${sf.seals.length} seals)`);
      console.log(`pending: ${log.length - 1 - sealed} entries`);
      break;
    }

    default:
      console.log("usage: blocktrain <append|seal|verify|status> [flags]");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
