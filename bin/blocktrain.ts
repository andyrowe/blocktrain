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
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "append": {
      const actor = arg("--actor") ?? "mike";
      const kind = arg("--kind");
      const dataRaw = arg("--data") ?? "{}";
      if (!kind) throw new Error("append: --kind is required");
      let data: unknown;
      try {
        data = JSON.parse(dataRaw);
      } catch {
        data = dataRaw; // allow a plain string payload
      }
      const log = readLog(LOG);
      const entry = appendEntry(log, { actor, kind, data });
      appendLog(LOG, entry);
      console.log(`appended seq=${entry.seq} kind=${kind}`);
      console.log(`  entryHash ${entry.entryHash}`);
      console.log(`  linkHash  ${entry.linkHash}`);
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

      let seal: Seal;
      if (dry) {
        seal = {
          root: localRoot, txid: "DRY", network: "dry", anchored: false,
          createdAt: new Date().toISOString(), fromSeq: from, toSeq: log.length - 1, leaves,
        };
        console.log(`[dry] would anchor ${leaves.length} entries (seq ${from}..${log.length - 1})`);
        console.log(`[dry] local merkle root ${localRoot}`);
      } else {
        const wif = process.env.BLOCKTRAIN_PAY_WIF;
        if (!wif) throw new Error("seal: set BLOCKTRAIN_PAY_WIF to a funded mainnet WIF (bsv.cx /n/batch is x402 pay-gated)");
        console.log(`anchoring ${leaves.length} entries (seq ${from}..${log.length - 1}) via bsv.cx (x402) ...`);
        const receipt = await anchorBatch(leaves, wif);
        if (receipt.settlementTxid) console.log(`paid x402 invoice, settlement tx ${receipt.settlementTxid}`);
        // Compat gate: bsv.cx MUST derive the same root from the same leaves, or our
        // client-side verifier and their tree disagree — refuse to record a bad seal.
        if (receipt.root.toLowerCase() !== localRoot.toLowerCase()) {
          throw new Error(
            `root mismatch! local ${localRoot} vs bsv.cx ${receipt.root} — aborting, do not trust this anchor`,
          );
        }
        seal = {
          root: receipt.root, txid: receipt.txid, network: "main", anchored: receipt.anchored,
          settlementTxid: receipt.settlementTxid,
          createdAt: new Date().toISOString(), fromSeq: from, toSeq: log.length - 1, leaves,
        };
        console.log(`anchored txid ${receipt.txid} root ${receipt.root} (roots match ✓)`);
      }
      sf.seals.push(seal);
      writeSeals(SEALS, sf);
      break;
    }

    case "verify": {
      const withSpv = has("--spv");
      const log = readLog(LOG);
      const chain = verifyChain(log);
      if (!chain.ok) {
        console.error(`CHAIN BROKEN at seq ${chain.failedSeq}: ${chain.reason}`);
        process.exit(1);
      }
      console.log(`chain ok: ${chain.count} entries, tip ${chain.tip ?? "(empty)"}`);

      const sf = readSeals(SEALS);
      let anchorsOk = 0;
      for (const s of sf.seals) {
        // 1) each anchored leaf must match the logged linkHash at that seq
        for (let i = 0; i < s.leaves.length; i++) {
          const seq = s.fromSeq + i;
          if (log[seq]?.linkHash !== s.leaves[i]) {
            console.error(`seal ${s.root.slice(0, 12)}: leaf ${i} != log seq ${seq}`);
            process.exit(1);
          }
        }
        // 2) recompute the inclusion proof locally and fold it to the root (no server trust)
        const bufs = s.leaves.map((h) => Buffer.from(h, "hex"));
        for (let i = 0; i < bufs.length; i++) {
          const proof = proofForIndex(bufs, i);
          if (!verifyInclusion(bufs[i], proof, s.root)) {
            console.error(`seal ${s.root.slice(0, 12)}: inclusion proof failed at leaf ${i}`);
            process.exit(1);
          }
        }
        // 3) optional: read the anchor tx off the public chain and confirm its OP_RETURN
        //    encodes bsv.cx/not2/<root> — ground truth, trusting only the chain.
        let spvNote = s.anchored ? "anchored" : "(unanchored)";
        if (withSpv && s.txid && s.txid !== "DRY") {
          try {
            const onchain = await anchorCarriesRoot(s.txid, s.root, s.network === "test" ? "test" : "main");
            spvNote = onchain ? "on-chain:root-confirmed ✓" : "on-chain:ROOT-NOT-FOUND ✗";
            if (!onchain) process.exit(1);
          } catch (e) {
            spvNote = `on-chain:error(${(e as Error).message.slice(0, 50)})`;
          }
        }
        console.log(`seal seq ${s.fromSeq}..${s.toSeq} root ${s.root.slice(0, 16)}… txid ${s.txid.slice(0, 12)}… ${spvNote}`);
        anchorsOk++;
      }
      const sealed = sealedThrough(sf.seals);
      const unsealed = log.length - 1 - sealed;
      console.log(`verified ${anchorsOk} seals; ${unsealed > 0 ? unsealed + " entries pending seal" : "all entries sealed"}`);
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
