// Export a self-contained PUBLIC verification bundle for one sealed batch.
//
// Privacy: this publishes ONLY the entries in the chosen seal, and only if they are
// explicitly safe to disclose. For the PoC we publish the first batch (seq 0..2) — the
// three entries that document blocktrain's own creation. The private operational log
// (which the P2 hook fills with cross-project activity) is NOT published.
//
// The bundle carries everything a stranger needs to verify from scratch, trusting no one:
// the raw entries (to recompute the hash-chain), and the seal (root, txid, ordered leaves).
//
// usage: node scripts/publish.ts [sealIndex=0] > site/blocktrain-poc.json

import { readLog, readSeals } from "../src/store.ts";

const LOG = process.env.BLOCKTRAIN_LOG ?? "data/log.jsonl";
const SEALS = process.env.BLOCKTRAIN_SEALS ?? "data/seals.json";
const sealIndex = Number(process.argv[2] ?? "0");

const log = readLog(LOG);
const seals = readSeals(SEALS).seals;
const seal = seals[sealIndex];
if (!seal) throw new Error(`no seal at index ${sealIndex}`);

const entries = log.slice(seal.fromSeq, seal.toSeq + 1);

const bundle = {
  version: 1,
  project: "blocktrain",
  note:
    "Self-contained public proof of a blocktrain memory batch. Verify with verify.mjs — " +
    "it recomputes the hash-chain, folds each Merkle inclusion proof, and reads the anchor " +
    "tx's OP_RETURN straight off the public BSV chain. Trusts no server, including bsv.cx.",
  entries, // full LogEntry objects: {seq,ts,actor,kind,data,entryHash,linkHash}
  seal: {
    root: seal.root,
    txid: seal.txid,
    network: seal.network,
    fromSeq: seal.fromSeq,
    toSeq: seal.toSeq,
    leaves: seal.leaves, // ordered linkHashes anchored in this batch
    anchorFormat: "OP_RETURN: bsv.cx / not2 / <root>",
    explorer: `https://whatsonchain.com/tx/${seal.txid}`,
  },
};

process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
